"""task lease 生命周期端点（task-07 拆分）。

claim/start/heartbeat/messages/complete/sync 六步 + interactive run 关单
（X-Claim-Token header 凭证）+ lease 查询（GET /leases/{id}、runtime 名下列表）。
``InteractiveRunResultRequest`` 经包 ``__init__`` 重导出（测试直接 import 消费）。
"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import Depends, Header
from pydantic import BaseModel, Field

from app.core.auth_deps import get_current_principal
from app.modules.auth.model import User
from app.modules.daemon.model_error import ModelErrorDTO
from app.modules.daemon.router import RuntimeAdminUser, SessionDep, router
from app.modules.daemon.run_sync.service import publish_submitted_messages
from app.modules.daemon.schema import (
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
    ModelUsageItemRead,
)
from app.modules.daemon.service import (
    DaemonLeaseNotFound,
    DaemonRuntimeNotFound,
    DaemonService,
)

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
    # ── cache 两维（2026-08-29-usage-by-provider-model task-02 补漏）：daemon
    # task-16 起就在 payload 里发送 cache_*_tokens，但本 DTO 一直缺这两个字段
    # 被 pydantic 静默丢弃——DB 里的 interactive cache 值实为实时上报的快照 max，
    # 终态覆盖从未生效。现补齐对齐 batch 路径。
    cache_read_tokens: int | None = None
    cache_creation_tokens: int | None = None
    # ── 模型明细与调用次数（FR-01-3/FR-02-1，2026-08-29-usage-by-provider-model）：
    # modelUsage 逐模型拆行（含子代理）；api_requests 为 run 级精确计数（assistant
    # 消息数含子代理）。旧 daemon 不传 → None → 明细无行（N-01 兼容）。
    model_usage: list[ModelUsageItemRead] | None = None
    api_requests: int | None = None
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
        cache_read_tokens=data.cache_read_tokens,
        cache_creation_tokens=data.cache_creation_tokens,
        model_usage=data.model_usage,
        api_requests=data.api_requests,
        error=data.error,
    )
    return InteractiveRunResultResponse(
        agent_run_id=agent_run.id,
        status=agent_run.status or "failed",
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
