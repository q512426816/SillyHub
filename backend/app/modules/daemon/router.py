"""HTTP routes for daemon runtime management and task lease lifecycle."""

from __future__ import annotations

import uuid
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query, WebSocket, WebSocketDisconnect, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_deps import get_current_principal, require_permission_any
from app.core.db import get_session
from app.core.logging import get_logger
from app.modules.agent.schema import AgentRunLogEntry
from app.modules.auth.model import User
from app.modules.auth.permissions import Permission
from app.modules.daemon.permission_service import (
    DaemonPermissionService,
    PermissionResponseRead,
)
from app.modules.daemon.protocol import (
    DAEMON_MSG_HEARTBEAT,
    DAEMON_MSG_PERMISSION_REQUEST,
    DAEMON_MSG_RPC_RESULT,
    PermissionRequestPayload,
)
from app.modules.daemon.schema import (
    AgentSessionListResponse,
    AgentSessionRead,
    DaemonHeartbeatRequest,
    DaemonHeartbeatResponse,
    DaemonRegisterRequest,
    DaemonRuntimeRead,
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
from app.modules.daemon.ws_hub import get_daemon_ws_hub

log = get_logger(__name__)


# SSE response headers shared with the run-scoped stream endpoint
# (app/modules/agent/router.py). Proxies/buffers must not hold SSE frames.
_SESSION_SSE_HEADERS = {
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
}

router = APIRouter(prefix="/daemon", tags=["daemon"])

SessionDep = Annotated[AsyncSession, Depends(get_session)]
# 管理 UI 端点用 runtime:admin；daemon 自身的注册/心跳/lease 生命周期仍走 get_current_principal
RuntimeAdminUser = Annotated[User, Depends(require_permission_any(Permission.RUNTIME_ADMIN))]


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
    runtime = await svc.get_runtime(runtime_id)
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
    runtime = await svc.disable_runtime(runtime_id, user.id)
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
    runtime = await svc.enable_runtime(runtime_id, user.id)
    return DaemonRuntimeRead.model_validate(runtime)


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
    count = await svc.submit_messages(
        lease_id,
        data.claim_token,
        data.agent_run_id,
        data.messages,
    )
    return LeaseMessagesResponse(accepted=True, count=count)


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
    hub = get_daemon_ws_hub()
    return DaemonPermissionService(svc, hub)


PermissionServiceDep = Annotated[DaemonPermissionService, Depends(get_permission_service)]


class SessionCreateRequest(BaseModel):
    provider: Literal["claude", "codex"]
    prompt: str = Field(min_length=1, max_length=8000)
    model: str | None = Field(default=None, max_length=128)
    manual_approval: bool = False


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


# ── Interactive session permission approval (task-08, FR-07 / D-007@v1) ──────
# DTOs inline (per task-08 allowed_paths: schema.py is the batch DTO home).
# The service is wired via get_permission_service so the request-scoped DB
# session and the process-wide ws_hub singleton are shared with the rest of
# the daemon module.


class PermissionResponseRequest(BaseModel):
    decision: Literal["allow", "deny"]
    message: str | None = Field(default=None, max_length=2000)


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

    Sends PERMISSION_RESPONSE downlink to the daemon, cancels the 5min timeout
    timer, and publishes permission_resolved SSE. 404 when the request has
    already timed out / never existed; 504 when the daemon runtime is offline;
    409 when manual_approval is disabled for the session.
    """
    return await service.respond_permission(
        user_id=user.id,
        session_id=session_id,
        request_id=request_id,
        decision=body.decision,
        message=body.message,
    )


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
    session: SessionDep,
    user: TaskRunAgentUser,
    reason: str = Query(default="manual"),
) -> SessionControlResponse:
    """End an interactive session: single reconciliation of session/lease/run (FR-05)."""
    svc = DaemonService(session)
    result = await svc.end_session(session_id, user.id, reason=reason)
    return SessionControlResponse(
        session_id=result.agent_session.id,
        status=result.agent_session.status or "ended",
        current_run_id=result.current_run_id,
    )


@router.get("/sessions/{session_id}/stream")
async def stream_session_logs(
    session_id: uuid.UUID,
    session: SessionDep,
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
    """
    # Local imports keep top-level load cost minimal and avoid an import cycle
    # (agent.service imports nothing from daemon, but be defensive).
    from app.modules.agent.model import AgentSession
    from app.modules.agent.service import AgentService

    owned = (
        await session.execute(
            select(AgentSession).where(
                AgentSession.id == session_id,
                AgentSession.user_id == user.id,
            )
        )
    ).scalar_one_or_none()
    if owned is None:
        raise DaemonSessionNotFound(
            f"AgentSession '{session_id}' not found.",
            details={"session_id": str(session_id)},
        )

    svc = AgentService(session)
    return StreamingResponse(
        svc.stream_session_logs(session_id, session=session),
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
