from __future__ import annotations

import shutil
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

from fastapi import HTTPException, status

from .db import BASE_DIR, Database
from .schemas import (
    MemoryPalaceCreate,
    MemoryPalaceListItem,
    MemoryPalaceRecord,
    MemoryPalaceUpdate,
)

MEMORY_PALACES_DATA_DIR = BASE_DIR / "data" / "memory_palace"


def now_utc() -> datetime:
    return datetime.now(UTC)


def parse_datetime(value: str | None) -> datetime:
    parsed = datetime.fromisoformat(value) if value is not None else None
    return parsed.astimezone(UTC) if parsed is not None else now_utc()


def memory_palace_dir(name: str) -> Path:
    return MEMORY_PALACES_DATA_DIR / name


class MemoryPalaceStore:
    def __init__(self, database: Database) -> None:
        self.database = database

    def list_memory_palaces(self) -> list[MemoryPalaceRecord]:
        with self.database.connect() as connection:
            rows = connection.execute(
                """
                SELECT name, description, created_at, updated_at
                FROM memory_palaces
                ORDER BY updated_at DESC, name ASC
                """
            ).fetchall()
        return [self._row_to_record(row) for row in rows]

    def get_memory_palace(self, name: str) -> MemoryPalaceRecord | None:
        with self.database.connect() as connection:
            row = connection.execute(
                """
                SELECT name, description, created_at, updated_at
                FROM memory_palaces
                WHERE name = ?
                """,
                (name,),
            ).fetchone()
        return self._row_to_record(row) if row else None

    def create_memory_palace(self, payload: MemoryPalaceCreate) -> MemoryPalaceRecord:
        timestamp = now_utc().isoformat()
        with self.database.connect() as connection:
            try:
                connection.execute(
                    """
                    INSERT INTO memory_palaces (name, description, created_at, updated_at)
                    VALUES (?, ?, ?, ?)
                    """,
                    (payload.name, payload.description, timestamp, timestamp),
                )
            except Exception as exc:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=f'Memory palace "{payload.name}" already exists.',
                ) from exc
        record = self.get_memory_palace(payload.name)
        assert record is not None
        return record

    def update_memory_palace(
        self,
        previous_name: str,
        payload: MemoryPalaceUpdate,
    ) -> MemoryPalaceRecord:
        existing = self.get_memory_palace(previous_name)
        if existing is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f'Memory palace "{previous_name}" was not found.',
            )

        updated_at = now_utc().isoformat()
        with self.database.connect() as connection:
            if payload.name != previous_name:
                duplicate = connection.execute(
                    "SELECT 1 FROM memory_palaces WHERE name = ?",
                    (payload.name,),
                ).fetchone()
                if duplicate:
                    raise HTTPException(
                        status_code=status.HTTP_409_CONFLICT,
                        detail=f'Memory palace "{payload.name}" already exists.',
                    )

            connection.execute(
                """
                UPDATE memory_palaces
                SET name = ?, description = ?, updated_at = ?
                WHERE name = ?
                """,
                (payload.name, payload.description, updated_at, previous_name),
            )

        record = self.get_memory_palace(payload.name)
        assert record is not None
        return record.model_copy(update={"created_at": existing.created_at})

    def delete_memory_palace(self, name: str) -> None:
        with self.database.connect() as connection:
            connection.execute("DELETE FROM memory_palaces WHERE name = ?", (name,))

    @staticmethod
    def _row_to_record(row) -> MemoryPalaceRecord:
        return MemoryPalaceRecord(
            name=row["name"],
            description=row["description"],
            created_at=parse_datetime(row["created_at"]),
            updated_at=parse_datetime(row["updated_at"]),
        )


@dataclass
class MemoryPalaceManager:
    store: MemoryPalaceStore

    def startup(self) -> None:
        MEMORY_PALACES_DATA_DIR.mkdir(parents=True, exist_ok=True)
        self.store.database.initialize()

    def list_memory_palaces(self) -> list[MemoryPalaceListItem]:
        return [
            MemoryPalaceListItem(
                name=record.name,
                description=record.description,
                created_at=record.created_at,
                updated_at=record.updated_at,
            )
            for record in self.store.list_memory_palaces()
        ]

    def get_memory_palace(self, name: str) -> MemoryPalaceRecord:
        record = self.store.get_memory_palace(name)
        if record is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f'Memory palace "{name}" was not found.',
            )
        return record

    def create_memory_palace(self, payload: MemoryPalaceCreate) -> MemoryPalaceRecord:
        MEMORY_PALACES_DATA_DIR.mkdir(parents=True, exist_ok=True)
        record = self.store.create_memory_palace(payload)
        memory_palace_dir(record.name).mkdir(parents=True, exist_ok=True)
        return record

    def update_memory_palace(
        self,
        previous_name: str,
        payload: MemoryPalaceUpdate,
    ) -> MemoryPalaceRecord:
        existing_dir = memory_palace_dir(previous_name)
        next_dir = memory_palace_dir(payload.name)
        existing_dir.mkdir(parents=True, exist_ok=True)

        record = self.store.update_memory_palace(previous_name, payload)
        if previous_name != payload.name:
            if next_dir.exists():
                shutil.rmtree(next_dir, ignore_errors=True)
            shutil.move(str(existing_dir), str(next_dir))
        else:
            next_dir.mkdir(parents=True, exist_ok=True)
        return record

    def delete_memory_palace(self, name: str) -> None:
        self.get_memory_palace(name)
        target_dir = memory_palace_dir(name)
        self.store.delete_memory_palace(name)
        if target_dir.exists():
            shutil.rmtree(target_dir, ignore_errors=True)
