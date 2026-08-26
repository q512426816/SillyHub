"""Application settings.

Settings are loaded once at import time via :func:`get_settings` and cached.
All runtime configuration MUST live here — never read ``os.environ`` directly
from feature code.
"""

from __future__ import annotations

import logging
import re
import subprocess
import sys
from datetime import timedelta, timezone, tzinfo
from functools import lru_cache
from pathlib import Path
from typing import Annotated, Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import Field, ValidationInfo, field_validator, model_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

from app.core.paths import resolve_spec_data_root

# 常见弱口令黑名单（task-03 / FR-05 / D-002@v1）：bootstrap 管理员口令命中即拒，
# 在配置加载期 fail-fast，连 lifespan 都不进。仅覆盖最常见占位口令，非穷举字典。
# 与现有测试口令（Xx1!abcd / OldPass1! / NewPass1! / Admin123!@#）零碰撞。
_WEAK_BOOTSTRAP_PASSWORDS = frozenset(
    {
        "admin123",
        "admin1234",
        "admin@123",
        "password",
        "password123",
        "passwd123",
        "12345678",
        "123456789",
        "1234567890",
        "qwerty123",
        "letmein123",
        "welcome123",
    }
)


def resolve_cli_tzinfo(value: str) -> tzinfo:
    """CLI naive 时间戳解释时区串 → tzinfo。

    sillyspec CLI 上行的 ``completed_at``/``started_at`` 是 CLI 宿主机墙钟
    （``toLocaleString('zh-CN')``，无时区标记）。后端归一到 UTC 时需要一个
    显式解释时区，不能随进程本地时区走——Docker 容器是 UTC，按进程时区解释
    会把东八区墙钟当 UTC，前端转浏览器本地后整体偏 8 小时（ql-20260822-006）。

    接受 IANA 区名（``Asia/Shanghai``，经 ZoneInfo/tzdata）或固定偏移
    （``+08:00`` / ``-0530``，无 DST 地区等价精确）。非法串抛 ValueError
    （Settings validator 借此启动期 fail-fast）。
    """
    try:
        return ZoneInfo(value)
    except (ZoneInfoNotFoundError, ValueError, KeyError):
        pass
    m = re.fullmatch(r"([+-])(\d{2}):?(\d{2})", value.strip())
    if m:
        sign = 1 if m.group(1) == "+" else -1
        hours, minutes = int(m.group(2)), int(m.group(3))
        if hours <= 23 and minutes <= 59:
            return timezone(sign * timedelta(hours=hours, minutes=minutes))
    raise ValueError(f"unknown or invalid timezone: {value!r}")


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
    # ── 登录限流 + 滑块验证码（安全止血:登录爆破防护）────────────────────
    auth_login_rate_limit_per_minute: int = Field(
        5,
        ge=1,
        description="登录限流:同一 IP 每 60s 窗口最大尝试次数,超限 429。",
    )
    auth_login_fail_threshold: int = Field(
        3,
        ge=1,
        description="登录连续失败达到此次数后,该 IP 后续登录强制滑块验证码。",
    )
    auth_login_fail_window_seconds: int = Field(
        900,
        ge=60,
        description="登录失败计数窗口(秒),窗口内累计达 threshold 触发验证码。",
    )
    auth_captcha_token_ttl_seconds: int = Field(
        120,
        ge=10,
        description="滑块校验通过后签发的 captcha_token 有效期(秒),登录一次性消费。",
    )
    # ── 权限缓存（2026-07-23-rbac-permission-cache）─────────────────────
    permission_cache_ttl: int = Field(
        300,
        ge=0,
        description=(
            "RBAC 权限缓存(platform/all/workspace 三键)+ PPM data_scope 缓存的 Redis TTL(秒)。"
            "失效逻辑漏调或 invalidate 自身失败时,TTL 是最长越权窗口兜底(D-002@v2)。"
            "0=禁用缓存(每次回查 DB,仅用于排障)。"
        ),
    )
    # ── 权限缓存熔断器（2026-07-23-backend-permission-perf）─────────────
    permission_cache_breaker_threshold: int = Field(
        5,
        ge=0,
        le=100,
        description=(
            "权限缓存熔断器——连续失败次数阈值。达到后缓存层直接跳过 Redis 回退 DB,"
            "不等待连接超时。0=禁用熔断器(始终正常读写 Redis)。"
        ),
    )
    permission_cache_breaker_cooldown: int = Field(
        30,
        ge=0,
        le=3600,
        description=(
            "权限缓存熔断器——OPEN 状态下保持断开的最小秒数。超时后 HALF_OPEN 试探一次,"
            "成功则恢复、失败则重回 OPEN。0=不自动恢复(需重启进程排障)。"
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

    # ── CLI progress naive 时间戳解释时区（ql-20260822-006）─────────────────
    # CLI 写的是宿主机墙钟（无时区标记），后端进程时区（Docker 容器 UTC）≠ CLI
    # 宿主机时区，解释时区必须显式配置（详见 resolve_cli_tzinfo docstring）。
    cli_progress_timezone: str = Field(
        default="Asia/Shanghai",
        description="Timezone interpreting naive local timestamps uploaded by the sillyspec CLI "
        "(steps.completed_at / stages.started_at, host wall clock). IANA name or fixed offset "
        "like '+08:00'. Independent of backend process timezone (containers run UTC).",
    )

    @field_validator("cli_progress_timezone")
    @classmethod
    def _validate_cli_progress_timezone(cls, raw: object) -> object:
        """fail-fast：非 IANA 名也非 ±HH:MM 偏移的串启动期即拒（不等到归一化时静默错时）。"""
        if isinstance(raw, str):
            resolve_cli_tzinfo(raw)
        return raw

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

    # ── Object storage (platform file center) ──────────────────────────
    # 设计依据 design.md §D-001/D-002/D-009。全部给默认值保证 brownfield 兼容。
    storage_backend: str = Field(
        default="minio",
        description="对象存储后端（minio；未来可加 oss 等 S3 兼容实现，代码零改动）。",
    )
    s3_endpoint: str = Field(
        default="http://localhost:9000",
        description="S3 兼容端点。Docker 内为 http://minio:9000。",
    )
    s3_access_key: str = Field(default="minioadmin")
    s3_secret_key: str = Field(default="minioadmin")
    s3_bucket: str = Field(default="platform-files")
    s3_region: str = Field(default="us-east-1")
    file_max_size_mb: int = Field(
        default=50, ge=1, description="单文件上传大小上限（MB），超限 413。"
    )

    # ── 2026-08-26-onlyoffice-preview：OnlyOffice DS 高保真预览（D-006 复用
    # bsp-onlyoffice 容器）。enabled=false → config 端点 503 → 前端降级本地渲染器
    # （未配置环境行为与现状逐字节一致）。──
    onlyoffice_enabled: bool = Field(
        default=False,
        description="OnlyOffice 高保真预览开关（DS 不可用时前端自动降级本地渲染器）。",
    )
    onlyoffice_public_url: str = Field(
        default="http://127.0.0.1:8080",
        description="浏览器可达的 DS 地址（局域网访问改为局域网 IP；经 config 端点下发，改 .env 重启即生效免重构建）。",
    )
    onlyoffice_jwt_secret: str = Field(
        default="",
        description="DS 的 JWT_SECRET（共用实例时与 DS 侧一致，如 bsp-onlyoffice 的 dev_secret_change_me）。",
    )
    onlyoffice_file_base_url: str = Field(
        default="http://host.docker.internal:8000",
        description="DS 容器回拉平台文件的 base URL（跨 compose 网络走宿主机地址；同网络可改 http://backend:8000）。",
    )
    onlyoffice_file_token_ttl_seconds: int = Field(
        default=300,
        ge=30,
        le=1800,
        description="预览文件一次性令牌 TTL（秒）；redis jti 防重放。",
    )
    file_allowed_types: str = Field(
        default=(
            "image/jpeg,image/png,image/gif,image/webp,"
            "application/pdf,"
            "application/msword,"
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document,"
            "application/vnd.ms-excel,"
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,"
            "application/zip,text/plain,text/markdown"
        ),
        description="上传 MIME 白名单（逗号分隔），不在列 415。D-009 排除 text/html、image/svg+xml。"
        "text/markdown 供借用 agent run 方案落文件中心（2026-07-25-daemon-borrow-for-business D-001/FR-06）。",
    )

    # ── LiteLLM gateway（Wave2，openai 格式供应商经 LiteLLM 转 Anthropic↔OpenAI / FR-05）──
    # design D-004/D-012：平台不实现转换，外包服务器 LiteLLM。openai 供应商 set-default 时后端经
    # admin API 注册 model_name=usr-<uid>-<pid>（task-09 litellm_client.register），claim 时
    # provider_config 带 litellm_model_name（task-10），daemon 注 ANTHROPIC_BASE_URL=litellm（task-11）。
    litellm_base_url: str = Field(
        default="http://litellm:4000",
        description=(
            "LiteLLM admin + proxy base URL。Docker 内 backend 经服务名 litellm:4000 访问；"
            "dev host native run 用 http://localhost:4000（dev compose 127.0.0.1 映射）。"
        ),
    )
    litellm_master_key: str | None = Field(
        default=None,
        description=(
            "LiteLLM master key：admin API 鉴权（register/unregister）+ openai 供应商经 LiteLLM 的 "
            "auth_token（/v1/messages 接受 master key）。从 LITELLM_MASTER_KEY env 读，不入代码/日志/审计。"
            "未配则 openai set-default 的 LiteLLM 注册恒失败（R-09 best-effort 降级，不阻塞 is_default）。"
        ),
    )
    # task-04（security-audit-remediation / D-003@v1）：daemon 可达的 hub 代理 origin。
    # master key 收窄后 provider_config 不再下发明文 key，改下发 litellm_proxy 标记 +
    # 本地址（拼 /api/daemon/llm-proxy 路径），daemon 子进程经 hub 代理打 LiteLLM。
    # 与 litellm_base_url（backend 容器内可达地址，如 http://litellm:4000）不同维度：
    # 本字段是 daemon（可能在宿主机/异机）可达的 hub 对外地址。默认 localhost:8000
    # 兼顾本机 dev；部署时经 HUB_PROXY_BASE_URL env 指向实际对外地址。
    hub_proxy_base_url: str = Field(
        default="http://localhost:8000",
        description=(
            "daemon 可达的 hub backend origin（master key 收窄后 llm-proxy 透传端点地址）。"
            "provider_config.litellm_base_url = 该值 + /api/daemon/llm-proxy。"
        ),
    )

    @property
    def file_allowed_type_set(self) -> frozenset[str]:
        """file_allowed_types 解析为集合（去空白），供上传校验。"""
        return frozenset(t.strip() for t in self.file_allowed_types.split(",") if t.strip())

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

    # ── Mission patrol (2026-08-21-mission-converge-patrol task-01) ─────
    # mission 巡检循环（lifespan 常驻协程）的唯一配置来源（design §3 / FR-04）。
    # 全部带默认值：存量部署零配置可启动；开关关闭时行为零变化（NFR-02）。
    # （2026-08-22-team-session-unify task-08 增补 awaiting_input 超时项，同族命名。）
    mission_patrol_enabled: bool = Field(
        default=True,
        description=(
            "Mission 巡检总开关。False 时巡检循环不启动，"
            "零行为变化（brownfield 零回归开关，NFR-02）。"
        ),
    )
    mission_patrol_interval_seconds: int = Field(
        default=60,
        ge=10,
        description="巡检轮间隔（秒）。默认 60s；下界 10s 防高频空转扫库。",
    )
    mission_patrol_zombie_after_minutes: int = Field(
        default=60,
        ge=5,
        description="daemon 持续离线多久判定其 run 为僵尸（分钟）。默认 60min。",
    )
    mission_patrol_revive_window_minutes: int = Field(
        default=30,
        ge=5,
        description=(
            "僵尸复活窗口（分钟）：run 判死后窗口内 daemon 回线可复活，超窗不可逆收敛。默认 30min。"
        ),
    )
    # 2026-08-22-team-session-unify task-08（design §5 Phase 1 patrol 适配 / §7.5
    # patrol auto-converge 行 / FR-08）：会话 mission awaiting_input 超时自动收敛阈值。
    mission_patrol_awaiting_input_timeout_minutes: int = Field(
        default=30,
        ge=5,
        description=(
            "awaiting_input 超时自动收敛（分钟）：会话 mission 主控轮与分身全终态、"
            "未 converge 且会话无活跃 turn 持续超时后，patrol 走 explicit 收敛入口"
            "推进终态（时钟起点=最新 orchestrator run 的 finished_at）。默认 30min。"
        ),
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

    @model_validator(mode="after")
    def _warn_default_s3_credentials(self) -> "Settings":
        """BS-7（2026-08-20 审计）：非 dev 环境沿用 minioadmin 默认凭证时启动即报错。

        默认值仅服务本地开箱体验；生产/测试环境漏配 S3_* 等于对象存储全开，
        在配置加载期 fail-fast（同 bootstrap 弱口令范式），错误信息给出修复指引。
        """
        using_default = self.s3_access_key == "minioadmin" or self.s3_secret_key == "minioadmin"
        if not using_default:
            return self
        if self.environment == "prod":
            raise ValueError(
                "生产环境不允许使用 MinIO 默认凭证 minioadmin："
                "请在环境变量或 .env 中显式配置 S3_ACCESS_KEY / S3_SECRET_KEY。"
            )
        if self.environment == "test":
            # 测试环境不连真实对象存储，仅提醒；硬拒会让全部 CI 红灯。
            logging.getLogger(__name__).warning(
                "test 环境使用 MinIO 默认凭证（测试不连真实 S3，仅提醒）。"
            )
        return self

    @field_validator("platform_bootstrap_admin_password")
    @classmethod
    def _reject_weak_bootstrap_password(cls, v: str | None, info: ValidationInfo) -> str | None:
        """Reject weak / well-known bootstrap admin passwords at config load.

        FR-05 / D-002@v1: fail-fast before lifespan boots, so a leaked default
        like ``admin123`` never produces a runnable admin account. ``None``
        passes (D-004: bootstrap is opt-in, missing config = no account).
        Cross-field check against the login name is safe here because
        ``platform_bootstrap_admin_email`` is defined before this field, so
        ``info.data`` already holds it (verified against pydantic v2).
        """
        if v is None:
            return v
        if v in _WEAK_BOOTSTRAP_PASSWORDS:
            raise ValueError(
                "platform_bootstrap_admin_password 是常见弱口令，请改为强口令"
                "（≥12 位、含大小写/数字/符号）"
            )
        email_raw = info.data.get("platform_bootstrap_admin_email") or ""
        email_local = email_raw.split("@", 1)[0].lower()
        if email_local and email_local == v.lower():
            raise ValueError("platform_bootstrap_admin_password 不能与登录名相同")
        return v

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
