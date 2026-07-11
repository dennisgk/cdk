from __future__ import annotations

import hashlib
import json
import re
import shutil
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

from fastapi import HTTPException, status

from .db import BASE_DIR, Database
from .schemas import (
    MemoryPalaceAssetInfo,
    MemoryPalaceCreate,
    MemoryPalaceListItem,
    MemoryPalaceRecord,
    MemoryPalaceUpdate,
)

MEMORY_PALACES_DATA_DIR = BASE_DIR / "data" / "memory_palace"
SCENE_FILE_NAME = "palace.json"
UPLOADS_DIR_NAME = "uploads"
SCENE_SCHEMA_VERSION = 1
MAX_SCENE_BYTES = 10 * 1024 * 1024
MAX_ASSET_BYTES = 50 * 1024 * 1024
ASSET_FORMATS = ("stl", "glb", "fbx")
ASSET_ID_PATTERN = re.compile(r"^[0-9a-f]{16}$")


def default_scene_file() -> dict:
    return {
        "schemaVersion": SCENE_SCHEMA_VERSION,
        "savedAt": None,
        "editor": None,
        "scene": {"objects": []},
    }


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

    def touch_memory_palace(self, name: str) -> None:
        with self.database.connect() as connection:
            connection.execute(
                "UPDATE memory_palaces SET updated_at = ? WHERE name = ?",
                (now_utc().isoformat(), name),
            )

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

    def get_scene(self, name: str) -> dict:
        self.get_memory_palace(name)
        scene_path = memory_palace_dir(name) / SCENE_FILE_NAME
        if not scene_path.is_file():
            return default_scene_file()
        try:
            return json.loads(scene_path.read_text("utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Scene file could not be read.",
            ) from exc

    def save_scene(self, name: str, payload: dict) -> dict:
        self.get_memory_palace(name)
        self._validate_scene_payload(payload)
        payload["savedAt"] = now_utc().isoformat()

        encoded = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
        if len(encoded.encode("utf-8")) > MAX_SCENE_BYTES:
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail="Scene is too large.",
            )

        palace_dir = memory_palace_dir(name)
        palace_dir.mkdir(parents=True, exist_ok=True)
        scene_path = palace_dir / SCENE_FILE_NAME
        temp_path = palace_dir / f"{SCENE_FILE_NAME}.tmp"
        temp_path.write_text(encoded, "utf-8")
        temp_path.replace(scene_path)

        self._sweep_unreferenced_assets(name, payload)
        self.store.touch_memory_palace(name)
        return payload

    def save_asset(self, name: str, file_name: str, data: bytes) -> MemoryPalaceAssetInfo:
        self.get_memory_palace(name)
        extension = Path(file_name).suffix.lstrip(".").lower()
        if extension not in ASSET_FORMATS:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Unsupported asset type: {file_name}",
            )
        if len(data) == 0:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Asset file is empty.",
            )
        if len(data) > MAX_ASSET_BYTES:
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail="Asset file is too large.",
            )

        asset_id = hashlib.sha256(data).hexdigest()[:16]
        uploads_dir = memory_palace_dir(name) / UPLOADS_DIR_NAME
        uploads_dir.mkdir(parents=True, exist_ok=True)
        asset_path = uploads_dir / f"{asset_id}.{extension}"
        if not asset_path.exists():
            asset_path.write_bytes(data)
        return MemoryPalaceAssetInfo(
            asset_id=asset_id,
            file_name=file_name,
            format=extension,
        )

    def get_asset_path(self, name: str, asset_id: str) -> Path:
        self.get_memory_palace(name)
        if not ASSET_ID_PATTERN.fullmatch(asset_id):
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Asset was not found.",
            )
        uploads_dir = memory_palace_dir(name) / UPLOADS_DIR_NAME
        for extension in ASSET_FORMATS:
            candidate = uploads_dir / f"{asset_id}.{extension}"
            if candidate.is_file():
                return candidate
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Asset was not found.",
        )

    @staticmethod
    def _validate_scene_payload(payload: dict) -> None:
        if not isinstance(payload, dict):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Scene payload must be an object.",
            )
        if not isinstance(payload.get("schemaVersion"), int):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Scene payload is missing a schemaVersion.",
            )
        scene = payload.get("scene")
        if not isinstance(scene, dict) or not isinstance(scene.get("objects"), list):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Scene payload must contain scene.objects.",
            )

    def _sweep_unreferenced_assets(self, name: str, payload: dict) -> None:
        uploads_dir = memory_palace_dir(name) / UPLOADS_DIR_NAME
        if not uploads_dir.is_dir():
            return
        referenced: set[str] = set()
        for entry in payload["scene"]["objects"]:
            if not isinstance(entry, dict):
                continue
            imported = entry.get("importedModel")
            if isinstance(imported, dict) and isinstance(imported.get("assetId"), str):
                referenced.add(imported["assetId"])
        for asset_file in uploads_dir.iterdir():
            if asset_file.is_file() and asset_file.stem not in referenced:
                asset_file.unlink(missing_ok=True)
