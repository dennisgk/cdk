from __future__ import annotations

import json
from pathlib import Path

from pydantic import BaseModel, Field, model_validator

BASE_DIR = Path(__file__).resolve().parent.parent
CONFIG_PATH = BASE_DIR / "config.json"


class LlmConfig(BaseModel):
    host: str = "https://vllm.kountouris.org"
    api_key: str = ""
    model: str = "Qwen/Qwen3.5-4B"


class PipelineConfig(BaseModel):
    name: str
    category: str
    max_concurrency: int = Field(default=1, ge=1)
    description: str


class AppConfig(BaseModel):
    jwt_secret: str = Field(min_length=16)
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = Field(default=480, ge=1)
    password_hash: str | None = Field(default=None, min_length=20)
    password: str | None = Field(default=None, min_length=1)
    cors_allowed_origins: list[str] = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ]
    llm: LlmConfig = Field(default_factory=LlmConfig)
    pipelines: list[PipelineConfig] = Field(
        default_factory=lambda: [
            PipelineConfig(
                name="gpu_heavy",
                category="gpu_or_heavy_compute",
                max_concurrency=1,
                description="Serialized queue for vLLM and other heavy CPU/GPU workloads.",
            )
        ]
    )

    @model_validator(mode="after")
    def validate_password_source(self) -> "AppConfig":
        if not self.password and not self.password_hash:
            raise ValueError("config.json must define either password or password_hash.")
        return self


def load_config(path: Path = CONFIG_PATH) -> AppConfig:
    with path.open("r", encoding="utf-8") as config_file:
        raw_config = json.load(config_file)

    return AppConfig.model_validate(raw_config)


def get_config() -> AppConfig:
    return load_config()
