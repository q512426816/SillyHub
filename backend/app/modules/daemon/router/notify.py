"""daemon 会话回调端点（task-07 拆分）：恢复/挂起 + notify_* + 权限/dialog。

daemon→platform 的 session 级上报面全部在此：daemon 重启恢复三端点 +
优雅停止挂起批（gap-8.1 / design §11 / A5）、ready / plan / bash / agent-task
六回调（task-06 / D-001@v1 等）、权限审批/上行与 dialog 恢复四端点
（task-08 / FR-07）。

patch 兼容（D-007，patch 目标在包 ``__init__`` 命名空间，本模块经 ``_router``
延迟解析）：``get_session_readiness``（notify_session_ready 唤醒点）/
``upsert_agent_task``（agent-task-status 落库旁路）/ ``DaemonPermissionService``
（get_permission_service 构造点，test_ws_hub_permission patch）。
``PermissionServiceDep`` 经包 ``__init__`` 重导出（agent/router.py 消费面零改动）。
"""

from __future__ import annotations

import uuid
from typing import Annotated, Literal

from fastapi import Depends, Header, HTTPException, status
from pydantic import BaseModel, Field

import app.modules.daemon.router as _router
from app.core.auth_deps import get_current_principal
from app.core.logging import get_logger
from app.modules.auth.model import User
from app.modules.daemon.model import DaemonInstance
from app.modules.daemon.permission_service import (
    DaemonPermissionService,
    PermissionResponseRead,
    SessionDialogRead,
)
from app.modules.daemon.protocol import PermissionRequestPayload
from app.modules.daemon.router import SessionDep, TaskRunAgentUser, router
from app.modules.daemon.run_sync.service import (
    publish_bash_chunk_event,
    publish_session_event,
)
from app.modules.daemon.schema import (
    AgentTaskStatusEvent,
    BashChunkEvent,
    BashStatusEvent,
    PlanModeEnteredEvent,
    PlanResponseRequest,
)
from app.modules.daemon.service import DaemonRuntimeNotFound, DaemonService
from app.modules.daemon.session.service import SessionService

log = get_logger("app.modules.daemon.router")

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


# ── daemon 优雅停止批量挂起（2026-08-29-daemon-platform-resilience task-05 /
#    design A5 / FR-04）───────────────────────────────────────────────────────
# 固定路径声明在动态三段式 ``/sessions/{session_id}/...`` 之前（对齐
# /runtimes/page 先例）：本文件无二段式 POST /sessions/{id} 路由，当前无遮蔽，
# 前置声明防后续新增时 ``suspend-batch`` 被当 UUID 解析 422。


class SessionSuspendBatchRequest(BaseModel):
    """Body for POST /sessions/suspend-batch（task-05）.

    daemon ``stop()`` 在 markOffline 前上报自身标识；backend 按
    ``daemon_local_id``（= ``daemon_instances.id``）定位该 daemon 全部 runtime
    名下的 active 会话做三步挂起收敛（daemon 侧调用方属 task-08）。
    """

    daemon_local_id: uuid.UUID = Field(description="daemon 本地 uuid（daemon_instances.id）")


class SuspendBatchResponse(BaseModel):
    """POST /sessions/suspend-batch 响应（task-05 provides 契约）.

    ``suspended`` = 实际翻挂起的会话数；``runs_failed`` = 同批收敛 failed 的
    活跃轮 run 数（error_code=daemon_stopped）。重复调用幂等——已挂起会话
    no-op 计 0。
    """

    suspended: int
    runs_failed: int


@router.post(
    "/sessions/suspend-batch",
    response_model=SuspendBatchResponse,
)
async def suspend_sessions_batch(
    data: SessionSuspendBatchRequest,
    session: SessionDep,
    user: Annotated[User, Depends(get_current_principal)],
) -> SuspendBatchResponse:
    """daemon 优雅停止：该 daemon 全部 active 会话批量挂起（task-05 / design A5）.

    daemon ``stop()`` 在 markOffline 前调用。单事务三步收敛（中断 run →
    failed（error_code=daemon_stopped）、会话 → suspended、挂起 lease →
    cancelled），条件 UPDATE 幂等可重入；调用失败（网络已断）与强杀等价，
    由 600s offline sweep 兜底收敛 suspended（design A5 已声明的 fallback）。
    归属校验对齐 heartbeat（actor_user_id）：instance 必须属于当前认证主体
    （api-key owner），不存在/越权同语义 404。
    """
    instance = await session.get(DaemonInstance, data.daemon_local_id)
    if instance is None or instance.user_id != user.id:
        raise DaemonRuntimeNotFound(
            "守护进程不存在或不属于当前用户。",
            details={"daemon_local_id": str(data.daemon_local_id)},
        )
    result = await SessionService(session).suspend_sessions_for_daemon(data.daemon_local_id)
    return SuspendBatchResponse(suspended=result.suspended, runs_failed=result.runs_failed)


@router.post("/sessions/{session_id}/ready")
async def notify_session_ready(
    session_id: uuid.UUID,
    session: SessionDep,
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

    越权防护（2026-08-25 P1）：mark_ready 前校验会话绑定的 runtime 归属当前
    主体（api-key owner = runtime owner），否则任意已认证主体可向他人会话
    伪造 ready 信号；不匹配 / 不存在一律 404，不泄露存在性。
    """
    await SessionService(session).get_session_for_runtime_owner(session_id, user.id)
    _router.get_session_readiness().mark_ready(session_id)
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
            detail="路径 session_id 与请求体 session_id 不一致",
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
    session: SessionDep,
    user: Annotated[User, Depends(get_current_principal)],
) -> dict[str, bool]:
    """Receive daemon plan-mode-entered report and forward to frontend SSE (task-02).

    越权防护（2026-08-25 P1）：发布前校验会话绑定的 runtime 归属当前主体，
    否则任意已认证主体可向 ``agent_session:{id}`` 频道发布伪造事件；不匹配 /
    不存在一律 404，不泄露存在性。
    """
    if data.session_id != session_id:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="路径 session_id 与请求体 session_id 不一致",
        )
    await SessionService(session).get_session_for_runtime_owner(session_id, user.id)
    await publish_session_event(session_id, data)
    return {"ok": True}


@router.post(
    "/sessions/{session_id}/bash-status",
    response_model=dict[str, bool],
)
async def notify_bash_status(
    session_id: uuid.UUID,
    data: BashStatusEvent,
    session: SessionDep,
    user: Annotated[User, Depends(get_current_principal)],
) -> dict[str, bool]:
    """Receive daemon bash-status report and forward to frontend SSE (task-02).

    越权防护（2026-08-25 P1）：同 notify_plan_mode_entered，发布前做 runtime
    归属校验（404 不泄露存在性）。
    """
    if data.session_id != session_id:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="路径 session_id 与请求体 session_id 不一致",
        )
    await SessionService(session).get_session_for_runtime_owner(session_id, user.id)
    await publish_session_event(session_id, data)
    return {"ok": True}


@router.post(
    "/sessions/{session_id}/bash-chunk",
    response_model=dict[str, bool],
)
async def notify_bash_chunk(
    session_id: uuid.UUID,
    data: BashChunkEvent,
    session: SessionDep,
    user: Annotated[User, Depends(get_current_principal)],
) -> dict[str, bool]:
    """Receive daemon bash-chunk report and forward to frontend SSE (task-02).

    经 ``publish_bash_chunk_event`` 发布，内含 100ms 节流与 8KB 单条截断。

    越权防护（2026-08-25 P1）：同 notify_plan_mode_entered，发布前做 runtime
    归属校验（404 不泄露存在性）。
    """
    if data.session_id != session_id:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="路径 session_id 与请求体 session_id 不一致",
        )
    await SessionService(session).get_session_for_runtime_owner(session_id, user.id)
    published = await publish_bash_chunk_event(data)
    return {"ok": True, "throttled": not published}


@router.post(
    "/sessions/{session_id}/agent-task-status",
    response_model=dict[str, bool],
)
async def notify_agent_task_status(
    session_id: uuid.UUID,
    data: AgentTaskStatusEvent,
    session: SessionDep,
    user: Annotated[User, Depends(get_current_principal)],
) -> dict[str, bool]:
    """Receive daemon agent-task-status report and forward to frontend SSE (task-02).

    2026-08-27-background-subagent-progress task-05（FR-04）：请求模型即
    AgentTaskStatusEvent（schema.py），生命周期扩展字段（tool_use_id/summary/
    last_tool_name/elapsed_ms/total_tokens/tool_uses/async）经模型校验后随
    ``publish_session_event`` 整包转发（by_alias 发布），端点不逐字段挑选。

    2026-09-04-session-task-execution-panel task-03（FR-05）：转发之外把事件
    交给 ``upsert_agent_task``（agent_task_store.py）落库 ``agent_session_task``
    ——持久化旁路，失败只记日志，不影响 SSE 转发与 200 返回。

    越权防护（2026-08-25 P1）：同 notify_plan_mode_entered，发布前做 runtime
    归属校验（404 不泄露存在性）。
    """
    if data.session_id != session_id:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="路径 session_id 与请求体 session_id 不一致",
        )
    await SessionService(session).get_session_for_runtime_owner(session_id, user.id)
    await publish_session_event(session_id, data)
    # task-03 持久化旁路（design §兼容策略「可回退」）：SSE 主链路优先，转发与
    # 落库不做强事务绑定——upsert 抛异常只记日志 + 回滚复位请求 session，本端点
    # 照常返回 200（落库失败零影响，快照缺口由后续事件自愈）。
    try:
        await _router.upsert_agent_task(session, data)
    except Exception:
        await session.rollback()
        log.exception(
            "agent_task_status_persist_failed",
            session_id=str(session_id),
            task_id=data.task_id,
        )
    return {"ok": True}


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
    return _router.DaemonPermissionService(svc, hub)


PermissionServiceDep = Annotated[DaemonPermissionService, Depends(get_permission_service)]


# ── Interactive session permission approval (task-08, FR-07 / D-007@v1) ──────
# DTOs inline (per task-08 allowed_paths: schema.py is the batch DTO home).
# The service is wired via get_permission_service so the request-scoped DB
# session and the process-wide ws_hub singleton are shared with the rest of the
# daemon module.


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


# ── Daemon HTTP permission uplink (task-07 / design A3) ─────────────────────
# daemon PERMISSION_REQUEST 的 WS 不通兜底通道。与 WS 上行同源汇聚：service 侧
# handle_permission_request_http 复用 handle_permission_request 的全部校验 /
# SSE 广播 / dialog 持久化 / plain 5min timer 语义；ql-20260829-004 起 service
# 侧先做 runtime 归属校验（principal 必须 own 会话所挂 runtime，不符 404
# resource-hiding，对齐 pending-controls owner-only 惯例）。等待人审不设时限——backend
# 5min 超时 + daemon fallback timer 双兜底（断线期间挂起等待而非 fail-closed deny）。


class DaemonPermissionUplinkRequest(BaseModel):
    """Body for POST /sessions/{id}/permission-requests（task-07 / design A3）.

    字段与 protocol.PermissionRequestPayload 对齐（session_id 在 path，不重复）；
    由路由层组装成完整 payload 委托 permission service。
    """

    run_id: uuid.UUID
    # daemon 生成的 wire request_id（PERMISSION_RESPONSE 原样回填关联）。
    request_id: str = Field(min_length=1, max_length=128)
    tool_name: str = Field(min_length=1, max_length=128)
    # 工具调用参数 JSON，原样转发（前端审批卡渲染用）。
    input: dict
    tool_use_id: str | None = Field(default=None, max_length=256)
    # AskUserQuestion dialog 扩展：set → 持久化 dialog 行且不挂 5min timer。
    dialog_kind: str | None = Field(default=None, max_length=64)
    dialog_payload: dict | None = None


class DaemonPermissionUplinkResponse(BaseModel):
    session_id: uuid.UUID
    request_id: str
    # True=已受理（SSE 已广播，dialog 落行 / plain 挂 timer）；False=校验不过
    # 被丢弃（daemon 侧记 warn，等待交由超时兜底）。
    accepted: bool


@router.post(
    "/sessions/{session_id}/permission-requests",
    response_model=DaemonPermissionUplinkResponse,
)
async def submit_session_permission_request(
    session_id: uuid.UUID,
    body: DaemonPermissionUplinkRequest,
    session: SessionDep,
    user: Annotated[User, Depends(get_current_principal)],
    service: PermissionServiceDep,
    # 对齐 runs/result 端点惯例（X-Claim-Token lease 级凭证）；该会话有 claim
    # 语义时 service 侧强制匹配（403），否则跳过（条件校验见 service 注释）。
    # 带默认值参数置于无默认值参数之后（Python 语法约束）。
    x_claim_token: Annotated[str | None, Header(alias="X-Claim-Token")] = None,
) -> DaemonPermissionUplinkResponse:
    """Daemon HTTP uplink for a canUseTool / dialog permission request (task-07).

    daemon ``sendToHub`` 遇 WS 不通时经 ``hubClient.submitPermissionRequest``
    改走本端点创建待审记录——人审挂起等待而非直接 deny。Auth:
    ``get_current_principal`` 接受 daemon ``X-API-Key``（长期凭证），service
    侧先校验 principal own 会话所挂 runtime（不符/不存在同语义 404，
    ql-20260829-004）；``X-Claim-Token`` 由 service 按会话 lease 的 claim
    语义条件校验。

    幂等性（dialog）：request_id 唯一约束 upsert，daemon 重放不 fork 第二张
    pending 卡（与 WS 上行同一持久化路径）；plain approval 的重复 request_id
    替换既有 timer。
    """
    payload = PermissionRequestPayload(
        session_id=session_id,
        run_id=body.run_id,
        request_id=body.request_id,
        tool_name=body.tool_name,
        input=body.input,
        tool_use_id=body.tool_use_id,
        dialog_kind=body.dialog_kind,
        dialog_payload=body.dialog_payload,
    )
    accepted = await service.handle_permission_request_http(
        session_id, x_claim_token, payload, principal_user_id=user.id
    )
    return DaemonPermissionUplinkResponse(
        session_id=session_id,
        request_id=body.request_id,
        accepted=accepted,
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
