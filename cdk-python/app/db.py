from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from pathlib import Path
from threading import Lock

BASE_DIR = Path(__file__).resolve().parent.parent
DB_PATH = BASE_DIR / "cdk.sqlite3"


class Database:
    def __init__(self, path: Path = DB_PATH) -> None:
        self.path = path
        self._lock = Lock()

    @contextmanager
    def connect(self):
        with self._lock:
            connection = sqlite3.connect(self.path)
            connection.row_factory = sqlite3.Row
            try:
                yield connection
                connection.commit()
            finally:
                connection.close()

    def initialize(self) -> None:
        with self.connect() as connection:
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS routine_tasks (
                    name TEXT PRIMARY KEY,
                    task_type TEXT NOT NULL,
                    python_code TEXT NOT NULL,
                    jsx_code TEXT NOT NULL,
                    is_paused INTEGER NOT NULL DEFAULT 0,
                    status TEXT NOT NULL DEFAULT 'idle',
                    last_error TEXT,
                    next_run_at TEXT,
                    requested_next_run_at TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
                """
            )
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS memory_palaces (
                    name TEXT PRIMARY KEY,
                    description TEXT NOT NULL DEFAULT '',
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
                """
            )
