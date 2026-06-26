"""HTTP routes for daemon runtime management and task lease lifecycle."""

from __future__ import annotations

import uuid
from typing import Annotated, Literal

from fastapi import (
    APIRouter,
    Depends,
    Header,
    Query,
    Request,
    WebSocket,
    WebSocketDisconnect,
    status,
)
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_deps import get_current_principal, require_permission_any
from app.core.db import get_session, get_session_factory
from app.core.logging import get_logger
from app.modules.agent.schema import AgentRunLogEntry
from app.modules.auth.model import User
from app.modules.auth.permissions import Permission
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
from app.modules.daemon.run_sync.service import publish_submitted_messages
from app.modules.daemon.schema import (
    AgentSessionListResponse,
    AgentSessionRead,
    DaemonHeartbeatRequest,
    DaemonHeartbeatResponse,
    DaemonRegisterRequest,
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
    OwnerRead,
    RuntimeUsageListResponse,
    RuntimeUsageWindow,
    SessionReopenResponse,
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

log = get_logger(__name__)


# ── Daemon distribution metadata (public, no auth) ───────────────────────────
# GET /api/daemon/version —— 供前端安装区块 / install.sh 拉取最新版本号与下载地址。
# 当前硬编码；后续可改为读 nginx 托管的 latest.json 或配置中心。
# latest.json（install.sh 消费）字段：version / downloadUrl；本端点多返回 minRequired
# 供前端做版本门槛提示。
DAEMON_LATEST_VERSION = "0.1.0"
DAEMON_MIN_REQUIRED_VERSION = "0.1.0"
DAEMON_DOWNLOAD_URL = "/daemon/latest/sillyhub-daemon.js"


class DaemonVersionResponse(BaseModel):
    """GET /api/daemon/version 响应：daemon 分发元数据（公开端点）。"""

    latest: str = Field(description="最新发布版本号")
    minRequired: str = Field(description="最低兼容版本号（低于则需升级）")  # noqa: N815 - JSON 契约字段名（install.sh/前端消费，不可改 snake_case）
    downloadUrl: str = Field(description="单文件 bundle 下载地址（相对站内路径）")  # noqa: N815 - JSON 契约字段名（install.sh/前端消费，不可改 snake_case）


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
        latest=DAEMON_LATEST_VERSION,
        minRequired=DAEMON_MIN_REQUIRED_VERSION,
        downloadUrl=DAEMON_DOWNLOAD_URL,
    )


# ── Runtime registration & heartbeat ────────────────────────────────────────


@router.post(
    "/register",
    response_model=DaemonRuntimeRead,
    status_code=status.HTTP_201_CREATED,
)
async def register_daemon(
    data: DaemonRegisterRequest,
    session: SessionDep,
    user: Annotated[User, Depends(get_current_principal)],
) -> DaemonRuntimeRead:
    """Register a new daemon runtime or return existing one."""
    svc = DaemonService(session)
    runtime = await svc.register_runtime(
        user.id,
        name=data.name,
        provider=data.provider,
        version=data.version,
        os=data.os,
        arch=data.arch,
        capabilities=data.capabilities,
    )
    return DaemonRuntimeRead.model_validate(runtime)


@router.post(
    "/heartbeat",
    response_model=DaemonHeartbeatResponse,
)
async def daemon_heartbeat(
    data: DaemonHeartbeatRequest,
    session: SessionDep,
    user: Annotated[User, Depends(get_current_principal)],
) -> DaemonHeartbeatResponse:
    """HTTP heartbeat endpoint (fallback for when WebSocket is unavailable)."""
    svc = DaemonService(session)
    runtime = await svc.heartbeat(data.runtime_id)
    return DaemonHeartbeatResponse(
        runtime_id=runtime.id,
        status=runtime.status or "online",
        pending_operations={},
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


def _runtime_read(runtime: object, owner: object | None = None) -> DaemonRuntimeRead:
    """Build DaemonRuntimeRead, attaching nested OwnerRead when an owner user
    row is available (task-04 / D-006@v1)."""
    read = DaemonRuntimeRead.model_validate(runtime)
    if owner is None:
        return read
    return read.model_copy(
        update={
            "owner": OwnerRead(
                user_id=getattr(owner, "id", None),
                email=getattr(owner, "email", None),
                display_name=getattr(owner, "display_name", None),
            )
        }
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
        items=[_runtime_read(runtime, owner) for runtime, owner in rows],
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
    runtime = await svc.update_runtime(
        runtime_id,
        user.id,
        display_alias=data.display_alias,
        display_alias_set="display_alias" in data.model_fields_set,
        is_platform_admin=user.is_platform_admin,
    )
    return DaemonRuntimeRead.model_validate(runtime)


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
    runtime = await svc.get_runtime(runtime_id, user.id, is_platform_admin=user.is_platform_admin)
    if runtime is None:
        raise DaemonRuntimeNotFound(
            f"Daemon runtime '{runtime_id}' not found.",
            details={"runtime_id": str(runtime_id)},
        )
    return DaemonRuntimeRead.model_validate(runtime)


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
    return DaemonRuntimeRead.model_validate(runtime)


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
    return DaemonRuntimeRead.model_validate(runtime)


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
    return DaemonRuntimeRead.model_validate(runtime)


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
    return [DaemonRuntimeRead.model_validate(r) for r in runtimes]


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
    """Claim a pending task lease for execution."""
    svc = DaemonService(session)
    lease, payload = await svc.claim_lease(lease_id, data.runtime_id)
    meta = lease.metadata_ or {}
    return LeaseClaimResponse(
        lease_id=lease.id,
        claim_token=meta.get("claim_token", ""),
        payload=payload,
        lease_expires_at=lease.lease_expires_at,  # type: ignore[arg-type]
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
# mark_session_recovery_failed (service.py:2071 / 2318 / 2375).


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
    """Body for confirm-reconnected / mark-recovery-failed (gap-8.1)."""

    runtime_id: uuid.UUID
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
    """
    svc = DaemonService(session)
    result_status = await svc.confirm_session_reconnected(
        session_id,
        runtime_id=data.runtime_id,
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
    """
    svc = DaemonService(session)
    result_status = await svc.mark_session_recovery_failed(
        session_id,
        runtime_id=data.runtime_id,
        reason=data.reason or "restore_failed",
    )
    return SessionRecoveryResponse(session_id=session_id, status=result_status)


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
            f"Daemon task lease '{lease_id}' not found.",
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
    # Verify runtime exists
    runtime = await svc.get_runtime(runtime_id)
    if runtime is None:
        raise DaemonRuntimeNotFound(
            f"Daemon runtime '{runtime_id}' not found.",
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
    await svc._get_owned_runtime(runtime_id, user.id)

    # Lazy import (matches placement.py / agent.service.py): the ws_hub
    # singleton accessor is patched per-test via ws_hub.get_daemon_ws_hub, and a
    # module-top `from ... import` would bind a stale/mock ref if this module
    # were first imported while such a patch was active.
    from app.modules.daemon.ws_hub import get_daemon_ws_hub

    hub = get_daemon_ws_hub()
    try:
        result = await hub.send_rpc(runtime_id, "list_dir", {"path": data.path})
    except DaemonRuntimeOffline as exc:
        raise DaemonRpcGatewayError(
            f"daemon runtime '{runtime_id}' offline.",
            details={
                "runtime_id": str(runtime_id),
                "path": data.path,
                "reason": "offline_or_send_failed",
            },
        ) from exc
    except DaemonRpcTimeout as exc:
        raise DaemonRpcGatewayError(
            "daemon list_dir rpc timed out.",
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
                "daemon refused list_dir: path outside allowed_roots.",
                details={
                    "runtime_id": str(runtime_id),
                    "path": data.path,
                    "daemon_code": exc.code,
                    "daemon_message": exc.message,
                },
            ) from exc
        raise DaemonRpcRemoteGatewayError(
            f"daemon list_dir failed: {exc.code}.",
            details={
                "runtime_id": str(runtime_id),
                "path": data.path,
                "daemon_code": exc.code,
                "daemon_message": exc.message,
            },
        ) from exc

    entries = result.get("entries", []) if isinstance(result, dict) else []
    return ListDirResponse(entries=entries)


# ── Interactive session endpoints (task-05, FR-01/02/04/05) ─────────────────
# DTOs live inline (per task-05 allowed_paths: schema.py is the batch DTO home
# and must not be modified). router only does DTO mapping; all business logic
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


class SessionCreateRequest(BaseModel):
    provider: Literal["claude", "codex"]
    prompt: str = Field(min_length=1, max_length=8000)
    model: str | None = Field(default=None, max_length=128)
    manual_approval: bool = False
    ask_user_only: bool = False


class SessionCreateResponse(BaseModel):
    session_id: uuid.UUID
    run_id: uuid.UUID
    lease_id: uuid.UUID
    status: str
    stream_url: str


class SessionInjectRequest(BaseModel):
    prompt: str = Field(min_length=1, max_length=8000)


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


# ── Session list + history (task-12, FR-10 / D-005@v1) ───────────────────────
# IMPORTANT: ``GET /sessions`` (fixed path) is registered BEFORE the
# parameterized ``/sessions/{session_id}/...`` routes so FastAPI does not match
# the literal "sessions" against a path param. History logs reuse the existing
# AgentRunLogEntry DTO from agent.schema (no field-drift copy).

_SessionStatusQuery = Literal["pending", "active", "reconnecting", "ended", "failed"]


@router.get(
    "/sessions",
    response_model=AgentSessionListResponse,
)
async def list_sessions(
    session: SessionDep,
    user: TaskRunAgentUser,
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    status: _SessionStatusQuery | None = Query(default=None),
) -> AgentSessionListResponse:
    """List the current user's AgentSessions (owner-scoped, stable paging)."""
    svc = DaemonService(session)
    items, total = await svc.list_agent_sessions(
        user.id,
        limit=limit,
        offset=offset,
        status_filter=status,
    )
    return AgentSessionListResponse(
        items=[AgentSessionRead.model_validate(item) for item in items],
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
    return AgentSessionRead.model_validate(agent_session)


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
    result = await svc.create_session(
        user.id,
        provider=data.provider,
        prompt=data.prompt,
        model=data.model,
        manual_approval=data.manual_approval,
        ask_user_only=data.ask_user_only,
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
    result = await svc.inject_session(session_id, user.id, prompt=data.prompt)
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
            gen = AgentService(session).stream_session_logs(session_id)
    if owned is None:
        raise DaemonSessionNotFound(
            f"AgentSession '{session_id}' not found.",
            details={"session_id": str(session_id)},
        )

    return StreamingResponse(
        gen,
        media_type="text/event-stream",
        headers=_SESSION_SSE_HEADERS,
    )


@router.get(
    "/sessions/{session_id}/logs",
    response_model=list,  # response items are AgentRunLogEntry
)
async def get_session_logs(
    session_id: uuid.UUID,
    session: SessionDep,
    user: TaskRunAgentUser,
) -> list[AgentRunLogEntry]:
    """Return all logs of a session, aggregated across AgentRuns (D-005@v1).

    Read-only. Ownership / existence follow the same resource-hiding 404 as
    the other session endpoints (no existence leak for missing / cross-user).
    Response items reuse the existing ``AgentRunLogEntry`` DTO; ``run_id`` is
    preserved so the frontend can delineate turn boundaries.
    """
    svc = DaemonService(session)
    logs = await svc.get_agent_session_logs(session_id, user.id)
    return [AgentRunLogEntry.model_validate(log) for log in logs]


# ── WebSocket endpoint ───────────────────────────────────────────────────────


@router.websocket("/ws")
async def daemon_websocket(
    websocket: WebSocket,
    runtime_id: str = Query(..., description="Daemon runtime UUID"),
) -> None:
    """WebSocket endpoint for daemon runtime real-time communication.

    The daemon connects with its ``runtime_id`` as a query parameter and
    listens for server-pushed messages (task_available, heartbeat_ack, etc.)
    while sending periodic heartbeat messages to keep the connection alive.

    Authentication is expected to be handled at the HTTP upgrade phase via
    the ``Authorization: Bearer <token>`` header or a ``token`` query param.
    """
    # Validate runtime_id format before accepting.
    try:
        rid = uuid.UUID(runtime_id)
    except (ValueError, AttributeError):
        log.warning("ws_invalid_runtime_id", runtime_id=runtime_id)
        await websocket.close(code=4001, reason="invalid runtime_id")
        return

    await websocket.accept()

    # Lazy import (matches placement.py / agent.service.py): the ws_hub
    # singleton accessor is patched per-test via ws_hub.get_daemon_ws_hub, and a
    # module-top `from ... import` would bind a stale/mock ref if this module
    # were first imported while such a patch was active.
    from app.modules.daemon.ws_hub import get_daemon_ws_hub

    hub = get_daemon_ws_hub()
    await hub.connect(rid, websocket)

    try:
        while True:
            try:
                data = await websocket.receive_json()
            except ValueError:
                log.warning(
                    "ws_invalid_json",
                    runtime_id=str(rid),
                )
                continue

            msg_type = data.get("type")

            if msg_type == DAEMON_MSG_HEARTBEAT:
                log.debug("ws_heartbeat_received", runtime_id=str(rid))
                await hub.send_heartbeat_ack(rid)
            elif msg_type == DAEMON_MSG_RPC_RESULT:
                # daemon → server RPC reply. Route to the pending future via the
                # hub correlation map; struct validation + error mapping lives in
                # the send_rpc call chain (list-dir endpoint), not here.
                payload = data.get("payload") or {}
                rpc_id = payload.get("rpc_id")
                if not rpc_id:
                    log.warning(
                        "ws_rpc_result_missing_id",
                        runtime_id=str(rid),
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
                        runtime_id=str(rid),
                        payload=raw_payload,
                    )
                    continue
                # Open a short-lived DB session for the request (WS loop has no
                # request-scoped dependency). Best-effort; failures only warn.
                try:
                    from app.core.db import get_session_factory

                    session_factory = get_session_factory()
                    async with session_factory() as ws_session:
                        svc = DaemonService(ws_session)
                        perm = DaemonPermissionService(svc, hub)
                        await perm.handle_permission_request(rid, payload)
                except Exception:
                    log.exception(
                        "ws_permission_request_handler_failed",
                        runtime_id=str(rid),
                        request_id=payload.request_id,
                    )
            else:
                log.warning(
                    "ws_unknown_message_type",
                    runtime_id=str(rid),
                    msg_type=msg_type,
                )
    except WebSocketDisconnect:
        log.info("ws_client_disconnected", runtime_id=str(rid))
    except Exception:
        log.exception("ws_unexpected_error", runtime_id=str(rid))
    finally:
        await hub.disconnect(rid)


@router.get(
    "/runtimes/{runtime_id}/pending-leases",
    response_model=list[dict],
)
async def get_pending_leases(
    runtime_id: uuid.UUID,
    session: SessionDep,
    user: Annotated[User, Depends(get_current_principal)],
) -> list[dict]:
    """Return all pending leases for a runtime (polled by daemon)."""
    from sqlalchemy import text as sa_text

    result = await session.execute(
        sa_text(
            """
            SELECT l.id, l.agent_run_id, l.metadata, r.provider, r.capabilities
            FROM daemon_task_leases l
            JOIN daemon_runtimes r ON l.runtime_id = r.id
            WHERE l.runtime_id = :rid AND l.status = 'pending'
            ORDER BY l.created_at
            """
        ),
        {"rid": runtime_id},
    )
    rows = result.mappings().all()
    out = []
    for row in rows:
        caps = row["capabilities"] or {}
        meta = row["metadata"] or {}
        out.append(
            {
                "lease_id": str(row["id"]),
                "agent_run_id": str(row["agent_run_id"]) if row["agent_run_id"] else None,
                "prompt": meta.get("prompt", ""),
                "provider": meta.get("provider") or row["provider"],
                "model": meta.get("model"),
                "cmd_path": caps.get("bin_path", ""),
                "protocol": caps.get("protocol", ""),
            }
        )
    return out
