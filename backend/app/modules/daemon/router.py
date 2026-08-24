"""HTTP routes for daemon runtime management and task lease lifecycle."""

from __future__ import annotations

import io
import json
import re
import uuid
from collections.abc import AsyncGenerator
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Annotated, Any, Literal

import httpx
from fastapi import (
    APIRouter,
    Depends,
    Header,
    HTTPException,
    Query,
    Request,
    WebSocket,
    WebSocketDisconnect,
    status,
)
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import func as sa_func
from sqlalchemy import select
from sqlalchemy import select as sa_select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_deps import get_current_principal, require_permission_any
from app.core.config import get_settings
from app.core.db import get_session, get_session_factory
from app.core.logging import get_logger
from app.core.security import AccessTokenError, decode_access_token
from app.modules.agent.schema import AgentRunLogEntry
from app.modules.auth.api_key_service import API_KEY_PREFIX, ApiKeyService
from app.modules.auth.model import User
from app.modules.auth.permissions import Permission
from app.modules.daemon.model import DaemonInstance, DaemonRuntime, DaemonTaskLease
from app.modules.daemon.model_error import ModelErrorDTO
from app.modules.daemon.permission_service import (
    DaemonPermissionService,
    PermissionResponseRead,
    SessionDialogRead,
)
from app.modules.daemon.protocol import (
    DAEMON_MSG_HEARTBEAT,
    DAEMON_MSG_PERMISSION_REQUEST,
    DAEMON_MSG_RPC_RESULT,
    PermissionRequestPayload,
)
from app.modules.daemon.run_sync.service import (
    publish_bash_chunk_event,
    publish_session_event,
    publish_submitted_messages,
)
from app.modules.daemon.schema import (
    AgentSessionListResponse,
    AgentSessionRead,
    AgentTaskStatusEvent,
    BashChunkEvent,
    BashStatusEvent,
    DaemonInstanceProviderItem,
    DaemonInstanceRead,
    DaemonMachineListResponse,
    DaemonMachineRead,
    DaemonMachineUpdate,
    DaemonRegisterRequest,
    DaemonRegisterResponse,
    DaemonRegisterRuntimeItem,
    DaemonRuntimeAllowedRootsUpdate,
    DaemonRuntimeListResponse,
    DaemonRuntimeRead,
    DaemonRuntimeUpdate,
    DaemonTaskLeaseRead,
    LeaseClaimRequest,
    LeaseClaimResponse,
    LeaseCompleteRequest,
    LeaseCompleteResponse,
    LeaseHeartbeatRequest,
    LeaseHeartbeatResponse,
    LeaseMessagesRequest,
    LeaseMessagesResponse,
    LeaseStartRequest,
    LeaseStartResponse,
    LeaseSyncRequest,
    LeaseSyncResponse,
    ListDirRequest,
    ListDirResponse,
    ListRootsResponse,
    OwnerRead,
    PlanModeEnteredEvent,
    PlanResponseRequest,
    RuntimeUsageListResponse,
    RuntimeUsageWindow,
    SessionCreateRequest,
    SessionInjectRequest,
    SessionReopenResponse,
    TeamMissionCreateBlock,
    TeamMissionSummary,
    TeamMissionTriggerRequest,
    TeamMissionWorkerSummary,
)
from app.modules.daemon.service import (
    DaemonLeaseNotFound,
    DaemonRpcForbiddenError,
    DaemonRpcGatewayError,
    DaemonRpcRemoteError,
    DaemonRpcRemoteGatewayError,
    DaemonRpcTimeout,
    DaemonRuntimeNotFound,
    DaemonRuntimeOffline,
    DaemonService,
    DaemonSessionNotFound,
)
from app.modules.daemon.session.service import SessionService, get_session_readiness

if TYPE_CHECKING:
    # 仅类型注解用（team-mission 汇总 helper 形参）；运行时在各端点内延迟 import。
    from app.modules.agent.model import AgentMission

log = get_logger(__name__)


# ── Daemon distribution metadata (public, no auth) ───────────────────────────
# GET /api/daemon/version —— 供前端安装区块 / install.sh 拉取最新版本号与下载地址。
# 当前硬编码；后续可改为读 nginx 托管的 latest.json 或配置中心。
# latest.json（install.sh 消费）字段：version / downloadUrl；本端点多返回 minRequired
# 供前端做版本门槛提示。
DAEMON_DOWNLOAD_URL = "/daemon/latest/sillyhub-daemon.js"


def _compute_daemon_version() -> str:
    """从已部署的 daemon bundle 中提取 BUILD_ID（git short SHA）。

    daemon 侧 build-id.ts 在 bundle 时注入 BUILD_ID，此处从部署的 JS 文件中
    正则提取。提取失败时回退 "unknown"。
    """
    import re

    try:
        bundle_path = get_settings().daemon_dist_dir / "sillyhub-daemon.js"
        if not bundle_path.is_file():
            return "unknown"
        text = bundle_path.read_text(errors="replace")
        m = re.search(r'BUILD_ID\s*=\s*["\x27]([^"\x27]+)', text)
        return m.group(1) if m else "unknown"
    except Exception:
        return "unknown"


def _compute_daemon_semver() -> str:
    """从已部署 bundle 提取 DAEMON_VERSION（语义版本）。

    2026-07-04-daemon-version-management D-004/D-009：与 BUILD_ID（SHA）分开提取，
    供 GET /api/daemon/version 展示语义版本（self-update 仍用 BUILD_ID 比对）。
    提取失败回退 "unknown"。
    """
    import re

    try:
        bundle_path = get_settings().daemon_dist_dir / "sillyhub-daemon.js"
        if not bundle_path.is_file():
            return "unknown"
        text = bundle_path.read_text(errors="replace")
        m = re.search(r'DAEMON_VERSION\s*=\s*["\x27]([^"\x27]+)', text)
        return m.group(1) if m else "unknown"
    except Exception:
        return "unknown"


def get_daemon_latest_version() -> str:
    """缓存 daemon latest BUILD_ID（git SHA，进程级，deploy 后不变）。

    2026-07-04-daemon-version-management D-009：返回值仍为 SHA，供 self-update 端点
    WS 推送（daemon preflight 按 BUILD_ID 比对）。语义版本走 get_daemon_latest_semver。
    """
    global _DAEMON_VERSION_CACHE
    if _DAEMON_VERSION_CACHE is None:
        _DAEMON_VERSION_CACHE = _compute_daemon_version()
    return _DAEMON_VERSION_CACHE


def get_daemon_latest_semver() -> str:
    """缓存 daemon latest 语义版本（DAEMON_VERSION，供前端展示）。"""
    global _DAEMON_SEMVER_CACHE
    if _DAEMON_SEMVER_CACHE is None:
        _DAEMON_SEMVER_CACHE = _compute_daemon_semver()
    return _DAEMON_SEMVER_CACHE


_DAEMON_VERSION_CACHE: str | None = None
_DAEMON_SEMVER_CACHE: str | None = None


class DaemonVersionResponse(BaseModel):
    """GET /api/daemon/version 响应：daemon 分发元数据（公开端点）。

    2026-07-04-daemon-version-management D-004：新增 latest_version（语义）+
    latest_build_id（SHA），供前端版本比对与升级入口。旧 latest/minRequired/
    downloadUrl 保留（install.sh 兼容）。
    """

    latest: str = Field(description="最新发布版本号（= latest_build_id 回退值，兼容 install.sh）")
    minRequired: str = Field(description="最低兼容版本号（低于则需升级）")  # noqa: N815 - JSON 契约字段名（install.sh/前端消费，不可改 snake_case）
    downloadUrl: str = Field(description="单文件 bundle 下载地址（相对站内路径）")  # noqa: N815 - JSON 契约字段名（install.sh/前端消费，不可改 snake_case）
    latest_version: str = Field(
        description="最新语义版本（DAEMON_VERSION，bundle 提取失败=unknown）"
    )
    latest_build_id: str = Field(description="最新构建标识（BUILD_ID/git SHA，前端升级比对用）")


# ── Per-daemon heartbeat DTO（inline，task-07）─────────────────────────────────
# design §5.4 / §9.1：daemon 单条心跳合并上报 daemon_local_id + 各 provider 状态。
# 原 schema.py 内的 runtime_id 版本已被 per-daemon 契约取代；DTO 内联在此避免
# 触碰 schema.py（task-05 的 allowed_path，非 task-07）。WS breaking（D-007）：
# daemon_local_id 必填，旧 daemon per-provider body 会被 pydantic 拒成 422。


class DaemonHeartbeatProviderItem(BaseModel):
    """单个 provider 心跳上报项（per-daemon heartbeat body 内 ``providers[]``）。"""

    provider: str = Field(min_length=1, max_length=50)
    status: str = Field(default="online", max_length=20)


class DaemonHeartbeatRequest(BaseModel):
    """Per-daemon 心跳请求体（design §5.4 / §9.1 / D-006）。

    daemon 周期上报其 ``daemon_local_id``（=daemon_instances.id）+ 各 provider 的
    当前 status。backend 刷新 daemon_instances.last_heartbeat_at + 各 runtime.status。
    2026-07-04-daemon-version-management：同时上报 daemon_version/daemon_build_id
    （D-002，register + heartbeat 都带），backend 刷新 instance.version/build_id。
    """

    daemon_local_id: uuid.UUID = Field(description="daemon 本地 uuid（daemon_instances.id）")
    daemon_version: str | None = Field(default=None, max_length=50)
    daemon_build_id: str | None = Field(default=None, max_length=50)
    # daemon 进程启动时间（2026-08-05-daemon-start-time D-002@v1）。
    # 心跳携带用于 daemon 重启后 started_at 刷新（process 重启时间变）。
    # Optional 兼容旧 daemon（不上报则保留原值 / NULL）。
    started_at: datetime | None = Field(default=None)
    providers: list[DaemonHeartbeatProviderItem] = Field(default_factory=list)


class DaemonHeartbeatRuntimePolicy(BaseModel):
    """心跳响应内单个 runtime 的 per-runtime allowed_roots。"""

    runtime_id: uuid.UUID
    allowed_roots: list[str]


class DaemonHeartbeatResponse(BaseModel):
    """Per-daemon 心跳响应体。

    2026-07-06-allowed-roots-per-runtime：返 per-runtime allowed_roots map
    （runtimes: [{runtime_id, allowed_roots}]），daemon _syncAllowedRoots per-runtime 同步。
    """

    daemon_instance_id: uuid.UUID
    status: str
    runtimes: list[DaemonHeartbeatRuntimePolicy] = Field(default_factory=list)


# SSE response headers shared with the run-scoped stream endpoint
# (app/modules/agent/router.py). Proxies/buffers must not hold SSE frames.
_SESSION_SSE_HEADERS = {
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
}

router = APIRouter(prefix="/daemon", tags=["daemon"])

# task-09：change-write 任务队列回执三端点（FR-08 / D-004@v1），复用本 router 的
# /daemon prefix + tag；路由写相对路径（/runtimes/{rid}/pending-change-writes 等），
# 经外层 main.py 的 prefix="/api" 挂载后落地 /api/daemon/...
from app.modules.daemon.change_write_router import (  # noqa: E402
    router as change_write_router,
)

router.include_router(change_write_router)

# task-10 / D-006@v1: daemon audit batch upload + paginated audit read.
# Inherits this router's /daemon prefix → POST resolves to
# /api/daemon/audit/batch (matches design §7.3); the GET audit read resolves
# to /api/daemon/workspaces/{wid}/runtimes/{rid}/policy-audit (deviation: design
# §7.3 wrote /api/workspaces/... but editing app/main.py is out of task-10's
# allowed_paths — see audit/router.py module docstring).
from app.modules.daemon.audit.router import router as audit_router  # noqa: E402

router.include_router(audit_router)

SessionDep = Annotated[AsyncSession, Depends(get_session)]
# 管理 UI 端点用 runtime:admin；daemon 自身的注册/心跳/lease 生命周期仍走 get_current_principal
RuntimeAdminUser = Annotated[User, Depends(require_permission_any(Permission.RUNTIME_ADMIN))]


# ── Daemon distribution metadata (public, no auth) ───────────────────────────
@router.get(
    "/version",
    response_model=DaemonVersionResponse,
)
async def get_daemon_version() -> DaemonVersionResponse:
    """公开端点：返回 daemon 最新版本 / 最低要求版本 / 下载地址。

    无需认证——前端「首次安装」区块与 install.sh 都需要匿名拉取该元数据。
    downloadUrl 为相对路径（如 ``/daemon/latest/sillyhub-daemon.js``），由 nginx
    静态托管；调用方（前端/脚本）按自身已知的服务端 base URL 拼接。
    """
    return DaemonVersionResponse(
        latest=get_daemon_latest_version(),
        minRequired="0.1.0",
        downloadUrl=DAEMON_DOWNLOAD_URL,
        latest_version=get_daemon_latest_semver(),
        latest_build_id=get_daemon_latest_version(),
    )


# ── Runtime registration & heartbeat ────────────────────────────────────────


@router.post(
    "/register",
    response_model=DaemonRegisterResponse,
    status_code=status.HTTP_201_CREATED,
)
async def register_daemon(
    data: DaemonRegisterRequest,
    session: SessionDep,
    user: Annotated[User, Depends(get_current_principal)],
) -> DaemonRegisterResponse:
    """Per-daemon 注册（design §5.2 / D-006）。

    daemon 启动一次性上报 daemon_local_id + 机器级字段 + provider 列表。backend
    先 upsert daemon_instances，再为每个 provider upsert daemon_runtimes，并清理
    stale runtime（provider 卸载）。返回 daemon_instance_id + 各 runtime_id。
    """
    svc = DaemonService(session)
    result = await svc.register_daemon(
        user.id,
        daemon_local_id=data.daemon_local_id,
        server_url=data.server_url,
        hostname=data.hostname,
        os=data.os,
        arch=data.arch,
        allowed_roots=data.allowed_roots,
        providers=[item.model_dump() for item in data.providers],
        daemon_version=data.daemon_version,
        daemon_build_id=data.daemon_build_id,
        started_at=data.started_at,
    )
    return DaemonRegisterResponse(
        daemon_instance_id=result.daemon_instance_id,
        runtimes=[
            DaemonRegisterRuntimeItem(
                provider=r.provider,
                runtime_id=r.runtime_id,
                allowed_roots=r.allowed_roots,
            )
            for r in result.runtimes
        ],
    )


@router.post(
    "/heartbeat",
    response_model=DaemonHeartbeatResponse,
)
async def daemon_heartbeat(
    data: DaemonHeartbeatRequest,
    session: SessionDep,
    user: Annotated[User, Depends(get_current_principal)],
) -> DaemonHeartbeatResponse:
    """Per-daemon HTTP 心跳（design §5.4 / §9.1 / D-006）。

    daemon 单条心跳合并上报 ``daemon_local_id`` + 各 provider 状态。backend 刷新
    ``daemon_instances.last_heartbeat_at`` + 各 ``daemon_runtimes.status``。
    ``heartbeat_ack`` 经 WS 下发到该 daemon 连接（task-06 通路），本 HTTP 响应只
    回 ``{daemon_instance_id, status, allowed_roots}``（allowed_roots 从 daemon
    实体读，已上提到 daemon_instances，design §4.2）。

    WS breaking（D-007）：旧 daemon 按 per-provider body 上报（无 daemon_local_id）
    → pydantic 校验 daemon_local_id 必填失败 → 422 拒绝，要求同步升级。
    """
    svc = DaemonService(session)
    instance = await svc.heartbeat_daemon(
        data.daemon_local_id,
        providers=[item.model_dump() for item in data.providers],
        daemon_version=data.daemon_version,
        daemon_build_id=data.daemon_build_id,
        started_at=data.started_at,
        # task-03（security-audit-remediation / FR-12）：心跳归属校验——
        # instance.user_id 必须等于当前认证 user，不匹配 404（owner-only）。
        actor_user_id=user.id,
    )
    # ql-20260706-005：col 属 sqlmodel（非 sqlalchemy 顶层），误从 sqlalchemy
    # 导入会 ImportError → heartbeat 端点 500 → daemon 拿不到 per-runtime
    # allowed_roots → CC 配的可写目录全 deny。与 service.py:13 用法对齐。
    from sqlmodel import col as _col

    from app.modules.daemon.model import DaemonRuntime

    rt_rows = (
        (
            await session.execute(
                select(DaemonRuntime).where(_col(DaemonRuntime.daemon_instance_id) == instance.id)
            )
        )
        .scalars()
        .all()
    )
    return DaemonHeartbeatResponse(
        daemon_instance_id=instance.id,
        status=instance.status or "online",
        runtimes=[
            DaemonHeartbeatRuntimePolicy(
                runtime_id=rt.id,
                allowed_roots=list(rt.allowed_roots or []),
            )
            for rt in rt_rows
        ],
    )


# ── Runtime usage stats (FR-03 / D-002·003·004) ──────────────────────────────
# 静态路径 /runtimes/usage 必须声明在动态 /runtimes/{runtime_id} 之前：FastAPI 按声明
# 顺序匹配，否则 "usage" 会被 {runtime_id} 捕获，再 UUID parse 失败 -> 422。
# 聚合在 service 层(task-08)，router 仅做参数校验 + DTO 封装；window Enum 边界非法值
# 由 FastAPI 自动返回 422。


@router.get(
    "/runtimes/usage",
    response_model=RuntimeUsageListResponse,
)
async def get_runtimes_usage(
    session: SessionDep,
    user: RuntimeAdminUser,
    window: RuntimeUsageWindow = Query(
        RuntimeUsageWindow.DAY7,
        description="时间窗：1d(本地自然日 today 00:00，按小时) / 7d / 30d(按日)",
    ),
) -> RuntimeUsageListResponse:
    """批量返回全部 runtime 在指定时间窗内的 token/cache/cost 用量(FR-03)。

    聚合在 service 层用单条 LEFT JOIN+COALESCE SQL 去重(D-003@v2,task-08)；
    分组粒度 1d→hour / 7d·30d→day(D-002@v1)；起点 1d=本地自然日 today 00:00(D-004@v1)。
    空窗 / 无 runtime 正常返回 200 ``{"window":..., "runtimes":[]}``。
    """
    from app.modules.daemon.runtime.service import RuntimeService

    svc = RuntimeService(session)
    runtimes = await svc.get_runtimes_usage(window.value)
    log.info("runtimes_usage_served", window=window.value, count=len(runtimes))
    return RuntimeUsageListResponse(window=window.value, runtimes=runtimes)


def _derive_policy_version(updated_at: datetime | None) -> int:
    """Derive a monotonic policy ``version`` from a runtime's ``updated_at``.

    task-08 / D-004：daemon uses this to drop stale/reordered
    ``policy_update`` pushes (only accept when incoming version > local).
    Epoch millis keeps second-level writes distinct and is monotonic across
    successive DB writes (``update_allowed_roots`` bumps ``updated_at`` each
    call). A missing ``updated_at`` falls back to wall-clock now so the push
    still carries a sensible, forward-only value.
    """
    ts = updated_at if updated_at is not None else datetime.now(UTC)
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=UTC)
    return int(ts.timestamp() * 1000)


def _runtime_read(
    runtime: object,
    owner: object | None = None,
    instance: object | None = None,
) -> DaemonRuntimeRead:
    """Build DaemonRuntimeRead, attaching nested OwnerRead when an owner user
    row is available (task-04 / D-006@v1)。2026-07-04-daemon-version-management：
    instance 非空时填 daemon_version/daemon_build_id（JOIN daemon_instances 带出）。"""
    read = DaemonRuntimeRead.model_validate(runtime)
    update: dict[str, object] = {}
    if owner is not None:
        update["owner"] = OwnerRead(
            user_id=getattr(owner, "id", None),
            email=getattr(owner, "email", None),
            display_name=getattr(owner, "display_name", None),
        )
    if instance is not None:
        update["daemon_version"] = getattr(instance, "version", None)
        update["daemon_build_id"] = getattr(instance, "build_id", None)
    if not update:
        return read
    return read.model_copy(update=update)


def _build_machine_read(
    instance: DaemonInstance,
    owner: User | None,
    runtimes: list[DaemonRuntime],
) -> DaemonMachineRead:
    """把 (instance, owner, runtimes) ORM 组装成 DaemonMachineRead（design §5.1）。

    纯组装函数（不做 SQL）：GET /machines 与 PATCH /machines/{id} 共用。runtime 卡
    复用 _runtime_read 填充 owner/instance；machine 卡再聚合 runtime_count /
    online_runtime_count（design §4.1 机器级聚合字段）。0-runtime 机器传 ``[]`` 正常。
    """
    runtime_reads = [_runtime_read(r, owner, instance) for r in runtimes]
    # 直接构造（不走 model_validate(instance)）：runtime_count/online_runtime_count
    # 是派生字段（design §5.1），daemon_instance ORM 无此二属性，model_validate 会在
    # model_copy 填值前抛 ValidationError（task-04 测试捕获）。显式传全部字段。
    return DaemonMachineRead(
        id=instance.id,
        hostname=instance.hostname,
        display_alias=instance.display_alias,
        os=instance.os,
        arch=instance.arch,
        status=instance.status,
        last_heartbeat_at=instance.last_heartbeat_at,
        version=instance.version,
        build_id=instance.build_id,
        # 2026-08-05-daemon-start-time D-002@v1：进程启动时间，直接读 instance.started_at
        # （task-03 已加该字段，timezone=True nullable）。旧 daemon / 未上报 → None。
        started_at=instance.started_at,
        created_at=instance.created_at,
        owner=OwnerRead(
            user_id=owner.id,
            email=owner.email,
            display_name=owner.display_name,
        )
        if owner is not None
        else None,
        runtime_count=len(runtimes),
        online_runtime_count=sum(1 for r in runtimes if r.status == "online"),
        runtimes=runtime_reads,
    )


# ── Runtime admin global list (task-04 / FR-01/04 / D-005@v1) ────────────────
# 固定路径 /runtimes/page 必须声明在动态 /runtimes/{runtime_id} 之前，否则
# "page" 会被 {runtime_id} 捕获再 UUID parse 失败 → 422（与 /runtimes/usage 同款约束）。


@router.get(
    "/runtimes/page",
    response_model=DaemonRuntimeListResponse,
)
async def list_runtimes_page(
    session: SessionDep,
    user: RuntimeAdminUser,
    q: str | None = Query(default=None, max_length=200),
    type_filter: str | None = Query(default=None, alias="type", max_length=50),
    status_filter: str | None = Query(default=None, alias="status", max_length=20),
    user_id: uuid.UUID | None = Query(default=None),
    limit: int = Query(default=12, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
) -> DaemonRuntimeListResponse:
    """平台管理员分页查看全部 owner 的 runtime；普通账号只见自己 (FR-01/02/04)."""
    svc = DaemonService(session)
    await svc.cleanup_stale_runtimes()
    rows, total = await svc.list_runtimes_page(
        actor_user_id=user.id,
        is_platform_admin=user.is_platform_admin,
        q=q,
        type_filter=type_filter,
        status_filter=status_filter,
        user_id=user_id,
        limit=limit,
        offset=offset,
    )
    return DaemonRuntimeListResponse(
        items=[_runtime_read(runtime, owner, instance) for runtime, owner, instance in rows],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.patch(
    "/runtimes/{runtime_id}",
    response_model=DaemonRuntimeRead,
)
async def update_runtime(
    runtime_id: uuid.UUID,
    data: DaemonRuntimeUpdate,
    session: SessionDep,
    user: RuntimeAdminUser,
) -> DaemonRuntimeRead:
    """PATCH runtime display_alias (task-04 / FR-03 / D-002@v1).

    省略 display_alias = 不变；显式 null/空白 = 清空；字符串 = 更新（strip）。
    """
    svc = DaemonService(session)
    runtime, instance = await svc.update_runtime(
        runtime_id,
        user.id,
        display_alias=data.display_alias,
        display_alias_set="display_alias" in data.model_fields_set,
        is_platform_admin=user.is_platform_admin,
    )
    # task-08：service 返回 (runtime, instance) tuple，经 _runtime_read 填
    # daemon_version/daemon_build_id（D-004@v1 / FR-01）。instance=None（迁移期
    # daemon_instance_id IS NULL）→ 两字段 null，向后兼容旧 daemon。
    return _runtime_read(runtime, None, instance)


@router.put(
    "/runtimes/{runtime_id}/allowed-roots",
    response_model=DaemonRuntimeRead,
)
async def update_runtime_allowed_roots(
    runtime_id: uuid.UUID,
    data: DaemonRuntimeAllowedRootsUpdate,
    session: SessionDep,
    user: RuntimeAdminUser,
) -> DaemonRuntimeRead:
    """PUT runtime allowed_roots sandbox (2026-06-29-runtime-allowed-roots-config task-02).

    admin 配置 daemon 可访问目录（多路径，绝对路径或 ~ 开头）。

    task-08 / design §5.3：DB 写入成功后 best-effort 推送 ``policy_update`` 到在线
    daemon（sub-second 热更新）。推送失败（runtime 离线 / 通道异常）不阻断 PUT
    响应——daemon 在下一次心跳拉取全量 resync 兜底（R-07）。``version`` 从更新后
    runtime 的 ``updated_at`` 派生为 epoch 毫秒，单调递增，供 daemon 丢弃乱序旧推送。
    """
    svc = DaemonService(session)
    try:
        runtime = await svc.update_allowed_roots(
            runtime_id,
            user.id,
            allowed_roots=data.allowed_roots,
            is_platform_admin=user.is_platform_admin,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    # 2026-07-06-allowed-roots-per-runtime：PUT 写 runtime.allowed_roots +
    # bump runtime.updated_at（design §3，per-runtime 隔离，不再写 instance）。
    # WS 路由键仍按 daemon_instance.id（design §5.3）；version + roots 都从 runtime
    # 读（写入实际发生在 runtime 行）。instance 仅用于 daemon_id 路由 + 后续
    # _runtime_read 填 daemon_version/build_id。
    from app.modules.daemon.model import DaemonInstance

    instance = (
        await session.get(DaemonInstance, runtime.daemon_instance_id)
        if runtime.daemon_instance_id is not None
        else None
    )

    # task-08：best-effort WS push（daemon 离线不阻断 PUT，心跳兜底 R-07）。
    # version 派生自 runtime.updated_at（service update_allowed_roots 实际 bump 的
    # 行，epoch 毫秒，单调）。roots 亦从 runtime 读（per-runtime 隔离）。
    version = _derive_policy_version(runtime.updated_at)
    roots_to_push = list(runtime.allowed_roots or [])
    # 无关联 daemon_instance（迁移过渡 / 测试 fixture）→ daemon_id 退化为 runtime.id。
    daemon_id = instance.id if instance is not None else runtime.id

    # Lazy import（与 list_dir / self_update 一致）：ws_hub 单例经
    # get_daemon_ws_hub 取，测试 per-test patch 不会被模块顶部 import 绑死。
    from app.modules.daemon.ws_hub import get_daemon_ws_hub

    try:
        hub = get_daemon_ws_hub()
        # ws_hub 按 daemon_id 路由（task-06 / design §5.3）；payload 内仍带 runtime_id
        # 标识 provider 会话，由 send_policy_update 注入。
        await hub.send_policy_update(
            daemon_id,
            roots_to_push,
            version,
            payload_runtime_id=runtime.id,
        )
    except Exception:
        log.warning(
            "allowed_roots_policy_push_failed",
            runtime_id=str(runtime.id),
            daemon_id=str(daemon_id),
            version=version,
            exc_info=True,
        )
    # 用 _runtime_read 填充 instance.allowed_roots（否则前端拿到 default [~/.sillyhub]）
    return _runtime_read(runtime, instance=instance)


@router.post(
    "/runtimes/{runtime_id}/self-update",
)
async def trigger_daemon_self_update(
    runtime_id: uuid.UUID,
    session: SessionDep,
    user: RuntimeAdminUser,
) -> dict[str, str | bool]:
    """推送 daemon 自更新指令到指定 runtime（admin）。

    通过 WS 发送 `daemon:self_update`，daemon 收到后下载最新 bundle 替换并退出重启。
    返回 `{"sent": bool, "latest_version": str}`。
    """
    from app.modules.daemon.model import DaemonRuntime
    from app.modules.daemon.ws_hub import get_daemon_ws_hub

    latest = get_daemon_latest_version()
    hub = get_daemon_ws_hub()
    # task-06: ws_hub 按 daemon_instance_id 路由；runtime_id → daemon_id。
    # 迁移窗口 runtime.daemon_instance_id IS NULL → 回退 runtime_id（兼容旧数据）。
    runtime = await session.get(DaemonRuntime, runtime_id)
    daemon_id = (runtime.daemon_instance_id if runtime else None) or runtime_id
    sent = await hub.send_self_update(daemon_id, version=latest)
    if not sent:
        from app.modules.daemon.runtime.service import DaemonRuntimeOffline

        raise DaemonRuntimeOffline(
            "目标 runtime 当前离线或消息下发失败，请确认守护进程在线后重试。",
            details={"runtime_id": str(runtime_id)},
        )
    return {"sent": True, "latest_version": latest}


# ── Machine-level endpoints (2026-07-07-daemon-machine-runtime-hierarchy task-03) ──
# design §5.1/§5.2/§5.3：机器级聚合视图与 mutation，全部 RuntimeAdminUser 权限
# + 机器归属校验（D-001）。/machines 为独立固定前缀，不与 /runtimes/{runtime_id}
# 动态段冲突（design §5.1）。


@router.get(
    "/machines",
    response_model=DaemonMachineListResponse,
)
async def list_machines(
    session: SessionDep,
    user: RuntimeAdminUser,
    q: str | None = Query(default=None, max_length=200),
    status: str | None = Query(default=None, max_length=20),
    provider: str | None = Query(default=None, max_length=50),
    user_id: uuid.UUID | None = Query(default=None),
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
) -> DaemonMachineListResponse:
    """平台管理员分页查看全部 owner 的 daemon 机器（design §5.1 / FR-1）。

    普通账号仅见自己的机器（service 层强制 ``actor == user_id``，请求 ``user_id`` 被忽略）。
    ``list_machines`` 内部已先 ``cleanup_stale_runtimes`` 收敛 stale 状态，router 不重复调。
    """
    svc = DaemonService(session)
    rows, runtimes_by_instance, total = await svc.list_machines(
        actor_user_id=user.id,
        is_platform_admin=user.is_platform_admin,
        q=q,
        status=status,
        provider=provider,
        user_id=user_id,
        limit=limit,
        offset=offset,
    )
    items = [
        _build_machine_read(inst, owner, runtimes_by_instance.get(inst.id, []))
        for inst, owner in rows
    ]
    return DaemonMachineListResponse(items=items, total=total, limit=limit, offset=offset)


@router.patch(
    "/machines/{instance_id}",
    response_model=DaemonMachineRead,
)
async def update_machine(
    instance_id: uuid.UUID,
    data: DaemonMachineUpdate,
    session: SessionDep,
    user: RuntimeAdminUser,
) -> DaemonMachineRead:
    """PATCH machine display_alias（design §5.2 / D-001 / FR-2）。

    省略 display_alias = 不变；显式 null/空白 = 清空（与 runtime 级 PATCH 语义一致）。
    0-runtime 机器亦可改（直写 daemon_instances）。归属校验/404 由 service
    ``_get_owned_instance`` 完成（越权 403 / 不存在 404）。
    """
    from sqlmodel import col as _col

    from app.modules.daemon.model import DaemonRuntime

    svc = DaemonService(session)
    instance = await svc.update_machine_alias(
        instance_id,
        user.id,
        display_alias=data.display_alias,
        display_alias_set="display_alias" in data.model_fields_set,
        is_platform_admin=user.is_platform_admin,
    )
    # update_machine_alias 只返回 instance，机器卡需重新聚合 owner+runtimes。
    owner = await session.get(User, instance.user_id)
    runtimes = list(
        (
            await session.execute(
                select(DaemonRuntime)
                .where(_col(DaemonRuntime.daemon_instance_id) == instance.id)
                .order_by(_col(DaemonRuntime.provider))
            )
        )
        .scalars()
        .all()
    )
    return _build_machine_read(instance, owner, runtimes)


@router.post(
    "/machines/{instance_id}/self-update",
)
async def trigger_machine_self_update(
    instance_id: uuid.UUID,
    session: SessionDep,
    user: RuntimeAdminUser,
) -> dict[str, str | bool]:
    """推送 daemon 自更新指令到指定机器（admin，design §5.3 / FR-3）。

    机器级直接以 ``instance_id`` 作 ``daemon_id`` 路由 WS（ws_hub 第一参数即
    daemon_id，task-06），复用既有 ``daemon:self_update`` 消息，不引入新事件 type
    （design §14）。先 ``_get_owned_instance`` 做归属校验（403/404），离线或 WS 发送
    失败 → 504 ``DaemonRuntimeOffline``（与 runtime 级 self-update 同款）。
    """
    svc = DaemonService(session)
    await svc._get_owned_instance(instance_id, user.id, is_platform_admin=user.is_platform_admin)

    from app.modules.daemon.ws_hub import get_daemon_ws_hub

    latest = get_daemon_latest_version()
    hub = get_daemon_ws_hub()
    sent = await hub.send_self_update(instance_id, version=latest)
    if not sent:
        from app.modules.daemon.runtime.service import DaemonRuntimeOffline

        raise DaemonRuntimeOffline(
            "目标机器当前离线或消息下发失败，请确认守护进程在线后重试。",
            details={"daemon_instance_id": str(instance_id)},
        )
    return {"sent": True, "latest_version": latest}


@router.post(
    "/machines/{instance_id}/cleanup",
)
async def trigger_machine_cleanup(
    instance_id: uuid.UUID,
    session: SessionDep,
    user: RuntimeAdminUser,
) -> dict[str, bool]:
    """推送 daemon 本地缓存清理指令到指定机器（admin）。

    daemon 按 cleanup.ts 黑名单删除 specs 缓存 / Claude 会话日志 / 备份 / 日志文件，
    未列入清理目标的内容（config.json、locks/、workspaces/、outbox/、runs/ 等）一律
    保留。fire-and-forget 模式。
    """
    svc = DaemonService(session)
    await svc._get_owned_instance(instance_id, user.id, is_platform_admin=user.is_platform_admin)

    from app.modules.daemon.ws_hub import get_daemon_ws_hub

    hub = get_daemon_ws_hub()
    sent = await hub.send_cleanup(instance_id)
    if not sent:
        from app.modules.daemon.runtime.service import DaemonRuntimeOffline

        raise DaemonRuntimeOffline(
            "目标机器当前离线或消息下发失败，请确认守护进程在线后重试。",
            details={"daemon_instance_id": str(instance_id)},
        )
    return {"sent": True}


@router.get(
    "/runtimes/{runtime_id}",
    response_model=DaemonRuntimeRead,
)
async def get_runtime(
    runtime_id: uuid.UUID,
    session: SessionDep,
    user: RuntimeAdminUser,
) -> DaemonRuntimeRead:
    """Get daemon runtime info by ID."""
    svc = DaemonService(session)
    result = await svc.get_runtime(runtime_id, user.id, is_platform_admin=user.is_platform_admin)
    if result is None:
        raise DaemonRuntimeNotFound(
            "指定的 runtime 不存在或无权访问。",
            details={"runtime_id": str(runtime_id)},
        )
    runtime, instance = result
    # task-08：service 返回 (runtime, instance) tuple，经 _runtime_read 填
    # daemon_version/daemon_build_id（D-004@v1 / FR-01）。
    return _runtime_read(runtime, None, instance)


@router.post(
    "/runtimes/{runtime_id}/disable",
    response_model=DaemonRuntimeRead,
)
async def disable_runtime(
    runtime_id: uuid.UUID,
    session: SessionDep,
    user: RuntimeAdminUser,
) -> DaemonRuntimeRead:
    """Disable a daemon runtime for placement without deleting it."""
    svc = DaemonService(session)
    runtime = await svc.disable_runtime(
        runtime_id, user.id, is_platform_admin=user.is_platform_admin
    )
    # task-08：service 仅返 DaemonRuntime（disable/enable/mark_offline 未在 task-07
    # 改签名），此处回查 instance 填 daemon_version/daemon_build_id（D-004@v1 / FR-01）。
    # instance=None（迁移期 daemon_instance_id IS NULL）→ 两字段 null，兼容旧 daemon。
    instance = (
        await session.get(DaemonInstance, runtime.daemon_instance_id)
        if runtime.daemon_instance_id is not None
        else None
    )
    return _runtime_read(runtime, None, instance)


@router.post(
    "/runtimes/{runtime_id}/enable",
    response_model=DaemonRuntimeRead,
)
async def enable_runtime(
    runtime_id: uuid.UUID,
    session: SessionDep,
    user: RuntimeAdminUser,
) -> DaemonRuntimeRead:
    """Enable a daemon runtime, restoring online only when heartbeat is fresh."""
    svc = DaemonService(session)
    runtime = await svc.enable_runtime(
        runtime_id, user.id, is_platform_admin=user.is_platform_admin
    )
    # task-08：service 仅返 DaemonRuntime，回查 instance 填版本字段（D-004@v1 / FR-01）。
    instance = (
        await session.get(DaemonInstance, runtime.daemon_instance_id)
        if runtime.daemon_instance_id is not None
        else None
    )
    return _runtime_read(runtime, None, instance)


@router.delete(
    "/runtimes/{runtime_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_runtime(
    runtime_id: uuid.UUID,
    session: SessionDep,
    user: RuntimeAdminUser,
) -> None:
    """Delete a daemon runtime and its bound leases/sessions (ql-20260621-012).

    Physical delete; DB ``ondelete=CASCADE`` clears ``daemon_task_leases`` and
    ``agent_sessions`` bound to this runtime. The daemon re-registers as a new
    runtime on next heartbeat.
    """
    svc = DaemonService(session)
    await svc.delete_runtime(runtime_id, user.id, is_platform_admin=user.is_platform_admin)


@router.post(
    "/runtimes/{runtime_id}/offline",
    response_model=DaemonRuntimeRead,
)
async def mark_runtime_offline(
    runtime_id: uuid.UUID,
    session: SessionDep,
    user: Annotated[User, Depends(get_current_principal)],
) -> DaemonRuntimeRead:
    """Mark a daemon runtime offline during graceful daemon shutdown."""
    svc = DaemonService(session)
    runtime = await svc.mark_offline(runtime_id, user.id)
    # task-08：service 仅返 DaemonRuntime，回查 instance 填版本字段（D-004@v1 / FR-01）。
    instance = (
        await session.get(DaemonInstance, runtime.daemon_instance_id)
        if runtime.daemon_instance_id is not None
        else None
    )
    return _runtime_read(runtime, None, instance)


@router.get(
    "/instances",
    response_model=list[DaemonInstanceRead],
)
async def list_daemon_instances(
    session: SessionDep,
    user: Annotated[User, Depends(get_current_principal)],
) -> list[DaemonInstanceRead]:
    """List online daemon instances for the current user (task-10 / FR-09).

    Used by workspace-daemon-switcher to show available daemons.
    Returns each daemon instance with its enabled provider runtimes so the
    frontend can render provider badges without extra round-trips.
    """
    svc = DaemonService(session)
    await svc.cleanup_stale_runtimes()
    instances = await svc.list_instances(user.id)

    # B2（性能，N+1 规避）：原循环每实例单独查 runtimes（+ 每次重 import RuntimeService），
    # 改成一次 IN 查询按 daemon_instance_id 分组。对齐 list_machines 的 runtimes_by_instance。
    from app.modules.daemon.runtime.service import RuntimeService

    rt_svc = RuntimeService(session)
    runtimes_by_instance = await rt_svc._get_runtimes_by_instances([inst.id for inst in instances])
    reads: list[DaemonInstanceRead] = []
    for inst in instances:
        # task-07：分组值改 list[tuple[runtime, instance]]；此处只用 runtime 字段
        # （instance 与外层 inst 同源，不重复取），解构忽略 instance。
        provider_rows = runtimes_by_instance.get(inst.id, [])
        reads.append(
            DaemonInstanceRead(
                id=inst.id,
                hostname=inst.hostname,
                display_alias=inst.display_alias,
                status=inst.status or "online",
                providers=[
                    DaemonInstanceProviderItem(
                        provider=r.provider or "",
                        status=r.status or "unknown",
                        version=r.version,
                    )
                    for r, _instance in provider_rows
                ],
            )
        )
    return reads


@router.get(
    "/runtimes",
    response_model=list[DaemonRuntimeRead],
)
async def list_runtimes(
    session: SessionDep,
    user: RuntimeAdminUser,
) -> list[DaemonRuntimeRead]:
    """List all daemon runtimes for the current user."""
    svc = DaemonService(session)
    await svc.cleanup_stale_runtimes()
    runtimes = await svc.list_runtimes(user.id)
    # task-08：service 返回 list[tuple[runtime, instance]]，经 _runtime_read 填
    # daemon_version/daemon_build_id（D-004@v1 / FR-01）。
    return [_runtime_read(runtime, None, instance) for runtime, instance in runtimes]


# ── Task lease lifecycle ────────────────────────────────────────────────────


@router.post(
    "/leases/{lease_id}/claim",
    response_model=LeaseClaimResponse,
)
async def claim_lease(
    lease_id: uuid.UUID,
    data: LeaseClaimRequest,
    session: SessionDep,
    user: Annotated[User, Depends(get_current_principal)],
) -> LeaseClaimResponse:
    """Claim a pending task lease for execution.

    task-03（security-audit-remediation / FR-02 / D-001@v1）：lease 归属 runtime
    的 user 必须是当前认证 user（服务层校验），他人 → 404 与不存在同语义。
    """
    svc = DaemonService(session)
    lease, payload = await svc.claim_lease(lease_id, data.runtime_id, actor_user_id=user.id)
    meta = lease.metadata_ or {}
    return LeaseClaimResponse(
        lease_id=lease.id,
        claim_token=meta.get("claim_token", ""),
        payload=payload,
        lease_expires_at=lease.lease_expires_at,
    )


@router.post(
    "/leases/{lease_id}/start",
    response_model=LeaseStartResponse,
)
async def start_lease(
    lease_id: uuid.UUID,
    data: LeaseStartRequest,
    session: SessionDep,
    user: Annotated[User, Depends(get_current_principal)],
) -> LeaseStartResponse:
    """Mark a claimed lease as started (agent is now running)."""
    svc = DaemonService(session)
    lease = await svc.start_lease(lease_id, data.claim_token)
    return LeaseStartResponse(
        lease_id=lease.id,
        status=lease.status or "claimed",
    )


@router.post(
    "/leases/{lease_id}/heartbeat",
    response_model=LeaseHeartbeatResponse,
)
async def lease_heartbeat(
    lease_id: uuid.UUID,
    data: LeaseHeartbeatRequest,
    session: SessionDep,
    user: Annotated[User, Depends(get_current_principal)],
) -> LeaseHeartbeatResponse:
    """Send a heartbeat for an active lease to prevent expiry."""
    svc = DaemonService(session)
    lease = await svc.lease_heartbeat(lease_id, data.claim_token)
    return LeaseHeartbeatResponse(
        lease_id=lease.id,
        status=lease.status or "claimed",
    )


@router.post(
    "/leases/{lease_id}/messages",
    response_model=LeaseMessagesResponse,
)
async def submit_lease_messages(
    lease_id: uuid.UUID,
    data: LeaseMessagesRequest,
    session: SessionDep,
    user: Annotated[User, Depends(get_current_principal)],
) -> LeaseMessagesResponse:
    """Submit agent conversation messages for a running lease."""
    svc = DaemonService(session)
    submission = await svc.submit_messages(
        lease_id,
        data.claim_token,
        data.agent_run_id,
        data.messages,
    )
    # QueuePool 修复 3：Redis publish 在 service 返回（DB 已 commit、连接已归还）
    # 之后执行。Redis 卡死不再持有本请求的 DB 连接池 slot。
    if submission.publish_intent is not None:
        await publish_submitted_messages(submission.publish_intent)
    return LeaseMessagesResponse(accepted=True, count=int(submission))


@router.post(
    "/leases/{lease_id}/complete",
    response_model=LeaseCompleteResponse,
)
async def complete_lease(
    lease_id: uuid.UUID,
    data: LeaseCompleteRequest,
    session: SessionDep,
    user: Annotated[User, Depends(get_current_principal)],
) -> LeaseCompleteResponse:
    """Mark a lease as completed with execution results."""
    svc = DaemonService(session)
    lease = await svc.complete_lease(lease_id, data.claim_token, data.result)
    return LeaseCompleteResponse(
        lease_id=lease.id,
        status=lease.status or "completed",
    )


@router.post(
    "/leases/{lease_id}/sync",
    response_model=LeaseSyncResponse,
)
async def sync_lease_status(
    lease_id: uuid.UUID,
    data: LeaseSyncRequest,
    session: SessionDep,
    user: Annotated[User, Depends(get_current_principal)],
) -> LeaseSyncResponse:
    """Sync AgentRun status from daemon side."""
    svc = DaemonService(session)
    agent_run = await svc.sync_agent_run_status(
        lease_id,
        data.claim_token,
        data.status,
        error=data.error,
    )
    return LeaseSyncResponse(
        agent_run_id=agent_run.id if agent_run else None,
        status=agent_run.status if agent_run else data.status,
    )


# ── Interactive run terminal close (gap-3, design §4) ────────────────────────
# Daemon uplink: SDK result → close AgentRun. Auth via X-Claim-Token header
# (lease-scoped, 32-byte random) instead of the body claim_token used by sync.
# Distinct from sync_agent_run_status: this is for interactive sessions where
# lease.agent_run_id is NULL (D-005@v1) and the run id comes from the path.


class InteractiveRunResultRequest(BaseModel):
    """Body for POST /leases/{lease_id}/runs/{run_id}/result (gap-3).

    Field names mirror the SDK result message shape (snake_case) so the daemon
    can forward verbatim without renaming.
    """

    # SDK result.subtype / top-level status: 'success' | 'error_during_execution' | others
    status: str = Field(min_length=1, max_length=64)
    is_error: bool = False
    # SDK result.subtype (e.g. 'success', 'error_during_execution', 'error_max_turns')
    subtype: str | None = Field(default=None, max_length=64)
    # Optional human-readable summary; stored redacted on AgentRun.output_redacted
    result_summary: str | None = Field(default=None, max_length=20000)
    # ── SDKResultSuccess usage / cost / duration 透传（全部可选，daemon 可能不传，
    # 对应 AgentRun.{total_cost_usd,num_turns,duration_ms,duration_api_ms,
    # input_tokens,output_tokens}，原先 interactive 路径全 NULL）。
    total_cost_usd: float | None = None
    num_turns: int | None = None
    duration_ms: int | None = None
    duration_api_ms: int | None = None
    input_tokens: int | None = None
    output_tokens: int | None = None
    # task-06 / FR-02：daemon classifyModelError 回传的模型层错误（可选）。
    # 旧 daemon 不传 → None → AgentRun.error_detail 保持 None（design §9 兼容）。
    error: ModelErrorDTO | None = None


class InteractiveRunResultResponse(BaseModel):
    agent_run_id: uuid.UUID
    status: str


@router.post(
    "/leases/{lease_id}/runs/{run_id}/result",
    response_model=InteractiveRunResultResponse,
)
async def close_interactive_run(
    lease_id: uuid.UUID,
    run_id: uuid.UUID,
    data: InteractiveRunResultRequest,
    session: SessionDep,
    user: Annotated[User, Depends(get_current_principal)],
    # gap-3 / design §4: lease-scoped claim token in header (distinct from the
    # body claim_token of sync/heartbeat). Fastapi Header() is case-insensitive.
    x_claim_token: Annotated[str, Header(alias="X-Claim-Token", min_length=1)],
) -> InteractiveRunResultResponse:
    """Close an interactive AgentRun from a daemon SDK result (gap-3 / design §4).

    Daemon ``SessionManager._onResult`` → ``hubClient.notifyRunResult`` → here.
    The lease is verified via the ``X-Claim-Token`` header (lease-scoped), and
    the run is bound to the lease's session to prevent cross-session injection.
    Idempotent on already-terminal runs.

    Auth: ``get_current_principal`` accepts the daemon's ``X-API-Key`` (long-lived
    credential issued at register time); ``X-Claim-Token`` authorizes the specific
    lease. A browser JWT would also pass ``get_current_principal`` but normal
    callers are daemon-side only.
    """
    svc = DaemonService(session)
    agent_run = await svc.close_interactive_run(
        lease_id,
        run_id,
        x_claim_token,
        status=data.status,
        is_error=data.is_error,
        subtype=data.subtype,
        result_summary=data.result_summary,
        total_cost_usd=data.total_cost_usd,
        num_turns=data.num_turns,
        duration_ms=data.duration_ms,
        duration_api_ms=data.duration_api_ms,
        input_tokens=data.input_tokens,
        output_tokens=data.output_tokens,
        error=data.error,
    )
    return InteractiveRunResultResponse(
        agent_run_id=agent_run.id,
        status=agent_run.status or "failed",
    )


# ── Daemon-restart session recovery (gap-8.1 / design §11) ─────────────────
# Daemon calls these on boot, BEFORE its three loops (heartbeat/poll/ws), to
# reconcile persisted interactive sessions after a restart. Auth:
# ``get_current_principal`` (daemon X-API-Key). Thin wrappers over
# recover_session_after_daemon_restart / confirm_session_reconnected /
# mark_session_recovery_failed (session/service.py).


class SessionRecoverRequest(BaseModel):
    """Body for POST /sessions/{session_id}/recover (gap-8.1).

    Fields mirror the persisted record reloaded from JsonSessionPersistence;
    backend validates ownership via runtime_id / lease_id / provider /
    lease.kind (never trusts agent_session_id beyond audit).
    """

    runtime_id: uuid.UUID
    lease_id: uuid.UUID
    provider: str = Field(min_length=1, max_length=64)
    # SDK session_id — audit/log only; backend never trusts it for ownership.
    agent_session_id: str = Field(default="", max_length=128)
    interrupted_run_id: uuid.UUID | None = None


class SessionRuntimeRequest(BaseModel):
    """Body for confirm-reconnected / mark-recovery-failed (gap-8.1).

    DS-4（2026-08-21-session-reopen-resume）：可选 ``lease_id`` 携带本次
    SESSION_RESUME 的 lease_id 供陈旧确认防误翻——提供且与 session 当前
    lease 不匹配时幂等跳过；不传（旧 daemon 重启 recover 链路）走既有行为。
    """

    runtime_id: uuid.UUID
    lease_id: uuid.UUID | None = None
    reason: str | None = Field(default=None, max_length=128)


class SessionRecoveryResponse(BaseModel):
    session_id: uuid.UUID
    lease_id: uuid.UUID | None = None
    status: str
    interrupted_run_status: str | None = None


@router.post(
    "/sessions/{session_id}/recover",
    response_model=SessionRecoveryResponse,
)
async def recover_session(
    session_id: uuid.UUID,
    data: SessionRecoverRequest,
    session: SessionDep,
    user: Annotated[User, Depends(get_current_principal)],
) -> SessionRecoveryResponse:
    """Reconcile an interactive session after daemon restart (gap-8.1).

    Daemon ``_recoverSessionsOnBoot`` → ``hubClient.recoverSession`` → here,
    BEFORE ``restoreAndReconnect`` (query resume). Ownership-guarded, idempotent
    on terminal sessions, rotates the lease ``claim_token``. Returns
    ``reconnecting`` when recoverable (daemon proceeds to resume) or
    terminal/rejected otherwise.
    """
    svc = DaemonService(session)
    result = await svc.recover_session_after_daemon_restart(
        session_id,
        runtime_id=data.runtime_id,
        lease_id=data.lease_id,
        provider=data.provider,
        agent_session_id=data.agent_session_id,
        interrupted_run_id=data.interrupted_run_id,
    )
    return SessionRecoveryResponse(
        session_id=result.session_id,
        lease_id=result.lease_id,
        status=result.status,
        interrupted_run_status=result.interrupted_run_status,
    )


@router.post(
    "/sessions/{session_id}/confirm-reconnected",
    response_model=SessionRecoveryResponse,
)
async def confirm_session_reconnected(
    session_id: uuid.UUID,
    data: SessionRuntimeRequest,
    session: SessionDep,
    user: Annotated[User, Depends(get_current_principal)],
) -> SessionRecoveryResponse:
    """Flip reconnecting → active after daemon resume succeeds (gap-8.1).

    Two-phase recover step 2: daemon ran recover_session (wrote reconnecting) →
    restoreAndReconnect (driver.start resume) → on success calls this.
    Optional ``lease_id`` (DS-4): mismatch with the current lease → idempotent
    skip (stale confirmation must not flip a second reopen).
    """
    svc = DaemonService(session)
    result_status = await svc.confirm_session_reconnected(
        session_id,
        runtime_id=data.runtime_id,
        lease_id=data.lease_id,
    )
    return SessionRecoveryResponse(session_id=session_id, status=result_status)


@router.post(
    "/sessions/{session_id}/mark-recovery-failed",
    response_model=SessionRecoveryResponse,
)
async def mark_session_recovery_failed(
    session_id: uuid.UUID,
    data: SessionRuntimeRequest,
    session: SessionDep,
    user: Annotated[User, Depends(get_current_principal)],
) -> SessionRecoveryResponse:
    """Flip reconnecting → failed after daemon resume failed (gap-8.1).

    Daemon calls this when driver.start({resume}) throws (cwd mismatch /
    executable missing / SDK jsonl missing) — session cannot be restored.
    Optional ``lease_id`` (DS-4): mismatch with the current lease → idempotent
    skip (stale failure must not kill a second reopen).
    """
    svc = DaemonService(session)
    result_status = await svc.mark_session_recovery_failed(
        session_id,
        runtime_id=data.runtime_id,
        reason=data.reason or "restore_failed",
        lease_id=data.lease_id,
    )
    return SessionRecoveryResponse(session_id=session_id, status=result_status)


@router.post("/sessions/{session_id}/ready")
async def notify_session_ready(
    session_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_principal)],
) -> dict[str, bool]:
    """Receive daemon session-ready report (task-06 / D-001@v1).

    daemon ``_startInteractiveSession``（fresh create）与 ``restoreAndReconnect``
    （recover）create 完成后调 ``hubClient.notifySessionReady`` → 这里。鉴权后调
    :func:`get_session_readiness` 单例的 ``mark_ready``，唤醒 ``inject_session`` 中
    等待 ready event 的协程（task-08），解 /model 等 inject 偶发空白。

    返回 200 + JSON ``{"ok": true}``（**非 204**）：daemon hub-client ``_request``
    固定 ``JSON.parse``，204 空 body 会抛 ``SyntaxError``（Reverse Sync 由 task-01
    发现）。daemon 不上报 payload，故无 body 模型。
    """
    get_session_readiness().mark_ready(session_id)
    log.info("daemon.session_ready_reported", session_id=str(session_id))
    return {"ok": True}


@router.post(
    "/sessions/{session_id}/plan-response",
    response_model=dict[str, bool],
)
async def handle_plan_response(
    session_id: uuid.UUID,
    data: PlanResponseRequest,
    session: SessionDep,
    user: TaskRunAgentUser,
) -> dict[str, bool]:
    """Receive user's plan-mode decision and push it to the daemon (task-02 / FR-02).

    校验路径与请求体中的 ``session_id`` 一致，确认当前用户拥有该会话，将决策写入
    ``AgentSession.config`` 后通过现有 WebSocket Hub 下发 ``daemon:plan_response``
    控制消息。返回 ``{"ok": true, "delivered": <bool>}``。
    """
    if data.session_id != session_id:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="path session_id does not match body session_id",
        )
    svc = SessionService(session)
    return await svc.handle_plan_response(
        session_id=session_id,
        run_id=data.run_id,
        decision=data.decision,
        feedback=data.feedback,
        user_id=user.id,
    )


@router.post(
    "/sessions/{session_id}/plan-mode-entered",
    response_model=dict[str, bool],
)
async def notify_plan_mode_entered(
    session_id: uuid.UUID,
    data: PlanModeEnteredEvent,
    user: Annotated[User, Depends(get_current_principal)],
) -> dict[str, bool]:
    """Receive daemon plan-mode-entered report and forward to frontend SSE (task-02)."""
    if data.session_id != session_id:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="path session_id does not match body session_id",
        )
    await publish_session_event(session_id, data)
    return {"ok": True}


@router.post(
    "/sessions/{session_id}/bash-status",
    response_model=dict[str, bool],
)
async def notify_bash_status(
    session_id: uuid.UUID,
    data: BashStatusEvent,
    user: Annotated[User, Depends(get_current_principal)],
) -> dict[str, bool]:
    """Receive daemon bash-status report and forward to frontend SSE (task-02)."""
    if data.session_id != session_id:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="path session_id does not match body session_id",
        )
    await publish_session_event(session_id, data)
    return {"ok": True}


@router.post(
    "/sessions/{session_id}/bash-chunk",
    response_model=dict[str, bool],
)
async def notify_bash_chunk(
    session_id: uuid.UUID,
    data: BashChunkEvent,
    user: Annotated[User, Depends(get_current_principal)],
) -> dict[str, bool]:
    """Receive daemon bash-chunk report and forward to frontend SSE (task-02).

    经 ``publish_bash_chunk_event`` 发布，内含 100ms 节流与 8KB 单条截断。
    """
    if data.session_id != session_id:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="path session_id does not match body session_id",
        )
    published = await publish_bash_chunk_event(data)
    return {"ok": True, "throttled": not published}


@router.post(
    "/sessions/{session_id}/agent-task-status",
    response_model=dict[str, bool],
)
async def notify_agent_task_status(
    session_id: uuid.UUID,
    data: AgentTaskStatusEvent,
    user: Annotated[User, Depends(get_current_principal)],
) -> dict[str, bool]:
    """Receive daemon agent-task-status report and forward to frontend SSE (task-02)."""
    if data.session_id != session_id:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="path session_id does not match body session_id",
        )
    await publish_session_event(session_id, data)
    return {"ok": True}


@router.get(
    "/leases/{lease_id}",
    response_model=DaemonTaskLeaseRead,
)
async def get_lease(
    lease_id: uuid.UUID,
    session: SessionDep,
    user: Annotated[User, Depends(get_current_principal)],
) -> DaemonTaskLeaseRead:
    """Get lease info by ID."""
    svc = DaemonService(session)
    lease = await svc.get_lease(lease_id)
    if lease is None:
        raise DaemonLeaseNotFound(
            "任务租约不存在或已被回收。",
            details={"lease_id": str(lease_id)},
        )
    return DaemonTaskLeaseRead.model_validate(lease)


@router.get(
    "/runtimes/{runtime_id}/leases",
    response_model=list[DaemonTaskLeaseRead],
)
async def list_runtime_leases(
    runtime_id: uuid.UUID,
    session: SessionDep,
    user: RuntimeAdminUser,
) -> list[DaemonTaskLeaseRead]:
    """List all leases for a given daemon runtime."""
    svc = DaemonService(session)
    # Verify runtime exists（task-07 后 get_runtime 返回 tuple|None；此处仅做存在性
    # 校验，不解构 —— runtime+lease 的 version 填充由 DaemonTaskLeaseRead 自身负责）。
    runtime_tuple = await svc.get_runtime(runtime_id)
    if runtime_tuple is None:
        raise DaemonRuntimeNotFound(
            "指定的 runtime 不存在或无权访问。",
            details={"runtime_id": str(runtime_id)},
        )
    leases = await svc.list_leases(runtime_id)
    return [DaemonTaskLeaseRead.model_validate(lease) for lease in leases]


@router.post(
    "/runtimes/{runtime_id}/list-dir",
    response_model=ListDirResponse,
)
async def list_dir(
    runtime_id: uuid.UUID,
    data: ListDirRequest,
    session: SessionDep,
    user: Annotated[User, Depends(get_current_principal)],
) -> ListDirResponse:
    """Forward a list_dir request to the bound daemon over WS RPC.

    The daemon performs the actual readdir+stat and allowed_roots validation
    (task-05); backend only owns ownership checks + RPC/HTTP status mapping.
    """
    svc = DaemonService(session)
    # Ownership check: runtime not owned by current user → 404.
    runtime = await svc._get_owned_runtime(runtime_id, user.id)

    # Lazy import (matches placement.py / agent.service.py): the ws_hub
    # singleton accessor is patched per-test via ws_hub.get_daemon_ws_hub, and a
    # module-top `from ... import` would bind a stale/mock ref if this module
    # were first imported while such a patch was active.
    from app.modules.daemon.ws_hub import get_daemon_ws_hub

    hub = get_daemon_ws_hub()
    # task-06: ws_hub 按 daemon_instance_id 路由；runtime_id → daemon_id。
    # 迁移窗口 runtime.daemon_instance_id IS NULL → 回退 runtime_id（兼容旧数据）。
    daemon_id = runtime.daemon_instance_id or runtime_id
    try:
        result = await hub.send_rpc(daemon_id, "list_dir", {"path": data.path})
    except DaemonRuntimeOffline as exc:
        raise DaemonRpcGatewayError(
            "守护进程当前离线，无法浏览目录；请确认守护进程在线后重试。",
            details={
                "runtime_id": str(runtime_id),
                "path": data.path,
                "reason": "offline_or_send_failed",
            },
        ) from exc
    except DaemonRpcTimeout as exc:
        raise DaemonRpcGatewayError(
            "目录浏览请求超时，请稍后重试。",
            details={
                "runtime_id": str(runtime_id),
                "path": data.path,
                "rpc_id": exc.details.get("rpc_id") if exc.details else None,
                "timeout_seconds": exc.details.get("timeout_seconds") if exc.details else None,
            },
        ) from exc
    except DaemonRpcRemoteError as exc:
        # daemon business error — map forbidden → 403 (FR-04), others → 502.
        if exc.code == "forbidden":
            raise DaemonRpcForbiddenError(
                "守护进程拒绝浏览该目录：路径不在允许的访问范围内。",
                details={
                    "runtime_id": str(runtime_id),
                    "path": data.path,
                    "daemon_code": exc.code,
                    "daemon_message": exc.message,
                },
            ) from exc
        raise DaemonRpcRemoteGatewayError(
            "守护进程执行目录浏览失败，请稍后重试。",
            details={
                "runtime_id": str(runtime_id),
                "path": data.path,
                "daemon_code": exc.code,
                "daemon_message": exc.message,
            },
        ) from exc

    entries = result.get("entries", []) if isinstance(result, dict) else []
    return ListDirResponse(entries=entries)


@router.post(
    "/runtimes/{runtime_id}/list-roots",
    response_model=ListRootsResponse,
)
async def list_roots(
    runtime_id: uuid.UUID,
    session: SessionDep,
    user: Annotated[User, Depends(get_current_principal)],
) -> ListRootsResponse:
    """Forward a list_roots request to the bound daemon over WS RPC.

    task-04 · FR-2 / D-002 ownership（runtime 必须属于当前用户）/ D-007 读=owner（非 admin）。
    daemon 返回该主机磁盘根锚点列表（用于前端文件夹选择锚点定位）。
    backend 仅负责 ownership 校验 + RPC/HTTP 状态映射，不解析路径。
    """
    svc = DaemonService(session)
    # Ownership check: runtime not owned by current user → 404.
    runtime = await svc._get_owned_runtime(runtime_id, user.id)

    # Lazy import（与 list_dir / placement.py / agent.service.py 一致）：
    # ws_hub 单例访问器按测试逐个 patch，模块顶部 import 会绑定陈旧/mock 引用。
    from app.modules.daemon.ws_hub import get_daemon_ws_hub

    hub = get_daemon_ws_hub()
    # task-06: ws_hub 按 daemon_instance_id 路由；runtime_id → daemon_id。
    # 迁移窗口 runtime.daemon_instance_id IS NULL → 回退 runtime_id（兼容旧数据）。
    daemon_id = runtime.daemon_instance_id or runtime_id
    try:
        result = await hub.send_rpc(daemon_id, "list_roots", {})
    except DaemonRuntimeOffline as exc:
        raise DaemonRpcGatewayError(
            "守护进程当前离线，无法读取磁盘根目录；请确认守护进程在线后重试。",
            details={
                "runtime_id": str(runtime_id),
                "reason": "offline_or_send_failed",
            },
        ) from exc
    except DaemonRpcTimeout as exc:
        raise DaemonRpcGatewayError(
            "读取磁盘根目录请求超时，请稍后重试。",
            details={
                "runtime_id": str(runtime_id),
                "rpc_id": exc.details.get("rpc_id") if exc.details else None,
                "timeout_seconds": exc.details.get("timeout_seconds") if exc.details else None,
            },
        ) from exc
    except DaemonRpcRemoteError as exc:
        # daemon business error — map forbidden → 403 (FR-04), others → 502.
        if exc.code == "forbidden":
            raise DaemonRpcForbiddenError(
                "守护进程拒绝读取磁盘根目录。",
                details={
                    "runtime_id": str(runtime_id),
                    "daemon_code": exc.code,
                    "daemon_message": exc.message,
                },
            ) from exc
        raise DaemonRpcRemoteGatewayError(
            "守护进程读取磁盘根目录失败，请稍后重试。",
            details={
                "runtime_id": str(runtime_id),
                "daemon_code": exc.code,
                "daemon_message": exc.message,
            },
        ) from exc

    roots = result.get("roots", []) if isinstance(result, dict) else []
    return ListRootsResponse(roots=roots)


# ── Interactive session endpoints (task-05, FR-01/02/04/05) ─────────────────
# DTOs live inline where module-local; the shared/batch DTO home is schema.py.
# 2026-08-14-sessions-portal task-02：SessionCreateRequest/SessionInjectRequest
# 已迁 schema.py 具名模型（openapi 产出具名 schema 供前端生成类型）；此处仅剩
# 响应与窄用途请求 DTO。router only does DTO mapping; all business logic
# + SQL lives in DaemonService.*_session.

# Interactive session callers need task:run_agent (same gate as quick-chat /
# dispatch). Aliased separately so the intent is self-documenting.
TaskRunAgentUser = Annotated[User, Depends(require_permission_any(Permission.TASK_RUN_AGENT))]


def get_permission_service(
    session: SessionDep,
) -> DaemonPermissionService:
    """Construct DaemonPermissionService bound to the request's DB session + ws_hub.

    task-08: DaemonPermissionService wraps DaemonService (which owns the DB
    session + publish/lock helpers) and the process-wide DaemonWsHub singleton.
    The dependency is created per-request so the DB session lifecycle stays
    consistent with other endpoints.
    """
    svc = DaemonService(session)
    # Lazy import (matches placement.py / agent.service.py): the ws_hub
    # singleton accessor is patched per-test via ws_hub.get_daemon_ws_hub, and a
    # module-top `from ... import` would bind a stale/mock ref if this module
    # were first imported while such a patch was active.
    from app.modules.daemon.ws_hub import get_daemon_ws_hub

    hub = get_daemon_ws_hub()
    return DaemonPermissionService(svc, hub)


PermissionServiceDep = Annotated[DaemonPermissionService, Depends(get_permission_service)]


class SessionCreateResponse(BaseModel):
    session_id: uuid.UUID
    run_id: uuid.UUID
    lease_id: uuid.UUID
    status: str
    stream_url: str


class SessionInjectResponse(BaseModel):
    session_id: uuid.UUID
    run_id: uuid.UUID
    status: str


class SessionControlResponse(BaseModel):
    session_id: uuid.UUID
    status: str
    current_run_id: uuid.UUID | None = None


class SessionEndRequest(BaseModel):
    """gap-4 (design §5): daemon uplink body for POST /sessions/{id}/end.

    Optional body carried by the daemon ``notifySessionEnd`` call. ``status``
    is informational (the backend reconciles to ``ended`` regardless — failed
    sessions are still driven through end_session by the daemon after fail()).
    ``reason`` is recorded into the ``session_ended`` SSE event for UI context.
    """

    status: Literal["ended", "failed"] | None = None
    reason: str | None = Field(default=None, max_length=2000)


class SessionRunRead(BaseModel):
    """GET /sessions/{id}/runs 单个 run 项（task-07 / FR-02 / design §7.4）。

    透传 ``AgentRun.error_detail``（模型层 ModelError 序列化值；成功 / 无错误 run
    为 None），供前端拉历史与当前 run 错误。``error_code``（调度层 / 系统错误）
    与 ``error_detail`` 正交共存（D-009），前端可分别用作系统错误兜底与模型错误
    渲染。DTO 内联在此避免触碰 schema.py（非本任务 allowed_path）。

    gap-fix（FR-07 whoLine / FR-08 历史 usage）：追加轮次配置快照与 usage 三组
    字段，均直映 AgentRun 既有列（查询本就 select 整实体，零查询改动）——
      - ``agent_profile_snapshot`` / ``llm_provider_id``：D-008@v1 轮次快照，供前端
        渲染每轮 whoLine（历史不跟随会话当前配置）；
      - ``input_tokens`` / ``output_tokens``：daemon 关单经 close_interactive_run
        写入（gap-3 result 透传），供前端历史回看累计 ctx usage（R-06）。
    全部 nullable——老 run 行 / 未配置轮为 None，前端如实显示未指定/不累计。
    """

    id: uuid.UUID
    status: str
    error_code: str | None = None
    error_detail: dict | None = None
    started_at: datetime | None = None
    finished_at: datetime | None = None
    exit_code: int | None = None
    # ── ql-20260817-003：轮次发送者（守护进程共享场景多用户同会话发言）──
    # 由 runs 查询 left join users 填充；旧 run 行 NULL → 前端不显示发送行（零回归）。
    user_id: uuid.UUID | None = None
    sender_name: str | None = None
    # ── gap-fix：轮次配置快照（FR-07 / D-008@v1）+ usage（FR-08 / R-06）────
    agent_profile_snapshot: dict | None = None
    llm_provider_id: uuid.UUID | None = None
    input_tokens: int | None = None
    output_tokens: int | None = None
    model_config = {"from_attributes": True}


# ── Interactive session permission approval (task-08, FR-07 / D-007@v1) ──────
# DTOs inline (per task-08 allowed_paths: schema.py is the batch DTO home).
# The service is wired via get_permission_service so the request-scoped DB
# session and the process-wide ws_hub singleton are shared with the rest of
# the daemon module.


class PermissionResponseRequest(BaseModel):
    decision: Literal["allow", "deny"]
    message: str | None = Field(default=None, max_length=2000)
    # AskUserQuestion dialog answer. Present iff the originating request was a
    # dialog (the service also detects this via the persisted DB row, so the
    # field is optional and ignored for plain canUseTool approvals).
    dialog_result: dict | None = None


@router.post(
    "/sessions/{session_id}/permissions/{request_id}/response",
    response_model=PermissionResponseRead,
)
async def respond_session_permission(
    session_id: uuid.UUID,
    request_id: str,
    body: PermissionResponseRequest,
    user: TaskRunAgentUser,
    service: PermissionServiceDep,
) -> PermissionResponseRead:
    """User allow/deny for a session permission_request (FR-07 / D-007@v1).

    Handles both plain canUseTool approvals and AskUserQuestion dialogs:
      - plain approval: cancels the 5min timeout timer, publishes
        permission_resolved SSE. 404 when the request has already timed out /
        never existed; 504 when the daemon runtime is offline; 409 when
        manual_approval is disabled.
      - dialog: flips the persisted session_dialog_requests row to answered,
        forwards ``dialog_result`` to the daemon. 404 when the row is
        missing/cancelled; 409 when already answered; 504 when offline.
    """
    return await service.respond_permission(
        user_id=user.id,
        session_id=session_id,
        request_id=request_id,
        decision=body.decision,
        message=body.message,
        dialog_result=body.dialog_result,
    )


# ── Pending dialog recovery (dialog extension) ──────────────────────────────
# Page-refresh recovery: returns the session's still-pending AskUserQuestion
# dialogs so the frontend can re-render the cards after a reconnect. Ownership
# is enforced inside the service (404 on cross-user, no existence leak).


@router.get(
    "/sessions/{session_id}/dialogs",
    response_model=list[SessionDialogRead],
)
async def list_pending_dialogs(
    session_id: uuid.UUID,
    user: TaskRunAgentUser,
    service: PermissionServiceDep,
) -> list[SessionDialogRead]:
    """Return the session's pending AskUserQuestion dialogs (dialog extension).

    Used by the frontend after a page refresh to recover dialogs the user has
    not yet answered. Returns only ``status=pending`` rows, oldest first.
    Cross-user sessions surface as 404 (ownership enforced in the service).
    """
    return await service.list_pending_dialogs(user.id, session_id)


@router.get(
    "/sessions/{session_id}/dialogs/history",
    response_model=list[SessionDialogRead],
)
async def list_dialog_history(
    session_id: uuid.UUID,
    user: TaskRunAgentUser,
    service: PermissionServiceDep,
) -> list[SessionDialogRead]:
    """Return the session's full AskUserQuestion dialog history (pending + answered).

    The interactive session panel uses this to render past Q&A: the live
    AskUserDialogCard is removed once answered and never renders for
    ended/failed sessions, so without this endpoint the history is invisible.
    Cross-user sessions surface as 404 (ownership enforced in the service).
    """
    return await service.list_dialog_history(user.id, session_id)


# ── Session list + history (task-12, FR-10 / D-005@v1) ───────────────────────
# IMPORTANT: ``GET /sessions`` (fixed path) is registered BEFORE the
# parameterized ``/sessions/{session_id}/...`` routes so FastAPI does not match
# the literal "sessions" against a path param. History logs reuse the existing
# AgentRunLogEntry DTO from agent.schema (no field-drift copy).

_SessionStatusQuery = Literal["pending", "active", "reconnecting", "ended", "failed"]
# task-06 / FR-02：引擎胶囊 tab 过滤（与 create 的 InteractiveProviderLiteral 同域，
# Literal 校验 → 未知值 422，与 status 处理一致）。
_SessionProviderQuery = Literal["claude", "codex"]


@router.get(
    "/sessions",
    response_model=AgentSessionListResponse,
)
async def list_sessions(
    session: SessionDep,
    user: TaskRunAgentUser,
    # 2026-08-23-sessions-workspace-hub task-01 / D-103@v1：一次拉取上限放宽
    # le=100 → le=500（portal 单页全量取回；>500 仍 422 拒绝）。
    limit: int = Query(default=20, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    status: _SessionStatusQuery | None = Query(default=None),
    runtime_id: uuid.UUID | None = Query(default=None),
    machine_id: uuid.UUID | None = Query(default=None),
    provider: _SessionProviderQuery | None = Query(default=None),
    q: str | None = Query(default=None, max_length=100),
    # 2026-08-22-workspace-sessions-portal / D-003@v2：workspace/change 级
    # 门户复用本端点，SQL 层精确匹配（照 runtime_id 模式，可选零回归）。
    workspace_id: uuid.UUID | None = Query(default=None),
    change_id: uuid.UUID | None = Query(default=None),
    # 2026-08-24：会话归档过滤（True=只看已归档，False=只看未归档）。
    archived: bool = Query(default=False),
) -> AgentSessionListResponse:
    """List the current user's AgentSessions (owner-scoped, stable paging).

    task-06 / FR-02 / D-003@v1：可选过滤参数 runtime_id / machine_id（经
    daemon_runtimes 关联）/ provider / q（标题模糊，实现为 user_input 的内容
    ilike，见 service 层 docstring）；全部可选，不传时查询与现状一致（零回归）。
    过滤在 SQL 层完成，total 为过滤后总数（R-04 真分页），分页 limit/offset
    作用于过滤结果。machine_id 不匹配 runtime 缺失的旧会话（无 runtime 即无机器）。
    2026-08-22-workspace-sessions-portal / D-003@v2：新增可选 workspace_id /
    change_id（AgentSession 冗余绑定列精确匹配），供 workspace/change 级会话
    门户复用全局端点做 scope 过滤；不传 = 现状（零回归）。
    """
    from app.modules.agent.model import AgentRun, AgentRunLog

    svc = DaemonService(session)
    items, total = await svc.list_agent_sessions(
        user.id,
        limit=limit,
        offset=offset,
        status_filter=status,
        runtime_id=runtime_id,
        machine_id=machine_id,
        provider=provider,
        q=q,
        workspace_id=workspace_id,
        change_id=change_id,
        archived=archived,
    )
    reads = [AgentSessionRead.model_validate(item) for item in items]
    # 2026-08-23-sessions-workspace-hub task-01 / FR-05 / D-108@v2：批量查
    # users 注入 owner_name（照 OwnerRead / 下方 terminating_at 的
    # IN 批查注入先例，免逐行 N+1）。ql-20260823-003：展示名 display_name
    # 优先、回退 username 登录名（用户反馈：树里应显示名称不是登录名）。
    # 属主用户行缺失 / 两字段均未回填的旧数据不在 map 中 → 保持 None
    # （brownfield，不阻断列表）。
    owner_ids = {item.user_id for item in items if item.user_id is not None}
    if owner_ids:
        owner_rows = (
            await session.execute(
                select(User.id, User.display_name, User.username).where(User.id.in_(owner_ids))
            )
        ).all()
        owner_names: dict[uuid.UUID, str] = {
            row[0]: (row[1] or row[2]) for row in owner_rows if (row[1] or row[2]) is not None
        }
        for r in reads:
            r.owner_name = owner_names.get(r.user_id)
    # task-13 / FR-04 / design §5 Phase4：批量查 lease.terminating_at 注入到每个 read。
    # 经 session.lease_id 关联 DaemonTaskLease；只查本页 lease_id 非空子集（IN 避免 N+1）。
    # lease.terminating_at 为空 / session 无 lease → read.terminating_at 保持 None（brownfield）。
    lease_ids = {item.lease_id for item in items if item.lease_id is not None}
    if lease_ids:
        term_rows = (
            await session.execute(
                select(DaemonTaskLease.id, DaemonTaskLease.terminating_at).where(
                    DaemonTaskLease.id.in_(lease_ids)
                )
            )
        ).all()
        term_map: dict[uuid.UUID, datetime] = {
            row[0]: row[1] for row in term_rows if row[1] is not None
        }
        for r in reads:
            if r.lease_id and r.lease_id in term_map:
                r.terminating_at = term_map[r.lease_id]
    # FR-08 / D-006: 复用 list_change_sessions 的首条 user_input 摘要逻辑（前 30 字）。
    # 逻辑与 change/router.py:list_change_sessions 保持同步（R-7），未来可抽共享 helper。
    if items:
        session_ids = [item.id for item in items]
        # P5（2026-08-24 会话审查）：窗口函数分区取每会话首条 user_input——
        # 原实现拉页内会话全部 user_input 行（50KB 文本）Python 取最早，
        # 长会话下列表请求随轮数线性放大。PG/SQLite 双方言支持。
        rn = (
            sa_func.row_number()
            .over(
                partition_by=AgentRun.agent_session_id,
                order_by=(AgentRunLog.timestamp.asc(), AgentRunLog.id.asc()),
            )
            .label("rn")
        )
        title_subq = (
            sa_select(
                AgentRun.agent_session_id.label("session_id"),
                AgentRunLog.content_redacted.label("content"),
                rn,
            )
            .join(AgentRunLog, AgentRunLog.run_id == AgentRun.id)
            .where(
                AgentRun.agent_session_id.in_(session_ids),
                AgentRunLog.channel == "user_input",
            )
            .subquery()
        )
        title_rows = (
            await session.execute(
                sa_select(title_subq.c.session_id, title_subq.c.content).where(title_subq.c.rn == 1)
            )
        ).all()
        content_by = {row.session_id: (row.content or "") for row in title_rows}
        title_map = {sid: (content or "")[:30] or None for sid, content in content_by.items()}
        # task-05（2026-08-23-agent-activity-sessions / design §3.3.4）：标题派生改
        # session.title（ORM 持久化列，tool_report 会话由 task-04 服务端写自动标题）
        # 优先，无标题回落既有首条 user_input 前 30 字派生——chat 会话 title 列恒
        # NULL，行为与现状逐字节一致（零回归）；详情端点 title 为 ORM 列经
        # from_attributes 自动映射，无需本段注入。
        session_titles: dict[uuid.UUID, str | None] = {item.id: item.title for item in items}
        for r in reads:
            r.title = session_titles.get(r.id) or title_map.get(r.id)
    return AgentSessionListResponse(
        items=reads,
        total=total,
        limit=limit,
        offset=offset,
    )


@router.get(
    "/sessions/{session_id}",
    response_model=AgentSessionRead,
)
async def get_session_detail(
    session_id: uuid.UUID,
    session: SessionDep,
    user: TaskRunAgentUser,
) -> AgentSessionRead:
    """Return a single owned AgentSession (task-06 / FR-2 / D-002@v1).

    Read-only single-read counterpart to ``GET /sessions``. Ownership is
    enforced inside the service so a missing OR cross-user session both
    surface as 404 without leaking existence.
    """
    svc = DaemonService(session)
    agent_session = await svc.get_agent_session(session_id, user.id)
    read = AgentSessionRead.model_validate(agent_session)
    # task-13 / FR-04 / design §5 Phase4：经 session.lease_id 关联查 lease.terminating_at。
    # lease 无 / terminating_at 为空 → read.terminating_at 保持 None（brownfield 守护）。
    if agent_session.lease_id is not None:
        lease_row = (
            await session.execute(
                select(DaemonTaskLease.terminating_at).where(
                    DaemonTaskLease.id == agent_session.lease_id
                )
            )
        ).first()
        if lease_row is not None and lease_row[0] is not None:
            read.terminating_at = lease_row[0]
    # 查当前运行 run（attach 恢复 currentRunId，启用打断按钮；无运行 run 则 null）
    from app.modules.agent.model import AgentRun

    current_run = (
        (
            await session.execute(
                select(AgentRun)
                .where(
                    AgentRun.agent_session_id == session_id,
                    AgentRun.status.in_(["pending", "running", "interrupting"]),
                )
                .order_by(AgentRun.started_at.desc())
                .limit(1)
            )
        )
        .scalars()
        .first()
    )
    read.current_run_id = current_run.id if current_run else None
    return read


@router.post(
    "/sessions",
    response_model=SessionCreateResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_session(
    data: SessionCreateRequest,
    session: SessionDep,
    user: TaskRunAgentUser,
) -> SessionCreateResponse:
    """Create a new interactive session and dispatch its first turn (FR-01)."""
    svc = DaemonService(session)
    # 2026-08-14-sessions-portal task-02：DTO 具名化迁 schema.py。runtime_id/
    # agent_profile_id/llm_provider_id 仅透传 service（解析归 task-03）；model
    # 字段已随 design §5 移除（由档案/默认派生）。
    # task-09（2026-08-24-session-team-mission-context / FR-05/06）：预会话团队
    # 任务块透传（共享校验/预建/简报归 service，本端点仅此一处路由改动）。
    result = await svc.create_session(
        user.id,
        provider=data.provider,
        prompt=data.prompt,
        runtime_id=data.runtime_id,
        agent_profile_id=data.agent_profile_id,
        llm_provider_id=data.llm_provider_id,
        manual_approval=data.manual_approval,
        ask_user_only=data.ask_user_only,
        change_id=data.change_id,
        workspace_id=data.workspace_id,
        team_mission=data.team_mission,
    )
    s = result.agent_session
    return SessionCreateResponse(
        session_id=s.id,
        run_id=result.agent_run.id,
        lease_id=result.lease_id,
        status=s.status or "active",
        stream_url=f"/api/daemon/sessions/{s.id}/stream",
    )


@router.post(
    "/sessions/{session_id}/inject",
    response_model=SessionInjectResponse,
    status_code=status.HTTP_201_CREATED,
)
async def inject_session(
    session_id: uuid.UUID,
    data: SessionInjectRequest,
    session: SessionDep,
    user: TaskRunAgentUser,
) -> SessionInjectResponse:
    """Append a new turn run to an active interactive session (FR-02)."""
    svc = DaemonService(session)
    # 2026-08-14-sessions-portal task-02：agent_profile_id/llm_provider_id 仅透传
    # （切档案/切供应商校验与 SESSION_SWITCH_CONFIG 归 task-05）。
    result = await svc.inject_session(
        session_id,
        user.id,
        prompt=data.prompt,
        agent_profile_id=data.agent_profile_id,
        llm_provider_id=data.llm_provider_id,
        # 2026-08-20-session-multimodal-attachments task-05：附件引用透传
        # （协调者扩权本文件：DTO 新字段须经路由转达 service，卡内已同步）。
        attachment_ids=data.attachment_ids or None,
    )
    return SessionInjectResponse(
        session_id=result.agent_session.id,
        run_id=result.agent_run.id,
        status=result.agent_run.status or "pending",
    )


@router.post(
    "/sessions/{session_id}/reopen",
    response_model=SessionReopenResponse,
)
async def reopen_session(
    session_id: uuid.UUID,
    session: SessionDep,
    user: TaskRunAgentUser,
) -> SessionReopenResponse:
    """Reopen an ended Claude session for SDK resume (task-05 / FR-2).

    Validation + optimistic placeholder only — sets ``status=reconnecting``
    and returns immediately; the full lease/WS transition is task-07 and the
    daemon SDK resume is task-08. Never blocks on daemon confirmation
    (design §4.3.1 step 7).
    """
    svc = DaemonService(session)
    return await svc.reopen_session(session_id, user.id)


@router.post(
    "/sessions/{session_id}/interrupt",
    response_model=SessionControlResponse,
)
async def interrupt_session(
    session_id: uuid.UUID,
    session: SessionDep,
    user: TaskRunAgentUser,
) -> SessionControlResponse:
    """Send a turn-level interrupt for the current run (FR-04)."""
    svc = DaemonService(session)
    result = await svc.interrupt_session(session_id, user.id)
    return SessionControlResponse(
        session_id=result.agent_session.id,
        status=result.agent_session.status or "active",
        current_run_id=result.current_run_id,
    )


@router.post(
    "/sessions/{session_id}/end",
    response_model=SessionControlResponse,
)
async def end_session(
    session_id: uuid.UUID,
    request: Request,
    session: SessionDep,
    user: TaskRunAgentUser,
    reason: str = Query(default="manual"),
    # gap-4 (design §5): daemon uplink body. Optional so the front-end
    # (query-only) and the daemon (body) can share this endpoint. When the
    # body carries a reason it takes precedence over the query param.
    end_body: SessionEndRequest | None = None,
) -> SessionControlResponse:
    """End an interactive session: single reconciliation of session/lease/run (FR-05).

    gap-4 (design §5): daemon uplink. The daemon ``SessionManager.end/fail`` →
    ``hubClient.notifySessionEnd`` → this endpoint with ``{status, reason}`` in
    the body and ``X-API-Key`` auth (resolved by ``get_current_principal`` to the
    runtime owner). The front-end still calls with ``?reason=manual`` (no body);
    both paths converge on ``service.end_session``. Body reason wins when present.

    ql-20260623-004: 区分调用方定 session 归属——daemon（无 Bearer，仅
    ``X-API-Key``）传 ``actor_runtime_owner_id``，service 走 runtime 归属校验
    （api-key owner = runtime owner，不查 ``AgentSession.user_id``，否则 admin
    共享 runtime 场景 creator≠owner 必 404）；前端（Bearer JWT）保持 user_id 校验。
    """
    effective_reason = end_body.reason if (end_body and end_body.reason) else reason
    # 无 Authorization: Bearer 即 daemon 身份（X-API-Key）：api-key owner 是
    # runtime owner，走 runtime 归属校验；否则前端 Bearer JWT 走 user_id 校验。
    has_bearer = (request.headers.get("authorization") or "").lower().startswith("bearer ")
    svc = DaemonService(session)
    result = await svc.end_session(
        session_id,
        user.id,
        reason=effective_reason,
        actor_runtime_owner_id=None if has_bearer else user.id,
    )
    return SessionControlResponse(
        session_id=result.agent_session.id,
        status=result.agent_session.status or "ended",
        current_run_id=result.current_run_id,
    )


@router.delete(
    "/sessions/{session_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_session(
    session_id: uuid.UUID,
    session: SessionDep,
    user: TaskRunAgentUser,
) -> None:
    """Delete an owned terminal session without deleting its run history."""
    await DaemonService(session).delete_agent_session(session_id, user.id)


# 2026-08-24：会话归档/取消归档端点（照 delete_session 模式）。


@router.patch(
    "/sessions/{session_id}/archive",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def archive_session(
    session_id: uuid.UUID,
    session: SessionDep,
    user: TaskRunAgentUser,
) -> None:
    """Archive an owned session (hide from default list view)."""
    await DaemonService(session).archive_session(session_id, user.id)


@router.patch(
    "/sessions/{session_id}/unarchive",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def unarchive_session(
    session_id: uuid.UUID,
    session: SessionDep,
    user: TaskRunAgentUser,
) -> None:
    """Unarchive an owned session (restore to default list view)."""
    await DaemonService(session).unarchive_session(session_id, user.id)


async def _inject_run_error_events(
    session_id: uuid.UUID,
    inner: AsyncGenerator[str, None],
) -> AsyncGenerator[str, None]:
    """Wrap ``AgentService.stream_session_logs`` to append ``run_error`` SSE 帧（task-07）。

    design §7.4 / §7.5 error_event_push：既有事件流**原样透传**（不改成功 / 失败的
    turn_completed 帧、不动 done / keepalive）；仅当一个 ``turn_completed`` 帧报告
    ``status=failed`` 且该 run 有 ``error_detail`` 时，在其后**追加**一个 ``run_error``
    数据帧（``run_id`` + ``error{type,code,message,retryable,hint,raw}``），让前端
    实时拿到模型层 ModelError 渲染错误卡片。

    实现为 router 侧包装：生成器本体在 ``AgentService.stream_session_logs``，非本变更
    allowed_path，故只在外层包一层。``error_detail`` 的 DB 查询用短 session（不贯穿
    SSE 生命周期，对齐 stream_session_logs 的连接池安全约束）；``turn_completed`` 由
    ``close_interactive_run`` 在 DB commit 之后才 publish，故此处查到的 error_detail
    必然已落库（run_sync/service.py commit :968 早于 session publish :1038）。

    事件名用默认 data 帧 + ``event=run_error``（与 turn_completed / log 同通道，前端
    onmessage dispatch），不复用既有 ``event: error`` 命名事件（那是 Redis 连接失败等
    传输层错误，避免语义混淆）。
    """
    from app.modules.agent.model import AgentRun

    async for frame in inner:
        yield frame
        # 仅 data 帧承载可内省的 JSON 载荷（connected / keepalive 注释、done / error
        # 命名事件均无 "data: " 前缀，直接跳过，零干扰既有事件流）。
        if not frame.startswith("data: ") or not frame.endswith("\n\n"):
            continue
        try:
            payload = json.loads(frame[len("data: ") : -2])
        except (json.JSONDecodeError, ValueError, TypeError):
            continue
        if not isinstance(payload, dict):
            continue
        if payload.get("event") != "turn_completed" or payload.get("status") != "failed":
            continue
        run_id_raw = payload.get("run_id")
        if not run_id_raw:
            continue
        try:
            run_id = uuid.UUID(str(run_id_raw))
        except (ValueError, AttributeError):
            continue
        # 短 session 查 error_detail（不占连接池 slot 贯穿 SSE 生命周期）。
        async with get_session_factory()() as db:
            run = await db.get(AgentRun, run_id)
        # 无 error_detail（成功 run 不到此分支；历史 failed run 无 ModelError）→ 不追加。
        if run is None or not run.error_detail:
            continue
        error_event = {
            "event": "run_error",
            "session_id": str(session_id),
            "run_id": str(run_id),
            "error": run.error_detail,
        }
        yield f"data: {json.dumps(error_event, default=str)}\n\n"


@router.get("/sessions/{session_id}/stream")
async def stream_session_logs(
    session_id: uuid.UUID,
    user: TaskRunAgentUser,
) -> StreamingResponse:
    """Stream session-level SSE aggregating every AgentRun of the session.

    Single connection survives across multiple turns (run_id changes); events
    carry ``run_id`` so the frontend can delineate turn boundaries (FR-03 /
    D-005@v1 / R-08). Closes only on ``session_ended``.

    Ownership is verified here (``AgentSession.user_id == user.id``) so neither
    a missing nor a cross-user session reaches the Redis subscription (no
    existence leak). A terminal-status session still enters the generator,
    which emits ``event: done`` internally.

    连接池安全：不注入请求级 session（会贯穿整个 StreamingResponse 生命周期、
    长时间占用一个连接池 slot）。归属校验改用短 session——校验后立即归还；
    StreamingResponse 生成器内部用 get_session_factory() 自建独立短 session
    做逐次查询（见 AgentService.stream_session_logs）。
    """
    # Local imports keep top-level load cost minimal and avoid an import cycle
    # (agent.service imports nothing from daemon, but be defensive).
    from app.modules.agent.model import AgentSession
    from app.modules.agent.service import AgentService

    # 归属校验：短 session，校验完即归还连接池 slot（不贯穿 SSE 生命周期）
    gen = None
    async with get_session_factory()() as session:
        owned = (
            await session.execute(
                select(AgentSession).where(
                    AgentSession.id == session_id,
                    AgentSession.user_id == user.id,
                )
            )
        ).scalar_one_or_none()
        if owned is not None:
            # 构造生成器对象（惰性求值，此处不执行其 body）；session 随
            # async with 结束立即归还，stream_session_logs 内部自建短 session。
            # task-07：外层包一层 _inject_run_error_events，在 failed turn 后追加
            # run_error 帧（透传 ModelError）；既有事件流不变。
            gen = _inject_run_error_events(
                session_id,
                AgentService(session).stream_session_logs(session_id),
            )
    if owned is None:
        raise DaemonSessionNotFound(
            "指定的会话不存在或无权访问。",
            details={"session_id": str(session_id)},
        )

    return StreamingResponse(
        gen,
        media_type="text/event-stream",
        headers=_SESSION_SSE_HEADERS,
    )


@router.get(
    "/sessions/{session_id}/runs",
    response_model=list[SessionRunRead],
)
async def list_session_runs(
    session_id: uuid.UUID,
    session: SessionDep,
    user: TaskRunAgentUser,
) -> list[SessionRunRead]:
    """List the AgentRuns of an owned session, each carrying error_detail (task-07 / FR-02).

    design §7.4：响应 run 项含 ``error_detail``（模型层 ModelError；成功 / 无错误
    run 为 None），供前端拉历史与当前 run 错误。归属 / 存在性复用
    ``get_agent_session``（missing / 跨用户 / 软删均 404，不泄露存在性），与其它
    session 读端点同一道闸门。查询内联在此（service.py 非本任务 allowed_path），
    与 get_session_detail 的 run 查询同款。
    """
    from app.modules.agent.model import AgentRun
    from app.modules.auth.model import User as AuthUser

    svc = DaemonService(session)
    # 归属 / 存在性校验（404 on missing / cross-user / soft-deleted）。
    await svc.get_agent_session(session_id, user.id)
    rows = (
        await session.execute(
            select(AgentRun, AuthUser.display_name)
            .join(AuthUser, AuthUser.id == AgentRun.user_id, isouter=True)
            .where(AgentRun.agent_session_id == session_id)
            .order_by(AgentRun.started_at.desc())
        )
    ).all()
    return [
        SessionRunRead.model_validate(run).model_copy(update={"sender_name": display_name})
        for run, display_name in rows
    ]


@router.get(
    "/sessions/{session_id}/logs",
    response_model=list,  # response items are AgentRunLogEntry
)
async def get_session_logs(
    session_id: uuid.UUID,
    session: SessionDep,
    user: TaskRunAgentUser,
    after: datetime | None = Query(
        None,
        description=(
            "增量游标（ISO timestamp，2026-08-24 会话审查 P4）：只返回 timestamp "
            "严格更新的日志；不传返回全量。同批日志共用同一 timestamp，调用方应"
            "回退 1-2s 重叠窗口并按 log_id 去重"
        ),
    ),
) -> list[AgentRunLogEntry]:
    """Return all logs of a session, aggregated across AgentRuns (D-005@v1).

    Read-only. Ownership / existence follow the same resource-hiding 404 as
    the other session endpoints (no existence leak for missing / cross-user).
    Response items reuse the existing ``AgentRunLogEntry`` DTO; ``run_id`` is
    preserved so the frontend can delineate turn boundaries.
    """
    svc = DaemonService(session)
    logs = await svc.get_agent_session_logs(session_id, user.id, after=after)
    return [AgentRunLogEntry.model_validate(log) for log in logs]


# ── Session team mission trigger/list（2026-08-22-team-session-unify task-03）──
# 会话内团队能力数据源（design §5 Phase 1 / §7）：POST 预建 mission（scope 冻结
# 快照 + objective 空落占位 + 活跃冲突 409 R-07），GET 供前端 TeamTaskBlock 轮询。
# 归属校验同 get_session_detail 口径（missing/跨用户 → 404 资源隐藏）。


async def _session_has_active_turn(session: AsyncSession, session_id: uuid.UUID) -> bool:
    """会话当前是否有活跃 turn（run pending/running/interrupting）。

    扩展后 derive_status 的 ``session_active_turn`` 入参（task-02 契约）：主控轮
    还在跑 → 会话 mission 不进 awaiting_input 档。状态集合与 get_session_detail
    的 current_run 查询同口径。
    """
    from app.modules.agent.model import AgentRun

    stmt = (
        select(AgentRun.id)
        .where(
            AgentRun.agent_session_id == session_id,
            AgentRun.status.in_(["pending", "running", "interrupting"]),
        )
        .limit(1)
    )
    return (await session.execute(stmt)).first() is not None


async def _team_mission_summary(
    session: AsyncSession,
    mission: AgentMission,
    *,
    session_active_turn: bool,
) -> TeamMissionSummary:
    """AgentMission + 全量 run → TeamMissionSummary（触发/列表共用组装）。

    - status 用扩展后 ``derive_status``（task-02 契约：converged/has_session/
      session_active_turn 会话维度入参，含 awaiting_input 档）；
    - workers 仅 ``role != orchestrator`` 分身 run（D-009：主控轮不进概要；
      Python 比较 None != 'orchestrator' 为 True，NULL role 分身天然保留）；
    - scope 概要读落库冻结快照，NULL 缺省回落 [anchor]（单 ws 语义）。

    mission 模块延迟 import（与 orchestrator.schedule_loop 同款，避免循环
    import；task-02 并行时序下也保证本模块可 import）。
    """
    from app.modules.agent.control import MissionControlService
    from app.modules.agent.mission import derive_status

    ctrl = MissionControlService(session)
    all_runs = await ctrl.worker_runs(mission.id)
    status = derive_status(
        all_runs,
        cancelled=mission.cancelled_at is not None,
        converged=mission.converged_at is not None,
        has_session=mission.session_id is not None,
        session_active_turn=session_active_turn,
    )
    return TeamMissionSummary(
        mission_id=mission.id,
        status=status,
        objective=mission.objective,
        scope_workspace_ids=list(mission.scope_workspace_ids or [str(mission.workspace_id)]),
        budget_usd=mission.budget_usd,
        workers=[
            TeamMissionWorkerSummary(
                run_id=r.id,
                role=r.role,
                status=r.status,
                objective=r.objective,
                workspace_id=str(r.target_workspace_id or mission.workspace_id),
            )
            for r in all_runs
            if r.role != "orchestrator"
        ],
    )


async def validate_team_mission_block(
    session: AsyncSession,
    user: User,
    block: TeamMissionTriggerRequest | TeamMissionCreateBlock,
    *,
    fallback_workspace_id: uuid.UUID | None,
) -> tuple[list[uuid.UUID], uuid.UUID]:
    """团队任务块 scope/项目维度共享校验（task-07 自 trigger 端点逐字抽出）。

    trigger 端点（TeamMissionTriggerRequest）与 create 路径
    （SessionCreateRequest.team_mission → TeamMissionCreateBlock，task-09）共用
    同一实现——两 DTO 六字段同名同形态（schema.py），结构复用无复制粘贴。

    - scope 解析：``block`` 未传 → ``fallback_workspace_id``（trigger=会话绑定
      工作区）；两者皆无 → 422（CC-10 同款语义）；传了则去重保序；
    - 项目维度（复用旧项目端点口径，agent/router.py:1239-1357）：非项目经理
      （非超管）→ 403；scope ⊄ 项目关联工作区 → 422；
    - anchor 派生：scope 内 type=backend-code 优先否则第一个（agent/router.py
      :1295-1309 口径）；单工作区 anchor 即该工作区（免查 Workspace type）。

    Returns:
        ``(scope_ids, anchor_id)``——去重保序后的 scope 与派生 anchor。
    """
    # scope 解析：未传取会话绑定工作区；两者皆无 → 422。
    if block.scope_workspace_ids:
        scope_ids = list(dict.fromkeys(block.scope_workspace_ids))  # 去重保序
    elif fallback_workspace_id is not None:
        scope_ids = [fallback_workspace_id]
    else:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="该会话未绑定工作区，请在触发团队任务时显式选择工作区范围（scope_workspace_ids）。",
        )

    anchor_id: uuid.UUID
    if block.project_id is not None:
        # 项目经理/超管校验（复用 ppm/common/data_scope 口径，非项目经理 403）。
        from app.modules.ppm.common.data_scope import is_super_admin, manager_project_ids

        if not (
            await is_super_admin(session, user)
            or block.project_id in await manager_project_ids(session, user)
        ):
            from app.core.errors import PermissionDenied

            raise PermissionDenied(
                "仅项目经理可创建项目维度的会话团队任务。",
                details={"project_id": str(block.project_id)},
            )

        # scope ⊆ 项目关联工作区（复用 workspace link_service.list_by_project，越界 422）。
        from app.modules.workspace import link_service

        bound_workspaces = await link_service.list_by_project(
            session, ppm_project_id=block.project_id
        )
        bound_ids = {w.workspace_id for w in bound_workspaces}
        invalid_ids = set(scope_ids) - bound_ids
        if invalid_ids:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"指定的工作区不在项目关联范围内：{', '.join(str(i) for i in invalid_ids)}",
            )

        # anchor 缺省：scope 内 type=backend-code 优先否则第一个（对齐
        # agent/router.py:1295-1309 旧项目端点口径，逐字同款 backend_ws 选择）。
        backend_ws = next(
            (
                w
                for w in bound_workspaces
                if w.type == "backend-code" and w.workspace_id in scope_ids
            ),
            None,
        )
        anchor_id = backend_ws.workspace_id if backend_ws else scope_ids[0]
    elif len(scope_ids) == 1:
        anchor_id = scope_ids[0]  # 单工作区：anchor 即该工作区（免查 Workspace type）
    else:
        # 非项目多工作区：scope 内 type=backend-code 优先否则第一个（同口径）。
        from app.modules.workspace.model import Workspace

        ws_rows = (
            (await session.execute(select(Workspace).where(Workspace.id.in_(scope_ids))))
            .scalars()
            .all()
        )
        type_by_id = {w.id: w.type for w in ws_rows}
        anchor_id = next(
            (sid for sid in scope_ids if type_by_id.get(sid) == "backend-code"),
            scope_ids[0],
        )

    return scope_ids, anchor_id


@router.post(
    "/sessions/{session_id}/team-mission",
    response_model=TeamMissionSummary,
    status_code=status.HTTP_201_CREATED,
)
async def trigger_session_team_mission(
    session_id: uuid.UUID,
    data: TeamMissionTriggerRequest,
    session: SessionDep,
    user: TaskRunAgentUser,
) -> TeamMissionSummary:
    """预建会话团队 mission（design §5 Phase 1 / §7）。

    - 归属校验：跨用户/不存在 → 404（``svc.get_agent_session``，同
      get_session_detail 资源隐藏口径）；
    - 活跃冲突：会话已有活跃 mission（未收敛未取消）→ 409（R-07，经 task-02
      ``get_active_mission_for_session`` 判活跃，与 uq_agent_missions_session_active
      部分唯一索引同语义）；
    - scope 解析：未传 → 会话绑定工作区；会话无工作区且未传 → 422（CC-10 同款）；
    - 项目维度校验复用旧项目端点口径（agent/router.py:1239-1357，本卡迁移复用）：
      非项目经理（非超管）→ 403；scope ⊄ 项目关联工作区 → 422；anchor 缺省取
      scope 内 type=backend-code 优先否则第一个（DTO 不带 anchor，服务端派生）
      ——以上经 ``validate_team_mission_block`` 共享函数（task-07 抽出，create
      路径 task-09 复用同一实现）；
    - 落库走 ``OrchestratorService.team_mission_entry`` 的 ``"session"`` 预建模式
      （不建主控 run / 不派 lease / objective 空落 SESSION_OBJECTIVE_PLACEHOLDER）。
    """
    svc = DaemonService(session)
    agent_session = await svc.get_agent_session(session_id, user.id)

    # 活跃冲突（R-07 单活跃约束）。
    from app.modules.agent.mission import get_active_mission_for_session

    active_mission = await get_active_mission_for_session(session, session_id)
    if active_mission is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="该会话已有进行中的团队任务，请先收敛或取消后再发起新任务。",
        )

    # scope/项目维度/anchor 校验抽共享函数（task-07）：与 create 路径
    # （SessionCreateRequest.team_mission，task-09）单一实现，行为逐字不变。
    scope_ids, anchor_id = await validate_team_mission_block(
        session,
        user,
        data,
        fallback_workspace_id=agent_session.workspace_id,
    )

    from app.modules.agent.orchestrator import OrchestratorService

    mission, _main_run = await OrchestratorService(session).team_mission_entry(
        workspace_id=anchor_id,
        objective=data.objective or "",
        created_by=user.id,
        # change_id 继承会话上下文（会话即团队任务的发起锚点，D-001 会话内能力）。
        change_id=agent_session.change_id,
        constraints=None,
        budget_usd=data.budget_usd,
        worker_preset=data.worker_preset,
        main_agent_config=data.main_agent_config,
        orchestration_mode="session",
        scope_workspace_ids=scope_ids,
        project_id=data.project_id,
        session_id=session_id,
    )
    log.info(
        "session_team_mission_prebuilt",
        session_id=str(session_id),
        mission_id=str(mission.id),
        anchor_workspace_id=str(anchor_id),
        project_id=str(data.project_id) if data.project_id else None,
    )
    return await _team_mission_summary(
        session,
        mission,
        session_active_turn=await _session_has_active_turn(session, session_id),
    )


@router.get(
    "/sessions/{session_id}/team-missions",
    response_model=list[TeamMissionSummary],
)
async def list_session_team_missions(
    session_id: uuid.UUID,
    session: SessionDep,
    user: TaskRunAgentUser,
) -> list[TeamMissionSummary]:
    """列出会话全部团队 mission（created_at 倒序）+ 分身概要（TeamTaskBlock 数据源）。

    归属校验同 POST（404 资源隐藏）；workers 仅 ``role != orchestrator`` 分身
    run（D-009）；status 用扩展后 derive_status（含 awaiting_input，会话维度入参
    ——session_active_turn 对整个列表只需一次查询）。
    """
    svc = DaemonService(session)
    await svc.get_agent_session(session_id, user.id)

    from app.modules.agent.model import AgentMission

    missions = (
        (
            await session.execute(
                select(AgentMission)
                .where(AgentMission.session_id == session_id)
                .order_by(AgentMission.created_at.desc())
            )
        )
        .scalars()
        .all()
    )
    session_active_turn = await _session_has_active_turn(session, session_id)
    return [
        await _team_mission_summary(session, m, session_active_turn=session_active_turn)
        for m in missions
    ]


# ── llm-proxy 透传端点（task-04 / FR-03 / D-003@v1）───────────────────────────


# litellm_model_name（task-09 单一真相源，litellm_client.py:41）格式 ``usr-<uid>-<pid>``。
# 归属断言只信任能完整解析出两个 UUID 的形态；其余 model 名（claude-haiku-4-5 内置
# 档位名 / LiteLLM 部署名）无归属语义，不在此拦（LiteLLM 自会按无 deployment 失败）。
_LITELLM_MODEL_NAME_RE = re.compile(r"^usr-([0-9a-fA-F-]{36})-([0-9a-fA-F-]{36})$")

# 透传时剥离的 hop-by-hop / 逐跳头（RFC 7230 §6.1）+ Host（httpx 按目标 URL 自建）
# + Content-Length（body 经读流后重组，长度由 httpx 重算，透传旧值会错）。
_HOP_BY_HOP_HEADERS = frozenset(
    {
        "connection",
        "keep-alive",
        "proxy-authenticate",
        "proxy-authorization",
        "te",
        "trailers",
        "transfer-encoding",
        "upgrade",
        "host",
        "content-length",
    }
)

# 转发路径白名单（step-14 QA H-1）：只透传推理面端点，收紧 LiteLLM admin API
# 暴露面——同 base_url 下 /model/new、/key/generate、/user/* 等管理端点以 master
# key 为管理员凭证，任意路径透传 = 任意有效用户可打 admin API。白名单按 Claude
# Code 子进程 + LiteLLM 实际调用面定（/v1/messages 主通道 + /v1/models 探活为
# 刚需，completions / chat/completions / count_tokens 为 OpenAI 格式兼容面）；
# 不匹配 404（与 D-001 owner-only 同语义，不泄露端点存在性）。
_LLM_PROXY_PATH_RE = re.compile(
    r"^v1/(messages|models|completions|chat/completions|count_tokens)(/.*)?$"
)

# Claude Code 子进程实际使用的请求方法（POST /v1/messages 主通道 + GET /v1/models
# 探活 / OPTIONS·HEAD CORS 预检类）。其余方法无业务场景——api_route 的 methods 集
# 即显式白名单（不在列的 method 由 FastAPI 直接 405，降低攻击面）。
_LLM_PROXY_METHODS = ["GET", "POST", "OPTIONS", "HEAD"]

# 上游 LiteLLM 转发超时（对齐 R-02 应对策略；read 放宽给 SSE 逐 token 长流）。
_LLM_PROXY_TIMEOUT = httpx.Timeout(connect=10.0, read=300.0, write=60.0, pool=10.0)


def _extract_proxy_model_name(body_bytes: bytes, path: str) -> str | None:
    """从 POST body（JSON ``model`` 字段）或 path 中提取 model 名（task-04）。

    Claude Code 打 /v1/messages 时 model 在 body；path 兜底防御性保留（未来
    /models/{model} 类路由）。解析失败 / 非 JSON → None（无 model 语义，放行）。
    """
    if body_bytes:
        try:
            parsed = json.loads(body_bytes)
            if isinstance(parsed, dict) and isinstance(parsed.get("model"), str):
                return parsed["model"]
        except (ValueError, TypeError):
            return None
    seg = path.rstrip("/").rsplit("/", 1)[-1]
    return seg or None


# 拆 GET/POST 两个入口共享内部实现：api_route 多方法会让 FastAPI 为每个 method 生成
# 同名 operation id，openapi-typescript 生成重复 TS 标识符（api-types.ts 编译炸）。
# GET/HEAD 同读语义、POST 主通道；OPTIONS 由 Starlette CORSMiddleware 处理。
@router.get("/llm-proxy/{path:path}", include_in_schema=True)
async def llm_proxy_get(path: str, request: Request) -> StreamingResponse:
    return await _llm_proxy_impl(path, request)


@router.post("/llm-proxy/{path:path}", include_in_schema=True)
async def llm_proxy_post(path: str, request: Request) -> StreamingResponse:
    return await _llm_proxy_impl(path, request)


async def _llm_proxy_impl(path: str, request: Request) -> StreamingResponse:
    """LiteLLM 透传代理（task-04 / FR-03 / D-003@v1）——master key 唯一注入点。

    master key 收窄（Grill M-1）后 daemon 子进程不再持有 ``litellm_master_key``
    （context.py 两处 openai_chat 分支改下发 ``litellm_proxy`` 标记 + 代理地址），
    子进程的 ``Authorization: Bearer``（daemon apiKey 或 JWT）打本端点，backend：

    1. **鉴权**（Grill UB-4a）：不能走标准 ``get_current_principal`` Depends——
       其 Bearer 分支只认 JWT，而子进程 Bearer 值是 daemon 的 ``shk_live_``
       apiKey。复用 task-01 ``_authenticate_ws_upgrade`` 同款分流（X-API-Key /
       Bearer ``shk_live_`` 前缀 → ApiKeyService；否则 JWT decode + DB 查用户），
       经 :func:`_authenticate_http_bearer` 薄封装（HTTP Request 与 WebSocket
       的 ``headers`` API 同构）。失败 401。
    2. **model 归属断言**（Grill UB-4b）：POST body 的 ``model`` 字段形如
       ``usr-<uid>-<pid>``（litellm_model_name 单一真相源格式）时，断言 uid ==
       认证 user.id，不匹配 403——任何有效用户不能经代理消耗他人上游 key。
       无 model 字段（GET /models 类）放行转发并记 warn。
    3. **转发**：httpx AsyncClient 流式转发 ``settings.litellm_base_url + '/' +
       path``，注入 ``Authorization: Bearer {settings.litellm_master_key}``，
       响应经 StreamingResponse 逐块透传（上游状态码 + 头），剥离 hop-by-hop。

    master key 只存在于 backend 进程内（转发瞬间注入）：不进日志 / 响应 / 错误
    信息（constraints）。请求 body 读流后驻留内存副本转发（不落盘不复述）；
    httpx client 按请求短建短收（对齐 R-02，不占全局连接池 slot）。
    """
    settings = get_settings()
    if not settings.litellm_master_key:
        # fail-fast：master key 未配置时绝不匿名转发上游（503 比依赖上游拒绝更可诊断）。
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="llm proxy upstream not configured",
        )

    # ── 0. 路径白名单（step-14 QA H-1）──非推理面路径一律 404，不触上游。
    # master key 注入使本代理等同 admin 通道，任何非白名单路径（LiteLLM admin
    # API：/model/new、/key/generate、/user/* 等）都不得经代理可达。
    if _LLM_PROXY_PATH_RE.match(path) is None:
        log.warning("llm_proxy_path_not_allowed", method=request.method, path=path)
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="llm proxy path not allowed"
        )

    # ── 1. 鉴权（复用 task-01 分流口径，失败 401）──
    principal = await _authenticate_http_bearer(request)
    if principal is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="authentication required",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # ── 2. model 归属断言（Grill UB-4b）──
    body_bytes = b""
    model_name: str | None = None
    if request.method == "POST":
        body_bytes = await request.body()
        model_name = _extract_proxy_model_name(body_bytes, path)
        if model_name is not None:
            m = _LITELLM_MODEL_NAME_RE.match(model_name)
            if m is not None and m.group(1) != str(principal.id):
                # 不回显 model 名 / uid——403 detail 固定短语，不泄请求内容。
                log.warning(
                    "llm_proxy_model_ownership_mismatch",
                    path=path,
                    principal_user_id=str(principal.id),
                )
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="model ownership mismatch",
                )

    if not model_name:
        # GET /models 等无 model 语义请求放行（warn 留痕，不拦——LiteLLM 侧
        # 列表按 master key 权限返回，无归属维度）。
        log.info("llm_proxy_request_without_model", method=request.method, path=path)

    # ── 3. 流式转发（master key 仅在此时注入）──
    # query string 透传（step-14 QA L-2）：原请求带 ?… 时拼回上游 URL（Claude Code
    # 打 /v1/messages?beta=true 类带参请求此前会被静默丢参）。
    upstream_url = f"{settings.litellm_base_url.rstrip('/')}/{path}"
    if request.url.query:
        upstream_url = f"{upstream_url}?{request.url.query}"

    fwd_headers: dict[str, str] = {}
    for key, value in request.headers.items():
        # 剥离 hop-by-hop；Authorization 一律丢弃（大小写不敏感——httpx 下来的
        # 是小写 authorization），下方统一替换为 master key，绝不双发。
        if key.lower() not in _HOP_BY_HOP_HEADERS and key.lower() != "authorization":
            fwd_headers[key] = value
    fwd_headers["Authorization"] = f"Bearer {settings.litellm_master_key}"

    # 上游响应元数据经 holder 透出（StreamingResponse 需在返回前定状态码/头，
    # 而 httpx stream 模式不 raise_for_status，透传必须显式取 resp.status_code）。
    upstream_meta: dict[str, Any] = {}

    async def _forward() -> AsyncGenerator[bytes]:
        async with httpx.AsyncClient(timeout=_LLM_PROXY_TIMEOUT) as client:
            upstream_request = client.build_request(
                request.method,
                upstream_url,
                headers=fwd_headers,
                content=body_bytes if body_bytes else None,
            )
            upstream_response = await client.send(upstream_request, stream=True)
            upstream_meta["status_code"] = upstream_response.status_code
            upstream_meta["headers"] = upstream_response.headers
            try:
                async for chunk in upstream_response.aiter_raw():
                    yield chunk
            finally:
                await upstream_response.aclose()

    # 先探一块拿到上游状态码 / 头（在返回 StreamingResponse 之前，此处抛错可
    # 落 502 而不是吞成 200 空响应）；空响应体（HEAD）走 StopAsyncIteration 分支。
    gen = _forward()
    chunks: list[bytes] = []
    try:
        chunks.append(await gen.__anext__())
    except StopAsyncIteration:
        pass
    except httpx.HTTPError as exc:
        log.warning("llm_proxy_upstream_failed", path=path, error_type=type(exc).__name__)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="llm proxy upstream unavailable",
        ) from exc

    upstream_headers = upstream_meta.get("headers") or {}
    passthrough_headers = {
        k: v for k, v in upstream_headers.items() if k.lower() not in _HOP_BY_HOP_HEADERS
    }

    async def _replay() -> AsyncGenerator[bytes]:
        for chunk in chunks:
            yield chunk
        async for chunk in gen:
            yield chunk

    return StreamingResponse(
        _replay(),
        status_code=upstream_meta.get("status_code", status.HTTP_200_OK),
        headers=passthrough_headers,
    )


# ── WebSocket endpoint ───────────────────────────────────────────────────────


async def _authenticate_http_bearer(request: Request) -> User | None:
    """task-04（FR-03 / D-003@v1）：HTTP 请求凭据解析——WS 升级鉴权的 Request 版。

    :func:`_authenticate_ws_upgrade` 的分流口径逐字一致（X-API-Key →
    ApiKeyService；Bearer ``shk_live_`` 前缀短路 → ApiKeyService；否则 JWT
    decode + DB 查用户，active / 未软删）。HTTP ``Request.headers`` 与
    WebSocket ``headers`` API 同构，本 helper 把复用做到参数层（duck-typed
    ``headers`` 属性），供 llm-proxy 端点在标准 Depends 鉴权之外自解析
    （get_current_principal 的 Bearer 分支只认 JWT，不认子进程 shk_live_ Bearer）。

    返回 :class:`User`；无凭据 / 凭据无效 / 用户已失效返回 None（调用方 401）。
    """
    return await _authenticate_bearer_headers(request.headers)


async def _authenticate_bearer_headers(headers: Any) -> User | None:
    """task-04：凭据分流公共实现（WebSocket / Request ``headers`` 同构复用）。"""

    # 只认 header，不引入 query token 回退（design §5 将删除 query 回退）。
    raw_auth = headers.get("authorization") or headers.get("Authorization")
    api_key = headers.get("x-api-key") or headers.get("X-API-Key")
    if api_key:
        api_key = api_key.strip() or None

    async with get_session_factory()() as session:
        settings = get_settings()
        # 路径 1：X-API-Key header 直接走 ApiKeyService。
        if api_key is not None:
            user = await ApiKeyService(session, settings=settings).authenticate(plaintext=api_key)
            return user

        # 路径 2：Authorization Bearer——shk_live_ 前缀短路走 ApiKeyService
        # （对齐 auth_deps._extract_bearer 的 Bearer 语义），否则 JWT 解码。
        bearer: str | None = None
        if raw_auth:
            parts = raw_auth.split()
            if len(parts) == 2 and parts[0].lower() == "bearer":
                bearer = parts[1].strip() or None
        if bearer is None:
            return None

        if bearer.startswith(API_KEY_PREFIX):
            user = await ApiKeyService(session, settings=settings).authenticate(plaintext=bearer)
            return user

        # JWT 路径：解码 + DB 查用户（active / 未软删，与 get_current_user
        # 同口径）。任何解码失败都按无效凭据处理（调用方 401）。
        try:
            payload = decode_access_token(bearer, settings=settings)
        except AccessTokenError:
            log.info("bearer_auth_jwt_invalid")
            return None
        user = await session.get(User, payload.sub)
        if user is None or user.deleted_at is not None or user.status != "active":
            return None
        return user


async def _authenticate_ws_upgrade(websocket: WebSocket) -> User | None:
    """task-01（FR-01 / D-001@v1）：WS 升级期凭据解析，accept 前调用。

    WS 端点不能走标准 Depends 鉴权（get_current_principal 依赖 Request +
    DI session），starlette WebSocket 恰有同名 ``headers`` / ``query_params``
    API，故本 helper 直接读取升级请求头并自建短 session 解析 principal。

    解析顺序（与 get_current_principal 同源，Bearer 分流对齐 llm-proxy
    task-04 的 ANTHROPIC_AUTH_TOKEN 语义）：

    1. ``X-API-Key: <plaintext>`` → ``ApiKeyService.authenticate``；
    2. ``Authorization: Bearer <token>``：值带 ``shk_live_`` 前缀短路走
       ApiKeyService（子进程只发 Bearer 的场景），否则 JWT 解码 +
       DB 查用户（active / 未软删，校验口径与 get_current_user 一致）。

    返回 :class:`User`；无凭据 / 凭据无效 / 用户已失效一律返回 ``None``
    （调用方据此 close code=4001，reason 建议统一 "authentication
    required"）。归属不匹配**不在本 helper 判断**（4003 语义属调用方，
    daemon WS 与 llm-proxy 各自断言）。

    task-04 llm-proxy 复用契约：本 helper 仅做凭据 → User 解析，不含
    4001/4003 close 行为；拒绝码语义由各调用方落地（daemon WS：4001 无/
    坏凭据、4003 归属不匹配）。task-04 落地后分流公共实现已提取为
    :func:`_authenticate_bearer_headers`（WebSocket / Request ``headers``
    API 同构），本 helper 是其 WebSocket 薄封装。
    """
    return await _authenticate_bearer_headers(websocket.headers)


@router.websocket("/ws")
async def daemon_websocket(
    websocket: WebSocket,
    daemon_local_id: str = Query(
        ...,
        description="Daemon-local UUID (daemon_instances.id). Replaces the legacy runtime_id handshake (task-06 / D-006 / design §5.3).",
    ),
) -> None:
    """WebSocket endpoint for daemon entity real-time communication (task-06).

    Each daemon process connects **once** with its ``daemon_local_id`` (the
    locally-persisted uuid surfaced as ``daemon_instances.id``). The backend
    looks up that id, registers the connection keyed by ``daemon_id``, and
    routes all server→daemon messages over this single socket. Provider-level
    dispatch (which runtime/session a message targets) is carried inside each
    payload's ``runtime_id`` field (design §5.3).

    Breaking change (D-007): the legacy ``?runtime_id=...`` handshake is no
    longer accepted — old daemons are rejected with code=4001 and a hint to
    upgrade.

    task-01（FR-01 / D-001@v1）升级期鉴权：daemon 须带 ``X-API-Key: <shk_live_
    ...>``（或 ``Authorization: Bearer``）连接；在 accept 之前完成凭据解析
    （:func:`_authenticate_ws_upgrade`）并断言归属——无凭据 / 凭据无效
    close 4001，解析出的 user.id 与 ``DaemonInstance.user_id`` 不匹配 close
    4003。**query token 回退已移除**，未升级的旧 daemon 一律 4001。
    """
    # Validate daemon_local_id format before accepting.
    try:
        daemon_id = uuid.UUID(daemon_local_id)
    except (ValueError, AttributeError):
        log.warning("ws_invalid_daemon_local_id", daemon_local_id=daemon_local_id)
        await websocket.close(code=4001, reason="invalid daemon_local_id")
        return

    # Look up the daemon entity (must be registered first via POST /register).
    # Lazy import keeps the model import off the hot path and matches the
    # ws_hub singleton accessor pattern below.
    from app.core.db import get_session_factory
    from app.modules.daemon.model import DaemonInstance

    try:
        session_factory = get_session_factory()
        async with session_factory() as ws_session:
            instance = await ws_session.get(DaemonInstance, daemon_id)
    except Exception:
        log.exception(
            "ws_handshake_instance_lookup_failed",
            daemon_id=str(daemon_id),
        )
        await websocket.close(code=1011, reason="internal error")
        return

    if instance is None:
        # Unknown daemon_local_id → reject (not registered). Old daemons that
        # still send a runtime_id here arrive as a parse-failure above; a
        # daemon_local_id that parses but has no row means the daemon skipped
        # registration — both are handshake failures (D-007 breaking).
        log.warning(
            "ws_handshake_unknown_daemon",
            daemon_id=str(daemon_id),
            hint="daemon must POST /register before opening the WS",
        )
        await websocket.close(
            code=4001, reason="unknown daemon_local_id; upgrade daemon and register first"
        )
        return

    # task-01：accept 之前的升级期鉴权——凭据解析 + daemon 归属断言。
    # 无凭据 / 凭据无效 4001；归属不匹配 4003（不泄露 daemon 存在性之外的
    # 信息，reason 固定语义短语）。
    try:
        principal = await _authenticate_ws_upgrade(websocket)
    except Exception:
        log.exception("ws_upgrade_auth_failed", daemon_id=str(daemon_id))
        await websocket.close(code=1011, reason="internal error")
        return

    if principal is None:
        log.warning("ws_upgrade_auth_rejected", daemon_id=str(daemon_id))
        await websocket.close(code=4001, reason="authentication required")
        return

    if principal.id != instance.user_id:
        log.warning(
            "ws_upgrade_auth_ownership_mismatch",
            daemon_id=str(daemon_id),
            principal_user_id=str(principal.id),
            owner_user_id=str(instance.user_id),
        )
        await websocket.close(code=4003, reason="daemon instance ownership mismatch")
        return

    await websocket.accept()

    # Lazy import (matches placement.py / agent.service.py): the ws_hub
    # singleton accessor is patched per-test via ws_hub.get_daemon_ws_hub, and a
    # module-top `from ... import` would bind a stale/mock ref if this module
    # were first imported while such a patch was active.
    from app.modules.daemon.ws_hub import get_daemon_ws_hub

    hub = get_daemon_ws_hub()
    await hub.connect(daemon_id, websocket)

    try:
        while True:
            try:
                data = await websocket.receive_json()
            except ValueError:
                log.warning(
                    "ws_invalid_json",
                    daemon_id=str(daemon_id),
                )
                continue

            msg_type = data.get("type")

            if msg_type == DAEMON_MSG_HEARTBEAT:
                # design §10 risk control: the daemon may include a provider
                # runtime_id in the payload; validate it belongs to this daemon
                # entity and drop on mismatch (best-effort, never close WS).
                raw_payload = data.get("payload") or {}
                await _validate_payload_runtime_belongs(
                    daemon_id,
                    raw_payload,
                    "heartbeat",
                )
                log.debug("ws_heartbeat_received", daemon_id=str(daemon_id))
                await hub.send_heartbeat_ack(
                    daemon_id,
                    payload_runtime_id=await _payload_runtime_id(raw_payload, daemon_id),
                )
            elif msg_type == DAEMON_MSG_RPC_RESULT:
                # daemon → server RPC reply. Route to the pending future via the
                # hub correlation map; struct validation + error mapping lives in
                # the send_rpc call chain (list-dir endpoint), not here.
                payload = data.get("payload") or {}
                rpc_id = payload.get("rpc_id")
                if not rpc_id:
                    log.warning(
                        "ws_rpc_result_missing_id",
                        daemon_id=str(daemon_id),
                        msg=data,
                    )
                    continue
                await hub.resolve_rpc(rpc_id, payload)
            elif msg_type == DAEMON_MSG_PERMISSION_REQUEST:
                # task-08 / FR-07 / D-007@v1: daemon canUseTool uplink.
                # Validate the payload shape; on any validation error warn and
                # drop (never close the WS — task-03 NFR-05). The permission
                # service runs its own session/runtime/run/manual_approval
                # validation and either publishes SSE + arms the 5min timer or
                # logs a warning and returns.
                raw_payload = data.get("payload") or {}
                try:
                    payload = PermissionRequestPayload(**raw_payload)
                except Exception:
                    log.warning(
                        "ws_permission_request_invalid_payload",
                        daemon_id=str(daemon_id),
                        payload=raw_payload,
                    )
                    continue
                # design §10: the session referenced by the request must be
                # owned by the daemon that opened this connection. The
                # permission service repeats this check internally; we pass the
                # connection's daemon_id so the service can map session → daemon.
                # Open a short-lived DB session for the request (WS loop has no
                # request-scoped dependency). Best-effort; failures only warn.
                try:
                    session_factory = get_session_factory()
                    async with session_factory() as ws_session:
                        svc = DaemonService(ws_session)
                        perm = DaemonPermissionService(svc, hub)
                        await perm.handle_permission_request(daemon_id, payload)
                except Exception:
                    log.exception(
                        "ws_permission_request_handler_failed",
                        daemon_id=str(daemon_id),
                        request_id=payload.request_id,
                    )
            else:
                log.warning(
                    "ws_unknown_message_type",
                    daemon_id=str(daemon_id),
                    msg_type=msg_type,
                )
    except WebSocketDisconnect as exc:
        # 记 close code/reason：区分 1000(主动关) / 1006(网络层断) / 1011 / 4000(replaced) 等，
        # 否则 daemon 端 WS 断开（尤其 import get_spec_bundle 期间）只能看到 "disconnected"，无法定位根因。
        log.info(
            "ws_client_disconnected",
            daemon_id=str(daemon_id),
            code=getattr(exc, "code", None),
            reason=getattr(exc, "reason", None) or "",
        )
    except Exception:
        log.exception("ws_unexpected_error", daemon_id=str(daemon_id))
    finally:
        await hub.disconnect(daemon_id)


async def _payload_runtime_id(
    raw_payload: dict,
    daemon_id: uuid.UUID,
) -> uuid.UUID:
    """Extract ``payload.runtime_id`` if present and well-formed, else daemon_id.

    Used to echo the provider runtime_id back in heartbeat_ack so the daemon
    can correlate the ack to a provider session (design §5.3).
    """
    raw = raw_payload.get("runtime_id")
    if not raw:
        return daemon_id
    try:
        return uuid.UUID(str(raw))
    except (ValueError, AttributeError):
        return daemon_id


async def _validate_payload_runtime_belongs(
    daemon_id: uuid.UUID,
    raw_payload: dict,
    label: str,
) -> None:
    """design §10 risk control: payload.runtime_id must belong to daemon_id.

    Validates that a ``runtime_id`` carried inside an inbound WS payload
    resolves to a ``daemon_runtimes`` row whose ``daemon_instance_id`` equals
    the connection's ``daemon_id``. On mismatch (dirty data / cross-daemon
    leak) the message is *not* rejected here — callers drop the message and
    this helper only emits a warning. Best-effort: DB lookup failures are
    logged and treated as valid (fail-open) so a transient DB hiccup cannot
    stall the WS receive loop.
    """
    raw_rid = raw_payload.get("runtime_id")
    if not raw_rid:
        return  # payload carries no runtime_id — nothing to validate.
    try:
        runtime_id = uuid.UUID(str(raw_rid))
    except (ValueError, AttributeError):
        log.warning(
            "ws_payload_invalid_runtime_id",
            label=label,
            daemon_id=str(daemon_id),
            runtime_id=raw_rid,
        )
        return

    try:
        from app.modules.daemon.model import DaemonRuntime

        session_factory = get_session_factory()
        async with session_factory() as ws_session:
            runtime = await ws_session.get(DaemonRuntime, runtime_id)
    except Exception:
        # Fail-open on DB errors — never stall the WS loop.
        log.exception(
            "ws_payload_runtime_validation_db_error",
            label=label,
            daemon_id=str(daemon_id),
            runtime_id=str(runtime_id),
        )
        return

    if runtime is None or runtime.daemon_instance_id != daemon_id:
        log.warning(
            "ws_payload_runtime_id_mismatch",
            label=label,
            daemon_id=str(daemon_id),
            payload_runtime_id=str(runtime_id),
            bound_daemon_id=str(runtime.daemon_instance_id) if runtime else None,
            hint="dropping message; payload.runtime_id not owned by this connection",
        )


@router.get(
    "/runtimes/{runtime_id}/pending-leases",
    response_model=list[dict],
)
async def get_pending_leases(
    runtime_id: uuid.UUID,
    session: SessionDep,
    user: Annotated[User, Depends(get_current_principal)],
) -> list[dict]:
    """Return all pending leases for a runtime (polled by daemon).

    task-03（security-audit-remediation / FR-02 / D-001@v1）：查询前归属校验
    ——runtime 的 user 必须是当前认证 user，不匹配/不存在 → 404（owner-only，
    跨用户与不存在同语义）。同时把原 raw SQL 改 ORM 查询：原 text() 直绑
    uuid.UUID 参数在 SQLite（CHAR(32) 存储）下 ProgrammingError，且无法挂
    归属校验；ORM ``col()`` 由 dialect 处理 Uuid 绑定，两库行为一致。
    """
    runtime = await session.get(DaemonRuntime, runtime_id)
    if runtime is None or runtime.user_id != user.id:
        raise DaemonRuntimeNotFound(
            "运行时不存在或不属于当前用户。",
            details={"runtime_id": str(runtime_id)},
        )

    result = (
        (
            await session.execute(
                select(DaemonTaskLease)
                .where(
                    DaemonTaskLease.runtime_id == runtime_id,
                    DaemonTaskLease.status == "pending",
                )
                .order_by(DaemonTaskLease.created_at)
            )
        )
        .scalars()
        .all()
    )
    out = []
    for lease in result:
        meta = lease.metadata_ or {}
        # ql-20260823-007：reopen 租约只经 daemon:session_resume WS 消费（设计
        # §6.4），不是任务轮询的消费对象——混进 pending-leases 会被 daemon 的
        # HTTP 轮询兜底认领，随后因无 prompt/run_id 走 interactive_missing_fields
        # 裸退，租约永挂 claimed（2026-08-23 bdec91a4 事故排查发现）。
        # metadata.reopened_from_status 是 reopen 转换写入的精确标记。
        if meta.get("reopened_from_status") is not None:
            continue
        out.append(
            {
                "lease_id": str(lease.id),
                "agent_run_id": str(lease.agent_run_id) if lease.agent_run_id else None,
                "prompt": meta.get("prompt", ""),
                # 原 raw SQL JOIN daemon_runtimes 取 r.provider 兜底；本端点
                # WHERE l.runtime_id = 路径 runtime_id，故 r.provider 恒等于
                # 已取出的 runtime.provider，直接复用。
                "provider": meta.get("provider") or runtime.provider,
                "model": meta.get("model"),
                # daemon 侧自维护 provider→path 映射（daemon.ts _agentPaths），
                # capabilities 已上提到 daemon_instances 且不再含 cmd_path/protocol。
                "cmd_path": "",
                "protocol": "",
            }
        )
    return out


# ---------------------------------------------------------------------------
# 2026-07-07-daemon-skill-execution task-06：platform sillyspec skills 分发端点。
# daemon skill-manager（task-03）启动时查 manifest 比对版本，新则拉 bundle 解压。
# 仿 daemon install bundle 分发：tar.gz + manifest（version=内容 sha256 前缀 + 文件 sha256）。
# ---------------------------------------------------------------------------


@router.get("/skills/latest/manifest")
async def get_skills_manifest(
    user: Annotated[Any, Depends(get_current_principal)],
    session: SessionDep,
) -> dict[str, Any]:
    """Return sillyspec skills manifest (version + file list + sha256 per file).

    daemon skill-manager 用来判定是否需重新拉取 bundle（版本漂移）。
    合并代码库 ``sillyspec-*`` + DB ``CustomSkill``（task-03，每个 → ``<name>/SKILL.md``）。
    源目录无 skills 时返回 404。
    """
    from app.modules.agent.skills_bundle_service import build_skills_manifest

    # task-07 D-004：透传 user.id，让 manifest 按 user 维度合并代码库 sillyspec-* + 该用户私有 CustomSkill。
    manifest = await build_skills_manifest(session=session, user_id=user.id)
    if not manifest.get("files"):
        raise HTTPException(status_code=404, detail="当前没有任何可用的技能包。")
    return manifest


@router.get("/skills/latest/bundle")
async def get_skills_bundle(
    user: Annotated[Any, Depends(get_current_principal)],
    session: SessionDep,
) -> StreamingResponse:
    """Return sillyspec-skills.tar.gz binary stream for daemon download.

    bundle 含代码库 ``sillyspec-*`` skill 目录 + DB ``CustomSkill``，打包为 gzip tar。
    无 skills 时返回 404。
    """
    from app.modules.agent.skills_bundle_service import build_skills_bundle

    # task-07 D-004：透传 user.id，让 bundle 按 user 维度打包代码库 sillyspec-* + 该用户私有 CustomSkill。
    bundle = await build_skills_bundle(session=session, user_id=user.id)
    if not bundle:
        raise HTTPException(status_code=404, detail="当前没有任何可用的技能包。")
    return StreamingResponse(
        io.BytesIO(bundle),
        media_type="application/gzip",
        headers={
            "Content-Disposition": "attachment; filename=sillyspec-skills.tar.gz",
        },
    )


# 2026-08-05-skill-content-viewer task-02：平台 skill 内容只读查看端点。
# 白名单 + 固定 SKILL.md（read_skill_md）天然防路径穿越；权限对齐 manifest。
# 声明在 manifest/bundle 之后（FastAPI 按声明顺序匹配；{skill_name} 不与 latest
# 静态段冲突，但防御性在后避免未来 {skill_name} 误捕获静态段）。
@router.get("/skills/{skill_name}/content")
async def get_skill_content(
    skill_name: str,
    user: Annotated[Any, Depends(get_current_principal)],
) -> dict[str, str]:
    """Return a sillyspec-* skill's SKILL.md content (read-only, traversal-safe).

    ``skill_name`` 必须在 sillyspec-* 白名单内；固定读 SKILL.md（不拼 path）。
    404 = 非白名单 / SKILL.md 缺失；413 = > 1 MiB。
    """
    from app.modules.agent.skills_bundle_service import read_skill_md

    try:
        content = read_skill_md(skill_name)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=413, detail=str(exc)) from exc
    return {"skill_name": skill_name, "content": content}


# ---------------------------------------------------------------------------
# 2026-07-07-skills-mcp-management-ui task-05：daemon 拉 MCP 平台配置端点。
# daemon skill-manager / mcp-config 启动时拉平台默认 mcpServers + 白名单，
# 注入 claude 启动 env（design D-004）。与 task-04 admin GET（/api/platform-
# settings/mcp）的区别：本端点给 daemon 用，**返回原值不脱敏**（daemon 需
# 真实 env 才能注入 claude），admin GET 返回遮蔽值（D-008）。
# 认证走 get_current_principal（daemon X-API-Key，同 skills/latest/* 端点）。
# ---------------------------------------------------------------------------


@router.get("/mcp/config")
async def get_daemon_mcp_config(
    session: SessionDep,
    user: Annotated[Any, Depends(get_current_principal)],
) -> dict[str, Any]:
    """返回平台默认 MCP 配置 + server 白名单（**原值不脱敏**，design D-004）。

    daemon 启动 skill-manager / mcp-config 时拉取，用于：
      * ``platform_default.mcpServers`` → 注入 claude 启动 ``env``（真实值，
        secret 类 env key 不遮蔽，区别 admin GET D-008）；
      * ``whitelist`` → 仅放行白名单内的 server。

    无配置时返回空结构 ``{"platform_default": {"mcpServers": {}}, "whitelist": []}``，
    不报错（daemon 按"无平台默认"处理）。
    """
    from app.modules.settings.router import (
        MCP_PLATFORM_DEFAULT_KEY,
        MCP_WHITELIST_KEY,
        _read_setting_json,
    )

    del user  # 仅做认证（daemon X-API-Key），不使用
    platform_default = await _read_setting_json(
        session, MCP_PLATFORM_DEFAULT_KEY, {"mcpServers": {}}
    )
    # 防御：DB 里若是非 dict 脏数据，归一为空结构而非原样透传。
    if not isinstance(platform_default, dict):
        platform_default = {"mcpServers": {}}
    if not isinstance(platform_default.get("mcpServers"), dict):
        platform_default = {**platform_default, "mcpServers": {}}

    raw_whitelist = await _read_setting_json(session, MCP_WHITELIST_KEY, [])
    whitelist = [str(x) for x in raw_whitelist] if isinstance(raw_whitelist, list) else []

    return {
        "platform_default": platform_default,
        "whitelist": whitelist,
    }
