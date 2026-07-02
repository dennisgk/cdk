from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


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
