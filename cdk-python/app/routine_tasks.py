from __future__ import annotations

import asyncio
import ast
import shutil
import traceback
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Awaitable, Callable, Literal

from fastapi import HTTPException, Request, status
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse, Response

from .config import AppConfig
from .db import BASE_DIR, Database
from .pipelines import RoutineTaskPipelineFacade
from .schemas import (
    RoutineTaskCreate,
    RoutineTaskListItem,
    RoutineTaskRecord,
    RoutineTaskUpdate,
)

TASKS_DATA_DIR = BASE_DIR / "data" / "routine_tasks"
ROUTINE_TASK_FUNCTION_SIGNATURES: dict[str, list[str]] = {
    "next_datetime": ["data_dir", "data_obj", "active_relatives"],
    "runner": ["data_dir", "data_obj"],
    "pause": ["data_dir", "data_obj"],
    "resume": ["data_dir", "data_obj"],
    "unload": ["data_dir", "data_obj"],
    "remote_handler": [
        "data_dir",
        "data_obj",
        "set_next_datetime",
        "request",
        "subject",
        "body",
        "query",
        "method",
        "path_params",
        "remote_path",
    ],
}


@dataclass
class CompiledRoutineTask:
    task_type: Literal["NEXT_DATETIME_RUNNER"]
    next_datetime: Callable[[Path, dict[str, Any], dict[str, Any]], Awaitable[datetime]]
    runner: Callable[[Path, dict[str, Any]], Awaitable[Any]]
    pause: Callable[[Path, dict[str, Any]], Awaitable[Any]]
    resume: Callable[[Path, dict[str, Any]], Awaitable[Any]]
    unload: Callable[[Path, dict[str, Any]], Awaitable[Any]]
    remote_handler: Callable[..., Awaitable[Any]]


def now_utc() -> datetime:
    return datetime.now(UTC)


def serialize_datetime(value: datetime | None) -> str | None:
    return value.astimezone(UTC).isoformat() if value is not None else None


def parse_datetime(value: str | None) -> datetime | None:
    if value is None:
        return None
    return datetime.fromisoformat(value)


def normalize_datetime(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def task_data_dir(name: str) -> Path:
    return TASKS_DATA_DIR / name


def raise_validation_error(errors: list[str]) -> None:
    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail={
            "message": "Routine task Python validation failed.",
            "errors": errors,
        },
    )


def validate_routine_task_code(code: str) -> None:
    try:
        module = ast.parse(code)
    except SyntaxError as exc:
        line = exc.lineno or "?"
        column = exc.offset or "?"
        message = exc.msg or "invalid syntax"
        raise_validation_error([f"Syntax error at line {line}, column {column}: {message}."])

    task_type_value: str | None = None
    async_functions: dict[str, ast.AsyncFunctionDef] = {}

    for node in module.body:
        if isinstance(node, ast.Assign):
            for target in node.targets:
                if isinstance(target, ast.Name) and target.id == "TASK_TYPE":
                    if isinstance(node.value, ast.Constant) and isinstance(
                        node.value.value,
                        str,
                    ):
                        task_type_value = node.value.value
                    else:
                        task_type_value = None
        elif isinstance(node, ast.AsyncFunctionDef):
            async_functions[node.name] = node

    errors: list[str] = []

    if task_type_value != "NEXT_DATETIME_RUNNER":
        errors.append('TASK_TYPE must be assigned to "NEXT_DATETIME_RUNNER".')

    for function_name, expected_parameters in ROUTINE_TASK_FUNCTION_SIGNATURES.items():
        node = async_functions.get(function_name)
        if node is None:
            errors.append(f"{function_name} must be defined as an async function.")
            continue

        actual_parameters = [argument.arg for argument in node.args.args]
        if actual_parameters != expected_parameters:
            errors.append(
                f"{function_name} at line {node.lineno} must have signature "
                f"({', '.join(expected_parameters)}); got "
                f"({', '.join(actual_parameters)})."
            )

        if node.args.posonlyargs:
            errors.append(
                f"{function_name} at line {node.lineno} cannot use positional-only parameters."
            )
        if node.args.kwonlyargs:
            errors.append(
                f"{function_name} at line {node.lineno} cannot use keyword-only parameters."
            )
        if node.args.vararg is not None:
            errors.append(
                f"{function_name} at line {node.lineno} cannot use *args."
            )
        if node.args.kwarg is not None:
            errors.append(
                f"{function_name} at line {node.lineno} cannot use **kwargs."
            )

    if errors:
        raise_validation_error(errors)


def compile_routine_task(
    code: str,
    pipelines: RoutineTaskPipelineFacade,
    config_data: dict[str, Any],
) -> CompiledRoutineTask:
    validate_routine_task_code(code)

    namespace: dict[str, Any] = {
        "__builtins__": __builtins__,
        "asyncio": asyncio,
        "datetime": datetime,
        "UTC": UTC,
        "Path": Path,
        "PIPELINES": pipelines,
        "CONFIG": config_data,
    }
    try:
        exec(code, namespace, namespace)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Failed to compile routine task Python: {exc.__class__.__name__}: {exc}",
        ) from exc

    return CompiledRoutineTask(
        task_type=namespace["TASK_TYPE"],
        next_datetime=namespace["next_datetime"],
        runner=namespace["runner"],
        pause=namespace["pause"],
        resume=namespace["resume"],
        unload=namespace["unload"],
        remote_handler=namespace["remote_handler"],
    )


class RoutineTaskStore:
    def __init__(self, database: Database) -> None:
        self.database = database

    def list_tasks(self) -> list[RoutineTaskRecord]:
        with self.database.connect() as connection:
            rows = connection.execute(
                """
                SELECT name, task_type, python_code, jsx_code, is_paused, status,
                       last_error, next_run_at, requested_next_run_at, created_at, updated_at
                FROM routine_tasks
                ORDER BY name
                """
            ).fetchall()
        return [self._row_to_record(row) for row in rows]

    def get_task(self, name: str) -> RoutineTaskRecord | None:
        with self.database.connect() as connection:
            row = connection.execute(
                """
                SELECT name, task_type, python_code, jsx_code, is_paused, status,
                       last_error, next_run_at, requested_next_run_at, created_at, updated_at
                FROM routine_tasks
                WHERE name = ?
                """,
                (name,),
            ).fetchone()
        return self._row_to_record(row) if row else None

    def create_task(
        self,
        payload: RoutineTaskCreate,
        task_type: str,
        is_paused: bool,
        status_value: str,
        next_run_at: datetime | None,
    ) -> RoutineTaskRecord:
        created_at = now_utc()
        with self.database.connect() as connection:
            try:
                connection.execute(
                    """
                    INSERT INTO routine_tasks (
                        name, task_type, python_code, jsx_code, is_paused, status,
                        last_error, next_run_at, requested_next_run_at, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, NULL, ?, ?)
                    """,
                    (
                        payload.name,
                        task_type,
                        payload.python_code,
                        payload.jsx_code,
                        1 if is_paused else 0,
                        status_value,
                        serialize_datetime(next_run_at),
                        created_at.isoformat(),
                        created_at.isoformat(),
                    ),
                )
            except Exception as exc:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=f'Routine task "{payload.name}" already exists.',
                ) from exc
        record = self.get_task(payload.name)
        assert record is not None
        return record

    def replace_task(
        self,
        previous_name: str,
        payload: RoutineTaskUpdate,
        task_type: str,
        is_paused: bool,
        status_value: str,
        next_run_at: datetime | None,
    ) -> RoutineTaskRecord:
        created_at = self.get_task(previous_name)
        if created_at is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f'Routine task "{previous_name}" was not found.',
            )

        updated_at = now_utc()
        with self.database.connect() as connection:
            if payload.name != previous_name:
                exists = connection.execute(
                    "SELECT 1 FROM routine_tasks WHERE name = ?",
                    (payload.name,),
                ).fetchone()
                if exists:
                    raise HTTPException(
                        status_code=status.HTTP_409_CONFLICT,
                        detail=f'Routine task "{payload.name}" already exists.',
                    )

            connection.execute(
                """
                UPDATE routine_tasks
                SET name = ?, task_type = ?, python_code = ?, jsx_code = ?,
                    is_paused = ?, status = ?, last_error = NULL,
                    next_run_at = ?, requested_next_run_at = NULL, updated_at = ?
                WHERE name = ?
                """,
                (
                    payload.name,
                    task_type,
                    payload.python_code,
                    payload.jsx_code,
                    1 if is_paused else 0,
                    status_value,
                    serialize_datetime(next_run_at),
                    updated_at.isoformat(),
                    previous_name,
                ),
            )

        record = self.get_task(payload.name)
        assert record is not None
        return record.model_copy(update={"created_at": created_at.created_at})

    def delete_task(self, name: str) -> None:
        with self.database.connect() as connection:
            connection.execute("DELETE FROM routine_tasks WHERE name = ?", (name,))

    def update_runtime_state(
        self,
        name: str,
        *,
        is_paused: bool | None = None,
        status_value: str | None = None,
        last_error: str | None = None,
        next_run_at: datetime | None = None,
        requested_next_run_at: datetime | None | object = ...,
    ) -> None:
        record = self.get_task(name)
        if record is None:
            return

        with self.database.connect() as connection:
            connection.execute(
                """
                UPDATE routine_tasks
                SET is_paused = ?, status = ?, last_error = ?, next_run_at = ?, requested_next_run_at = ?, updated_at = ?
                WHERE name = ?
                """,
                (
                    1 if (record.is_paused if is_paused is None else is_paused) else 0,
                    status_value if status_value is not None else record.status,
                    last_error,
                    serialize_datetime(next_run_at),
                    (
                        serialize_datetime(record.requested_next_run_at)
                        if requested_next_run_at is ...
                        else serialize_datetime(requested_next_run_at)
                    ),
                    now_utc().isoformat(),
                    name,
                ),
            )

    @staticmethod
    def _row_to_record(row) -> RoutineTaskRecord:
        return RoutineTaskRecord(
            name=row["name"],
            task_type=row["task_type"],
            python_code=row["python_code"],
            jsx_code=row["jsx_code"],
            is_paused=bool(row["is_paused"]),
            status=row["status"],
            last_error=row["last_error"],
            next_run_at=parse_datetime(row["next_run_at"]),
            requested_next_run_at=parse_datetime(row["requested_next_run_at"]),
            created_at=parse_datetime(row["created_at"]) or now_utc(),
            updated_at=parse_datetime(row["updated_at"]) or now_utc(),
        )


class RoutineTaskManager:
    def __init__(
        self,
        store: RoutineTaskStore,
        pipelines: RoutineTaskPipelineFacade,
        config: AppConfig,
    ) -> None:
        self.store = store
        self.pipelines = pipelines
        self.config_data = config.model_dump()
        self._loop_tasks: dict[str, asyncio.Task[None]] = {}
        self._runner_active: dict[str, bool] = {}
        self._task_data_objects: dict[str, dict[str, Any]] = {}
        self._wake_events: dict[str, asyncio.Event] = {}

    async def startup(self) -> None:
        TASKS_DATA_DIR.mkdir(parents=True, exist_ok=True)
        self.store.database.initialize()
        for record in self.store.list_tasks():
            data_dir = task_data_dir(record.name)
            data_dir.mkdir(parents=True, exist_ok=True)
            self._task_data_objects[record.name] = {}
            definition = compile_routine_task(
                record.python_code,
                self.pipelines,
                self.config_data,
            )
            try:
                if record.is_paused:
                    await definition.pause(data_dir, self._task_data_objects[record.name])
                    self.store.update_runtime_state(
                        record.name,
                        is_paused=True,
                        status_value="paused",
                        next_run_at=None,
                        requested_next_run_at=record.requested_next_run_at,
                        last_error=None,
                    )
                else:
                    await definition.resume(data_dir, self._task_data_objects[record.name])
                    self.store.update_runtime_state(
                        record.name,
                        is_paused=False,
                        status_value="scheduled",
                        next_run_at=None,
                        requested_next_run_at=record.requested_next_run_at,
                        last_error=None,
                    )
                    self._start_loop(record.name)
            except Exception as exc:
                self.store.update_runtime_state(
                    record.name,
                    status_value="error",
                    next_run_at=None,
                    last_error=str(exc),
                )

    async def shutdown(self) -> None:
        for task in self._loop_tasks.values():
            task.cancel()
        await asyncio.gather(*self._loop_tasks.values(), return_exceptions=True)
        self._loop_tasks.clear()
        self._task_data_objects.clear()
        self._wake_events.clear()

    def list_tasks(self) -> list[RoutineTaskListItem]:
        return [
            RoutineTaskListItem(
                name=record.name,
                task_type=record.task_type,
                is_paused=record.is_paused,
                status=record.status,
                last_error=record.last_error,
                next_run_at=record.next_run_at,
                requested_next_run_at=record.requested_next_run_at,
                updated_at=record.updated_at,
            )
            for record in self.store.list_tasks()
        ]

    def get_task(self, name: str) -> RoutineTaskRecord:
        record = self.store.get_task(name)
        if record is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f'Routine task "{name}" was not found.',
            )
        return record

    def _get_task_data_obj(self, name: str) -> dict[str, Any]:
        data_obj = self._task_data_objects.get(name)
        if data_obj is None:
            data_obj = {}
            self._task_data_objects[name] = data_obj
        return data_obj

    def _get_wake_event(self, name: str) -> asyncio.Event:
        event = self._wake_events.get(name)
        if event is None:
            event = asyncio.Event()
            self._wake_events[name] = event
        return event

    async def _set_requested_next_run_at(
        self,
        name: str,
        next_run_at: datetime | None,
    ) -> None:
        record = self.get_task(name)
        normalized = normalize_datetime(next_run_at) if next_run_at is not None else None
        self.store.update_runtime_state(
            name,
            is_paused=record.is_paused,
            status_value=record.status,
            last_error=record.last_error,
            next_run_at=record.next_run_at,
            requested_next_run_at=normalized,
        )
        self._get_wake_event(name).set()

    async def create_task(self, payload: RoutineTaskCreate) -> RoutineTaskRecord:
        definition = compile_routine_task(
            payload.python_code,
            self.pipelines,
            self.config_data,
        )
        data_dir = task_data_dir(payload.name)
        data_dir.mkdir(parents=True, exist_ok=True)
        data_obj: dict[str, Any] = {}

        try:
            record = self.store.create_task(
                payload,
                definition.task_type,
                payload.start_paused,
                "paused" if payload.start_paused else "scheduled",
                None,
            )
            if payload.start_paused:
                await definition.pause(data_dir, data_obj)
            else:
                await definition.resume(data_dir, data_obj)
                self._start_loop(record.name)
            self._task_data_objects[record.name] = data_obj
        except HTTPException:
            raise
        except Exception as exc:
            self.store.delete_task(payload.name)
            self._task_data_objects.pop(payload.name, None)
            if data_dir.exists():
                shutil.rmtree(data_dir, ignore_errors=True)
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Failed to create routine task: {exc}",
            ) from exc

        return self.get_task(record.name)

    async def update_task(
        self,
        previous_name: str,
        payload: RoutineTaskUpdate,
    ) -> RoutineTaskRecord:
        existing = self.get_task(previous_name)
        previous_definition = compile_routine_task(
            existing.python_code,
            self.pipelines,
            self.config_data,
        )
        definition = compile_routine_task(
            payload.python_code,
            self.pipelines,
            self.config_data,
        )

        previous_data_dir = task_data_dir(previous_name)
        next_data_dir = task_data_dir(payload.name)
        previous_data_dir.mkdir(parents=True, exist_ok=True)
        data_obj = self._get_task_data_obj(previous_name)
        self._cancel_loop(previous_name)

        try:
            await previous_definition.pause(previous_data_dir, data_obj)
            await previous_definition.unload(previous_data_dir, data_obj)
            if previous_name != payload.name:
                self._task_data_objects.pop(previous_name, None)
                self._task_data_objects[payload.name] = data_obj
                if next_data_dir.exists():
                    shutil.rmtree(next_data_dir, ignore_errors=True)
                if previous_data_dir.exists():
                    shutil.move(str(previous_data_dir), str(next_data_dir))
            else:
                next_data_dir.mkdir(parents=True, exist_ok=True)
            if payload.paused:
                await definition.pause(next_data_dir, data_obj)
                record = self.store.replace_task(
                    previous_name,
                    payload,
                    definition.task_type,
                    True,
                    "paused",
                    None,
                )
            else:
                await definition.resume(next_data_dir, data_obj)
                record = self.store.replace_task(
                    previous_name,
                    payload,
                    definition.task_type,
                    False,
                    "scheduled",
                    None,
                )
                self._start_loop(record.name)
        except HTTPException:
            raise
        except Exception as exc:
            if previous_name != payload.name:
                self._task_data_objects.pop(payload.name, None)
                self._task_data_objects[previous_name] = data_obj
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Failed to update routine task: {exc}",
            ) from exc

        return self.get_task(record.name)

    async def delete_task(self, name: str) -> None:
        record = self.get_task(name)
        data_dir = task_data_dir(name)
        self._cancel_loop(name)
        definition = compile_routine_task(
            record.python_code,
            self.pipelines,
            self.config_data,
        )
        data_obj = self._get_task_data_obj(name)
        await definition.pause(data_dir, data_obj)
        await definition.unload(data_dir, data_obj)
        if data_dir.exists():
            shutil.rmtree(data_dir, ignore_errors=True)
        self._task_data_objects.pop(name, None)
        self._wake_events.pop(name, None)
        self.store.delete_task(name)

    async def pause_task(self, name: str) -> RoutineTaskRecord:
        record = self.get_task(name)
        if record.is_paused:
            return record

        definition = compile_routine_task(
            record.python_code,
            self.pipelines,
            self.config_data,
        )
        self._cancel_loop(name)
        data_obj = self._get_task_data_obj(name)
        await definition.pause(task_data_dir(name), data_obj)
        self.store.update_runtime_state(
            name,
            is_paused=True,
            status_value="paused",
            next_run_at=None,
            requested_next_run_at=None,
            last_error=None,
        )
        return self.get_task(name)

    async def resume_task(self, name: str) -> RoutineTaskRecord:
        record = self.get_task(name)
        if not record.is_paused:
            return record

        definition = compile_routine_task(
            record.python_code,
            self.pipelines,
            self.config_data,
        )
        data_obj = self._get_task_data_obj(name)
        await definition.resume(task_data_dir(name), data_obj)
        self.store.update_runtime_state(
            name,
            is_paused=False,
            status_value="scheduled",
            next_run_at=None,
            requested_next_run_at=None,
            last_error=None,
        )
        self._start_loop(name)
        return self.get_task(name)

    async def call_remote_handler(
        self,
        name: str,
        request: Request,
        subject: str,
        remote_path: str,
    ) -> Response:
        record = self.get_task(name)
        definition = compile_routine_task(
            record.python_code,
            self.pipelines,
            self.config_data,
        )
        body = await self._read_request_body(request)
        data_obj = self._get_task_data_obj(name)
        result = await definition.remote_handler(
            task_data_dir(name),
            data_obj,
            lambda value: self._set_requested_next_run_at(name, value),
            request,
            subject,
            body,
            dict(request.query_params),
            request.method,
            dict(request.path_params),
            remote_path,
        )
        if isinstance(result, Response):
            return result
        return JSONResponse(jsonable_encoder(result))

    async def _read_request_body(self, request: Request) -> Any:
        try:
            return await request.json()
        except Exception:
            raw = await request.body()
            return raw.decode("utf-8") if raw else None

    def _start_loop(self, name: str) -> None:
        self._cancel_loop(name)
        self._loop_tasks[name] = asyncio.create_task(self._task_loop(name))

    def _cancel_loop(self, name: str) -> None:
        existing = self._loop_tasks.pop(name, None)
        if existing:
            existing.cancel()
        event = self._wake_events.get(name)
        if event is not None:
            event.set()

    async def _task_loop(self, name: str) -> None:
        while True:
            record = self.store.get_task(name)
            if record is None or record.is_paused:
                return

            definition = compile_routine_task(
                record.python_code,
                self.pipelines,
                self.config_data,
            )
            active_relatives = {
                task_name: running
                for task_name, running in self._runner_active.items()
                if task_name != name
            }
            data_obj = self._get_task_data_obj(name)
            wake_event = self._get_wake_event(name)
            wake_event.clear()

            try:
                computed_next_run_at = normalize_datetime(
                    await definition.next_datetime(
                        task_data_dir(name),
                        data_obj,
                        active_relatives,
                    )
                )
                record = self.get_task(name)
                requested_next_run_at = record.requested_next_run_at
                next_run_at = (
                    requested_next_run_at
                    if requested_next_run_at is not None
                    else computed_next_run_at
                )
                delay = max((next_run_at - now_utc()).total_seconds(), 0)
                self.store.update_runtime_state(
                    name,
                    is_paused=False,
                    status_value="scheduled",
                    next_run_at=next_run_at,
                    requested_next_run_at=None,
                    last_error=None,
                )
                if delay > 0:
                    try:
                        await asyncio.wait_for(wake_event.wait(), timeout=delay)
                        if wake_event.is_set():
                            continue
                    except TimeoutError:
                        pass
                self._runner_active[name] = True
                self.store.update_runtime_state(
                    name,
                    status_value="running",
                    next_run_at=next_run_at,
                    requested_next_run_at=None,
                    last_error=None,
                )
                await definition.runner(task_data_dir(name), data_obj)
                self.store.update_runtime_state(
                    name,
                    status_value="idle",
                    next_run_at=None,
                    requested_next_run_at=None,
                    last_error=None,
                )
            except asyncio.CancelledError:
                self.store.update_runtime_state(
                    name,
                    status_value="paused",
                    next_run_at=None,
                    requested_next_run_at=None,
                    last_error=None,
                )
                raise
            except Exception as exc:
                traceback_text = traceback.format_exc()
                print(f'Routine task "{name}" failed during scheduled execution:')
                print(traceback_text, end="" if traceback_text.endswith("\n") else "\n")
                try:
                    await definition.pause(task_data_dir(name), data_obj)
                except Exception:
                    print(f'Routine task "{name}" also failed while pausing after the execution error:')
                    traceback.print_exc()
                self.store.update_runtime_state(
                    name,
                    is_paused=True,
                    status_value="paused",
                    next_run_at=None,
                    requested_next_run_at=None,
                    last_error=traceback_text,
                )
                return
            finally:
                self._runner_active[name] = False
