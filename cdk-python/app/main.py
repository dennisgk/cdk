from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response

from .config import get_config, load_config
from .db import BASE_DIR
from .db import Database
from .memory_palaces import MemoryPalaceManager, MemoryPalaceStore
from .pipelines import PipelineManager, RoutineTaskPipelineFacade
from .routine_tasks import RoutineTaskManager, RoutineTaskStore
from .schemas import (
    AuthenticatedUser,
    LoginRequest,
    MemoryPalaceCreate,
    MemoryPalaceListItem,
    MemoryPalaceRecord,
    MemoryPalaceUpdate,
    RoutineTaskCreate,
    RoutineTaskListItem,
    RoutineTaskRecord,
    RoutineTaskUpdate,
    TokenResponse,
)
from .security import create_access_token, get_current_subject, verify_password

config = load_config()
database = Database()
pipeline_manager = PipelineManager(config)
routine_task_manager = RoutineTaskManager(
    RoutineTaskStore(database),
    RoutineTaskPipelineFacade(pipeline_manager),
    config,
)
memory_palace_manager = MemoryPalaceManager(MemoryPalaceStore(database))
STATIC_DIR = BASE_DIR / "static"


@asynccontextmanager
async def lifespan(_: FastAPI):
    await pipeline_manager.startup()
    memory_palace_manager.startup()
    await routine_task_manager.startup()
    try:
        yield
    finally:
        await routine_task_manager.shutdown()
        await pipeline_manager.shutdown()


app = FastAPI(title="CDK API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=config.cors_allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health_check() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/auth/login", response_model=TokenResponse)
def login(payload: LoginRequest, config=Depends(get_config)) -> TokenResponse:
    if config.password is not None:
        is_valid = payload.password == config.password
    else:
        is_valid = verify_password(payload.password, config.password_hash or "")

    if not is_valid:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid password.",
        )

    access_token, expires_at = create_access_token(config)
    return TokenResponse(access_token=access_token, expires_at=expires_at)


@app.get("/api/auth/me", response_model=AuthenticatedUser)
def read_current_user(subject: str = Depends(get_current_subject)) -> AuthenticatedUser:
    return AuthenticatedUser(subject=subject)


@app.get("/api/pipelines")
def get_pipeline_telemetry(_: str = Depends(get_current_subject)) -> dict:
    return pipeline_manager.telemetry()


@app.get("/api/memory-palaces", response_model=list[MemoryPalaceListItem])
def list_memory_palaces(
    _: str = Depends(get_current_subject),
) -> list[MemoryPalaceListItem]:
    return memory_palace_manager.list_memory_palaces()


@app.post("/api/memory-palaces", response_model=MemoryPalaceRecord)
def create_memory_palace(
    payload: MemoryPalaceCreate,
    _: str = Depends(get_current_subject),
) -> MemoryPalaceRecord:
    return memory_palace_manager.create_memory_palace(payload)


@app.get("/api/memory-palaces/{name}", response_model=MemoryPalaceRecord)
def get_memory_palace(
    name: str,
    _: str = Depends(get_current_subject),
) -> MemoryPalaceRecord:
    return memory_palace_manager.get_memory_palace(name)


@app.put("/api/memory-palaces/{name}", response_model=MemoryPalaceRecord)
def update_memory_palace(
    name: str,
    payload: MemoryPalaceUpdate,
    _: str = Depends(get_current_subject),
) -> MemoryPalaceRecord:
    return memory_palace_manager.update_memory_palace(name, payload)


@app.delete("/api/memory-palaces/{name}", status_code=status.HTTP_204_NO_CONTENT)
def delete_memory_palace(
    name: str,
    _: str = Depends(get_current_subject),
) -> Response:
    memory_palace_manager.delete_memory_palace(name)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@app.get("/api/routine-tasks", response_model=list[RoutineTaskListItem])
def list_routine_tasks(
    _: str = Depends(get_current_subject),
) -> list[RoutineTaskListItem]:
    return routine_task_manager.list_tasks()


@app.post("/api/routine-tasks", response_model=RoutineTaskRecord)
async def create_routine_task(
    payload: RoutineTaskCreate,
    _: str = Depends(get_current_subject),
) -> RoutineTaskRecord:
    return await routine_task_manager.create_task(payload)


@app.get("/api/routine-tasks/{name}", response_model=RoutineTaskRecord)
def get_routine_task(
    name: str,
    _: str = Depends(get_current_subject),
) -> RoutineTaskRecord:
    return routine_task_manager.get_task(name)


@app.put("/api/routine-tasks/{name}", response_model=RoutineTaskRecord)
async def update_routine_task(
    name: str,
    payload: RoutineTaskUpdate,
    _: str = Depends(get_current_subject),
) -> RoutineTaskRecord:
    return await routine_task_manager.update_task(name, payload)


@app.delete("/api/routine-tasks/{name}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_routine_task(
    name: str,
    _: str = Depends(get_current_subject),
) -> Response:
    await routine_task_manager.delete_task(name)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@app.post("/api/routine-tasks/{name}/pause", response_model=RoutineTaskRecord)
async def pause_routine_task(
    name: str,
    _: str = Depends(get_current_subject),
) -> RoutineTaskRecord:
    return await routine_task_manager.pause_task(name)


@app.post("/api/routine-tasks/{name}/resume", response_model=RoutineTaskRecord)
async def resume_routine_task(
    name: str,
    _: str = Depends(get_current_subject),
) -> RoutineTaskRecord:
    return await routine_task_manager.resume_task(name)


@app.api_route(
    "/api/routine-tasks/{name}/remote/{remote_path:path}",
    methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
)
@app.api_route(
    "/api/routine-tasks/{name}/remote",
    methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
)
async def call_routine_task_remote_handler(
    name: str,
    request: Request,
    remote_path: str = "",
    subject: str = Depends(get_current_subject),
) -> Response:
    return await routine_task_manager.call_remote_handler(
        name,
        request,
        subject,
        remote_path,
    )


@app.get("/{full_path:path}", include_in_schema=False)
async def serve_frontend(full_path: str) -> Response:
    if not STATIC_DIR.exists():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Static app not found.")

    static_root = STATIC_DIR.resolve()
    requested = (STATIC_DIR / full_path).resolve()

    if not str(requested).startswith(str(static_root)):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found.")

    if full_path and requested.is_file():
        return FileResponse(requested)

    index_path = STATIC_DIR / "index.html"
    if index_path.is_file():
        return FileResponse(index_path)

    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="index.html not found.")
