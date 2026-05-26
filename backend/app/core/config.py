"""Application settings.

Settings are loaded once at import time via :func:`get_settings` and cached.
All runtime configuration MUST live here — never read ``os.environ`` directly
from feature code.
"""

from __future__ import annotations

import subprocess
from functools import lru_cache
from typing import Annotated, Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


class Settings(BaseSettings):
    """Top-level settings model.

    Values are sourced (highest precedence first) from:

    1. process environment variables
    2. ``backend/.env`` (only in non-production)
    3. defaults declared in this class
    """

    database_url: str = Field(
        ...,
        description=("Async SQLAlchemy URL, e.g. ``postgresql+asyncpg://user:pass@host:5432/db``."),
    )
    redis_url: str = Field("redis://localhost:6379/0")
    secret_key: str = Field(..., min_length=16)
    log_level: str = Field("INFO")
    environment: Literal["dev", "test", "prod"] = "dev"
    cors_allowed_origins: Annotated[list[str], NoDecode] = Field(
        default_factory=lambda: ["http://localhost:3000"],
    )
    otel_endpoint: str | None = None
    commit_sha: str | None = None

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    @field_validator("cors_allowed_origins", mode="before")
    @classmethod
    def _split_csv(cls, raw: object) -> object:
        """Accept either a JSON-style list or a plain comma-separated string."""
        if isinstance(raw, str):
            stripped = raw.strip()
            if stripped.startswith("["):
                import json

                return json.loads(stripped)
            return [item.strip() for item in stripped.split(",") if item.strip()]
        return raw

    @property
    def resolved_commit_sha(self) -> str:
        """Return ``commit_sha`` if explicitly set, otherwise probe ``git``.

        Falls back to ``"unknown"`` so that the health endpoint always has a
        non-empty string to return.
        """
        if self.commit_sha:
            return self.commit_sha
        try:
            return (
                subprocess.check_output(
                    ["git", "rev-parse", "--short=12", "HEAD"],
                    stderr=subprocess.DEVNULL,
                )
                .decode()
                .strip()
            )
        except Exception:  # noqa: BLE001 — best-effort fallback
            return "unknown"


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Return the process-wide ``Settings`` singleton."""
    return Settings()
