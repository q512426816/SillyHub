"""HTTP routes for daemon runtime management and task lease lifecycle."""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, WebSocket, WebSocketDisconnect, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_deps import get_current_principal
from app.core.db import get_session
from app.core.logging import get_logger
from app.modules.auth.model import User
from app.modules.daemon.protocol import DAEMON_MSG_HEARTBEAT
from app.modules.daemon.schema import (
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
)
from app.modules.daemon.service import (
    DaemonLeaseNotFound,
    DaemonRuntimeNotFound,
    DaemonService,
)
from app.modules.daemon.ws_hub import get_daemon_ws_hub

log = get_logger(__name__)

router = APIRouter(prefix="/daemon", tags=["daemon"])

SessionDep = Annotated[AsyncSession, Depends(get_session)]


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
    user: Annotated[User, Depends(get_current_principal)],
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
    user: Annotated[User, Depends(get_current_principal)],
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
    user: Annotated[User, Depends(get_current_principal)],
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
    user: Annotated[User, Depends(get_current_principal)],
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
    user: Annotated[User, Depends(get_current_principal)],
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
