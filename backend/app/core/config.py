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

    # 2026-07-07-daemon-skill-execution task-06：sillyspec skills 打包源目录。
    # 镜像内路径由 Dockerfile COPY → /app/sillyspec-skills/（task-07）。
    # 不放 /app/.claude/skills/——该路径被 claude-data named volume 遮盖（volume 早于
    # skills COPY 创建，不会重拷镜像内容），改放非 volume 路径，entrypoint 软链给 claude。
    # 测试经 monkeypatch 覆盖 skills_bundle_service.get_settings 指向 tmp_path。
    skills_bundle_dir: Path = Field(
        default=Path("/app/sillyspec-skills"),
        description="Directory containing sillyspec-* skill subdirectories for bundle packaging.",
    )

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
    auth_api_key_cache_ttl: int = Field(
        60,
        ge=0,
        description=(
            "API key 认证成功结果 Redis 缓存 TTL(秒)。命中后跳过 bcrypt O(n)"
            "扫描(生产根因:cost12 同步阻塞事件循环,2核1.6G 单用户即卡),仅按"
            "缓存 user_id 查 DB 实时校验 user active/未删除(不缓存放行已失效"
            "用户)。revoke 时按 key_prefix 清缓存。0=禁用正缓存(每次走 bcrypt)。"
        ),
    )
    auth_api_key_negative_cache_ttl: int = Field(
        30,
        ge=0,
        description=(
            "API key 认证失败 Redis 负缓存 TTL(秒)。完全无 bcrypt 匹配的明文"
            "30s 内秒回 None,防止无效 key 探测穿透到 bcrypt O(n) 扫描。"
            "命中真实 key 但过期/owner 失效不设负缓存(避免 owner 恢复后误拒)。"
            "0=禁用负缓存。"
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
    # D-002@v2: 默认改为 tar（2026-07-11 ql-20260711-001 spec sync 修复）。
    # server-local 移除后 daemon-client 为唯一路径来源，shared 同机 bind mount 直读
    # 语义失效（daemon 宿主无 backend 容器路径，skills_view/lease shared 透传容器
    # spec_root 给 daemon 必读失败）。tar 模式 daemon pull 到 ~/.sillyhub/daemon/specs/{ws}
    # 本地缓存，是 daemon-client 唯一正确路径。
    # shared: 同机 bind mount（legacy，daemon-client 下无合法消费者，死代码语义）。
    # tar:    异机/同机，backend 独占真理源，daemon pull 缓存 + lease 终态整树回传。
    spec_transport: Literal["shared", "tar"] = Field(
        default="tar",
        description="Global spec transport mode. 'tar' = backend is source of truth, daemon "
        "pulls+syncs (daemon-client default since 2026-07-11). 'shared' = legacy same-host "
        "bind mount (no valid consumer after server-local removal). Read from SPEC_TRANSPORT "
        "env. Orthogonal to SpecWorkspace.strategy, NOT persisted (D-001).",
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
