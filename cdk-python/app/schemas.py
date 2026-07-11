from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator


class LoginRequest(BaseModel):
    password: str = Field(min_length=1)


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_at: datetime


class AuthenticatedUser(BaseModel):
    subject: str


class MemoryPalaceBase(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    description: str = ""

    @field_validator("name")
    @classmethod
    def validate_name(cls, value: str) -> str:
        # The name doubles as the palace's directory name on disk.
        stripped = value.strip()
        if not stripped:
            raise ValueError("Name must not be blank.")
        if any(character in stripped for character in ("/", "\\", "\x00")):
            raise ValueError("Name must not contain path separators.")
        if stripped.startswith("."):
            raise ValueError("Name must not start with a dot.")
        return stripped


class MemoryPalaceCreate(MemoryPalaceBase):
    pass


class MemoryPalaceUpdate(MemoryPalaceBase):
    pass


class MemoryPalaceRecord(MemoryPalaceBase):
    created_at: datetime
    updated_at: datetime


class MemoryPalaceListItem(MemoryPalaceBase):
    created_at: datetime
    updated_at: datetime


class MemoryPalaceAssetInfo(BaseModel):
    asset_id: str
    file_name: str
    format: Literal["stl", "glb", "fbx"]


class RoutineTaskBase(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    python_code: str = Field(min_length=1)
    jsx_code: str = Field(min_length=1)


class RoutineTaskCreate(RoutineTaskBase):
    start_paused: bool = False


class RoutineTaskUpdate(RoutineTaskBase):
    paused: bool


class RoutineTaskRecord(BaseModel):
    name: str
    task_type: Literal["NEXT_DATETIME_RUNNER"]
    python_code: str
    jsx_code: str
    is_paused: bool
    status: str
    last_error: str | None
    next_run_at: datetime | None
    requested_next_run_at: datetime | None = None
    created_at: datetime
    updated_at: datetime


class RoutineTaskListItem(BaseModel):
    name: str
    task_type: Literal["NEXT_DATETIME_RUNNER"]
    is_paused: bool
    status: str
    last_error: str | None
    next_run_at: datetime | None
    requested_next_run_at: datetime | None = None
    updated_at: datetime
