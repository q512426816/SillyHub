"""Application settings.

Settings are loaded once at import time via :func:`get_settings` and cached.
All runtime configuration MUST live here — never read ``os.environ`` directly
from feature code.
"""

from __future__ import annotations

import subprocess
import sys
from functools import lru_cache
from typing import Annotated, Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

from app.core.paths import resolve_spec_data_root


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

    # ── Auth (task-04a) ────────────────────────────────────────────────
    auth_access_ttl_minutes: int = Field(15, ge=1, le=24 * 60)
    auth_refresh_ttl_days: int = Field(14, ge=1, le=90)
    auth_bcrypt_rounds: int = Field(12, ge=4, le=15)
    platform_bootstrap_admin_email: str | None = None
    platform_bootstrap_admin_password: str | None = Field(default=None, min_length=8)
    platform_bootstrap_admin_display_name: str | None = None

    # ── Worktree (task-10) ─────────────────────────────────────────────
    worktree_base_dir: str = Field(
        default=(
            "C:/data/sillyspec-workspaces"
            if sys.platform == "win32"
            else "/data/sillyspec-workspaces"
        ),
        description="Root directory for worktree lease filesystem trees.",
    )

    # ── Spec data root (platform-managed spec storage) ─────────────────
    spec_data_root: str = Field(
        default=("C:/data/sillyspec-data" if sys.platform == "win32" else "/data/sillyspec-data"),
        description="Root directory for platform-managed spec storage. "
        "Relative paths are resolved against the repo root, not CWD.",
    )

    # ── Spec data host dir (host filesystem path for daemon/agent prompts) ─
    # 方案 B（D-001@v1 调整）：backend 生成 scan/stage prompt 时用此宿主路径，
    # daemon 零客户端配置（不依赖 SPEC_ROOT_MAP）。SPEC_DATA_ROOT 是容器内路径，
    # 通过 docker bind mount 映射到此宿主路径（物理同一目录）。
    spec_data_host_dir: str = Field(
        default=("C:/data/spec-workspaces" if sys.platform == "win32" else "/data/spec-workspaces"),
        description="Host filesystem path for spec storage, passed to daemon/agent in scan/stage "
        "prompts. SPEC_DATA_ROOT is the in-container path bind-mounted to this host path.",
    )

    @field_validator("spec_data_root", mode="before")
    @classmethod
    def _resolve_spec_data_root(cls, raw: object) -> object:
        """Resolve relative paths against the repo root."""
        if isinstance(raw, str):
            return resolve_spec_data_root(raw)
        return raw

    # ── Docker path mapping ────────────────────────────────────────────
    host_path_prefix: str = Field(
        default="",
        description="Host filesystem prefix (e.g. C:/Users/qinyi/IdeaProjects). "
        "When running in Docker, this is rewritten to container_path_prefix.",
    )
    container_path_prefix: str = Field(
        default="",
        description="Container mount point that maps to host_path_prefix (e.g. /host-projects).",
    )

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
        except Exception:
            return "unknown"


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Return the process-wide ``Settings`` singleton."""
    return Settings()
