"""Application settings.

Settings are loaded once at import time via :func:`get_settings` and cached.
All runtime configuration MUST live here — never read ``os.environ`` directly
from feature code.
"""

from __future__ import annotations

import subprocess
import sys
from functools import lru_cache
from pathlib import Path
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
    # Daemon distribution files (install.sh + sillyhub-daemon.js) baked into
    # the backend image; override to a tmp_path in tests.
    daemon_dist_dir: Path = Path("/app/daemon-dist")

    # ── Auth (task-04a) ────────────────────────────────────────────────
    auth_access_ttl_minutes: int = Field(
        30,
        ge=1,
        le=24 * 60,
        description="Access token 有效期(分钟)。默认 30min(D-003@v1:15→30,降低 401 刷新频率)。",
    )
    auth_refresh_ttl_days: int = Field(14, ge=1, le=90)
    auth_refresh_grace_seconds: int = Field(
        60,
        ge=0,
        le=600,
        description=(
            "Refresh token 轮换宽限窗口(秒)。rotate 后窗口内重复提交换新而非 revoke_all"
            "(并发刷新误杀兜底)。0=退化为旧行为。D-002@v1。"
        ),
    )
    auth_bcrypt_rounds: int = Field(12, ge=4, le=15)
    auth_api_key_last_used_throttle_seconds: int = Field(
        60,
        ge=0,
        description=(
            "API key last_used_at 写入节流窗口(秒)。同一 key 在窗口内重复认证"
            "跳过 last_used_at UPDATE,避免每请求写同一行导致行锁串行化雪崩"
            "(生产事故:38/39 连接等同一行锁排队 40-55s)。last_used_at 仅供"
            "管理 UI 展示,秒级精度无业务价值。0=退化为每次都写(旧行为)。"
        ),
    )
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

    # ── Spec transport (global switch, NOT persisted to DB — D-001@v1) ────────
    # D-002@v1: 全局环境变量 SPEC_TRANSPORT=shared|tar，默认 shared 向后兼容同机部署。
    # shared: 同机 bind mount，prompt 用宿主路径，不 pull 不回传（D-004 现状）。
    # tar:    异机，backend 独占真理源，daemon pull 缓存 + lease 终态整树回传。
    spec_transport: Literal["shared", "tar"] = Field(
        default="shared",
        description="Global spec transport mode. 'shared' = same-host bind mount (legacy, "
        "zero-change); 'tar' = cross-host, backend is source of truth with daemon pull+sync. "
        "Read from SPEC_TRANSPORT env. Orthogonal to SpecWorkspace.strategy, NOT persisted (D-001).",
    )

    @field_validator("spec_data_root", mode="before")
    @classmethod
    def _resolve_spec_data_root(cls, raw: object) -> object:
        """Resolve relative paths against the repo root."""
        if isinstance(raw, str):
            return resolve_spec_data_root(raw)
        return raw

    @field_validator("spec_transport", mode="before")
    @classmethod
    def _normalize_spec_transport(cls, raw: object) -> object:
        """Normalize SPEC_TRANSPORT: strip + lower-case before Literal enum check.

        Invalid values (e.g. 'http', 'ftp', 'SHARED ' trailing junk after strip)
        fall through to Pydantic Literal validation which raises a clear
        ValidationError listing allowed values.
        """
        if isinstance(raw, str):
            return raw.strip().lower()
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
