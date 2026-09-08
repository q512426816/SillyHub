"""中断 / 结束 / plan 响应 / 控制指令下发簇（task-08 拆分）。

- _cancel_pending_control_command / _send_interrupt_control / interrupt_
  session / end_session / handle_plan_response（原 :4293-4580 + :4582-4747 +
  :5231-5334）；
- _inject_mid_turn_into_run（原 :4326-4477，忙轮 steering 直注入——控制指令
  下发同簇）；
- _dispatch_inject_turn（自 _inject_into_session commit 后派发段 :4133-4291
  拆出：ready 等待 + SESSION_SWITCH_CONFIG / SESSION_INJECT 下发 + 失败
  收敛，零改写）。

D-007：log / get_session_readiness / DAEMON_MSG_SESSION_SWITCH_CONFIG /
publish_sessions_changed 调用点经 ``_svc.`` 延迟解析。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.orm.attributes import flag_modified

import app.modules.daemon.session.service as _svc
from app.core.errors import AppError
from app.modules.agent.model import AgentRun, AgentRunLog, AgentSession
from app.modules.daemon.control_commands import (
    INJECT_SEND_FAILED_ERROR_CODE,
    KIND_SESSION_INJECT,
    KIND_SESSION_INTERRUPT,
    ControlCommandService,
)
from app.modules.daemon.model import DaemonControlCommand, DaemonTaskLease
from app.modules.daemon.protocol import DAEMON_MSG_PLAN_RESPONSE
from app.modules.daemon.runtime.service import DaemonRuntimeOffline
from app.modules.daemon.schema import PageContextCreateBlock, PlanResponseDecision

from .errors import (
    DaemonSessionConfigInvalid,
    DaemonSessionInvariantViolation,
    DaemonSessionNoCurrentRun,
    DaemonSessionNotActive,
    DaemonSessionNotFound,
)
from .helpers import (
    _resolve_daemon_id_for_runtime,
    _send_session_end_best_effort,
    _strip_team_command_prefix,
)
from .results import SessionControlResult, SessionDispatchResult


async def _cancel_pending_control_command(
    svc,
    command_id: uuid.UUID,
    *,
    run_id: uuid.UUID | None = None,
) -> None:
    """派发失败收链：取消 pending 控制指令（ql-20260903-016，best-effort）。

    inject / interrupt 推送失败且调用方已决定本轮失败（run 收敛 failed /
    504「未能发送」）时，enqueue_and_push 落库的 pending 行若保留，daemon
    在 TTL 内重连补拉会照常执行——界面报错后消息「复活」；用户按提示重发
    则同一条消息执行两遍（interrupt payload 不带 run_id，迟到补拉打断的
    还是该会话「当前正在跑的」那一轮，会误伤新一轮）。取消失败仅记日志，
    不打断既有 504 收敛语义。
    """
    try:
        cancelled = await ControlCommandService(svc._session).cancel_pending(command_id)
        if not cancelled:
            # 竞态：daemon 恰在此窗口重连并已补拉（pending→delivered）。
            _svc.log.info(
                "control_command_cancel_race_not_pending",
                command_id=str(command_id),
                run_id=str(run_id) if run_id else None,
            )
    except Exception:
        await svc._session.rollback()
        _svc.log.warning(
            "control_command_cancel_failed",
            command_id=str(command_id),
            run_id=str(run_id) if run_id else None,
            exc_info=True,
        )


async def _inject_mid_turn_into_run(
    svc,
    session: AgentSession,
    *,
    current_run: AgentRun,
    prompt: str,
    attachment_ids: list[uuid.UUID] | None = None,
    attachment_owner_user_id: uuid.UUID | None = None,
    turn_metadata: dict | None = None,
) -> SessionDispatchResult:
    """忙轮中途注入（quick 2026-09-02 群聊 @ 忙轮成员 steering 语义）。

    与 :meth:`_inject_into_session` 普通注入段的关键差异（调用方已持会话
    行锁、status/lease/归档守卫已过，``current_run`` 为锁内查得的唯一
    活跃 run）：

    1. **不建新 run**——SESSION_INJECT payload 的 run_id 沿用活跃 run
       （daemon 侧 inject() 无条件 push inputQueue + currentRunId 切换，
       同 id 重写为幂等；单会话单活跃 run 不变式保持）；
    2. 本轮 user_input 留痕日志挂**同一活跃 run**（现状每轮注入都落一行
       user_input，沿用；turn_metadata 照传——群链路互@检测按最新一条
       user_input metadata 读链上下文）；
    3. 不触碰会话配置三列 / lease metadata / turn_count（配置切换是轮
       边界语义，调用方走原排队分支，本方法不接切换维度）；
    4. 推送失败不收敛活跃 run（它仍属当前正在执行的轮）——控制指令已
       落库 pending 待 daemon 重连补拉（三段式），记日志即可。

    派发不可达（runtime 解析失败）抛 DaemonRuntimeOffline（与普通轮同
    口径，此时轮在跑而解析失败属契约异常）。不做 readiness 等待——活跃
    run 在跑即证明 daemon 已建会话（create→inject 首轮竞态不存在）。
    """
    session_id = session.id
    now = datetime.now(UTC)
    # 派发路由先行解析（只读）——失败时零写入直接抛，不留半态。
    runtime_id = session.runtime_id
    daemon_id = (
        await _resolve_daemon_id_for_runtime(svc._session, runtime_id)
        if runtime_id is not None
        else None
    )
    if daemon_id is None or runtime_id is None:
        raise DaemonRuntimeOffline(
            "执行代理当前不在线，本轮消息未能发送。请确认 daemon 已运行后重试。",
            details={
                "runtime_id": str(runtime_id),
                "session_id": str(session_id),
                "run_id": str(current_run.id),
            },
        )
    try:
        # 附件校验与组装与普通轮同管线（归属基准覆盖同传；校验失败整体
        # 回滚零残留）。
        validated_attachments: list = []
        if attachment_ids:
            validated_attachments = await svc._validate_inject_attachment_rows(
                session_id=session_id,
                session_user_id=(
                    attachment_owner_user_id
                    if attachment_owner_user_id is not None
                    else session.user_id
                ),
                session_provider=session.provider or "",
                attachment_ids=attachment_ids,
            )
        inject_attachments: list[dict] = []
        if validated_attachments:
            # draft→bound 回填（同事务前进迁移，与普通轮一致）。
            for att_row in validated_attachments:
                if att_row.session_id is None:
                    att_row.session_id = session.id
                    svc._session.add(att_row)
            supports = await svc._resolve_inject_gate(
                user_id=session.user_id,
                gate_provider_id_basis=session.llm_provider_id,
                agent_kind=session.provider or "",
            )
            inject_attachments = await svc._assemble_inject_attachment_payload(
                validated_attachments, supports_multimodal=supports
            )

        # 本轮 user_input 留痕：挂活跃 run（附件标记行口径与普通轮一致）。
        user_input_content = prompt
        if validated_attachments:
            from app.modules.session_attachment.service import (
                attachment_marker_line,
            )

            marker_lines = "\n".join(attachment_marker_line(r) for r in validated_attachments)
            user_input_content = f"{marker_lines}\n{prompt}" if prompt else marker_lines
        svc._session.add(
            AgentRunLog(
                run_id=current_run.id,
                channel="user_input",
                content_redacted=user_input_content[:5000],
                timestamp=now,
                metadata_=dict(turn_metadata) if turn_metadata is not None else None,
            )
        )
        session.last_active_at = now
        svc._session.add(session)
        await svc._session.commit()
        await svc._session.refresh(session)
    except AppError:
        await svc._session.rollback()
        raise
    except Exception:
        await svc._session.rollback()
        raise

    # SESSION_INJECT 三段式下发（claim_token 跨 turn 复用，与普通轮同源）。
    lease_row = await svc._session.get(DaemonTaskLease, session.lease_id)
    lease_meta = dict((lease_row.metadata_ if lease_row else None) or {})
    inject_claim_token = lease_meta.get("claim_token", "")
    inject_payload = {
        "session_id": str(session.id),
        "lease_id": str(session.lease_id),
        "run_id": str(current_run.id),
        "prompt": _strip_team_command_prefix(prompt),
        "claim_token": inject_claim_token,
        "runtime_id": str(runtime_id),  # design §5.3 provider discriminator
    }
    if inject_attachments:
        inject_payload["attachments"] = inject_attachments
    _row, control_ok = await ControlCommandService(svc._session).enqueue_and_push(
        daemon_id=daemon_id,
        runtime_id=runtime_id,
        kind=KIND_SESSION_INJECT,
        payload=inject_payload,
    )
    if not control_ok:
        # 活跃 run 不收敛（区别于普通轮的 failed+504）：指令已落库 pending
        # 待补拉，轮仍在跑；最坏补拉到达时轮已终态 → daemon 按会话态处理。
        _svc.log.info(
            "session_midturn_inject_pending_pull",
            session_id=str(session_id),
            run_id=str(current_run.id),
        )
    await svc._publish_session_event(
        session.id,
        {
            "event": "turn_injected",
            "session_id": str(session.id),
            "run_id": str(current_run.id),
        },
    )
    return SessionDispatchResult(
        agent_session=session,
        agent_run=current_run,
        lease_id=session.lease_id,
        queued=False,
        mid_turn=True,
    )


async def _send_interrupt_control(
    svc,
    session: AgentSession,
    run_id: uuid.UUID | None = None,
) -> None:
    """resolve runtime → daemon 并下发 SESSION_INTERRUPT 控制指令（三段式）。

    2026-08-31-session-queue-ux task-04（design §4 Phase1.4 / D-007）：从
    interrupt_session 原样抽出「runtime 解析 + ControlCommandService
    .enqueue_and_push(KIND_SESSION_INTERRUPT)」段，供 interrupt 端点与
    dispatch-now 忙时打断共用（纯重构，签名/行为零变化；daemon 零改动）。
    控制指令三段式：WS 推送失败仅落库 pending 待 daemon 补拉，不算异常；
    仅 daemon 完全不可达（``control_ok=False`` / runtime 解析失败）抛
    DaemonRuntimeOffline 由调用方决定语义。
    """
    # task-06: resolve provider runtime_id → daemon_instance_id (WS route key).
    runtime_id = session.runtime_id
    daemon_id = (
        await _resolve_daemon_id_for_runtime(svc._session, runtime_id)
        if runtime_id is not None
        else None
    )
    if daemon_id is None or runtime_id is None:
        raise DaemonRuntimeOffline(
            "执行代理当前不在线，无法打断本轮。请稍后重试或等待本轮结束。",
            details={
                "session_id": str(session.id),
                "runtime_id": str(runtime_id) if runtime_id else None,
            },
        )
    # task-04（design A2）：SESSION_INTERRUPT 走控制指令三段式——推送失败
    # 落库 pending 待补拉；504 语义保持（下方 not control_ok 分支）。
    _row, control_ok = await ControlCommandService(svc._session).enqueue_and_push(
        daemon_id=daemon_id,
        runtime_id=runtime_id,
        kind=KIND_SESSION_INTERRUPT,
        payload={
            "session_id": str(session.id),
            "lease_id": str(session.lease_id),
            "runtime_id": str(runtime_id),  # design §5.3 provider discriminator
        },
    )
    if not control_ok:
        # ql-20260903-016：打断报 504「没停成」后不能留 pending——迟到补拉
        # 打断的是该会话当前正在跑的那一轮（payload 无 run_id），用户报错
        # 后新发的消息会被误伤。
        await svc._cancel_pending_control_command(_row.id, run_id=run_id)
        raise DaemonRuntimeOffline(
            "执行代理当前不在线，无法打断本轮。请稍后重试或等待本轮结束。",
            details={
                "runtime_id": str(session.runtime_id),
                "session_id": str(session.id),
                "run_id": str(run_id) if run_id else None,
            },
        )


async def interrupt_session(
    svc,
    session_id: uuid.UUID,
    user_id: uuid.UUID,
) -> SessionControlResult:
    """Send a turn-level interrupt for the current run (FR-04).

    Locks + validates the session, finds the unique currentRun, sends
    SESSION_INTERRUPT. Does NOT touch session/lease terminal state and does
    NOT pre-empt the run status — daemon result drives AgentRun=failed
    (design §7.6 step 3). No currentRun → DaemonSessionNoCurrentRun.
    """
    try:
        session = await svc._get_owned_session_for_update(session_id, user_id)
        # ql-20260829-011：归档区存量会话只读——interrupt 同口径 409。
        await svc._ensure_session_workspace_writable(session)
        if session.status != "active":
            raise DaemonSessionNotActive(
                f"AgentSession '{session_id}' is not active (status={session.status}).",
                details={"session_id": str(session_id), "status": session.status},
            )
        if session.lease_id is None or session.runtime_id is None:
            raise DaemonSessionInvariantViolation(
                f"Active session '{session_id}' has no lease/runtime binding.",
                details={"session_id": str(session_id)},
            )
        run = await svc._get_current_run(session.id)
        await svc._session.commit()
    except AppError:
        await svc._session.rollback()
        raise
    except Exception:
        await svc._session.rollback()
        raise

    if run is None:
        raise DaemonSessionNoCurrentRun(
            f"Session '{session_id}' has no active run to interrupt.",
            details={"session_id": str(session_id)},
        )

    # 2026-08-31-session-queue-ux task-04：发送段抽 _send_interrupt_control
    # 共用（dispatch-now 忙时打断同链路），行为零变化。
    await svc._send_interrupt_control(session, run_id=run.id)

    return SessionControlResult(agent_session=session, current_run_id=run.id)


async def end_session(
    svc,
    session_id: uuid.UUID,
    user_id: uuid.UUID,
    *,
    reason: str = "manual",
    actor_runtime_owner_id: uuid.UUID | None = None,
) -> SessionControlResult:
    """Single reconciliation of session/lease/currentRun (FR-05 / §8.5).

    Locks the session, validates the bound interactive lease, then in ONE
    transaction (still holding the row lock) marks currentRun killed,
    session ended, lease completed and commits; AFTER the commit a
    best-effort SESSION_END is sent to the daemon（P1 修复 2026-08-25：
    对齐 interrupt_session 的「先 commit 释放行锁、再发 WS」模式，daemon
    半死时 send_session_control 最长挂 10s，不再拖住会话行锁）. Idempotent on
    already-terminal sessions (ended / failed). WS failure is a warning
    only — the local reconciliation still succeeds so a daemon offline
    never strands an active session.

    gap-4 修复（ql-20260623-004）：两种调用方共由此端点，按 ``actor`` 区分
    session 定位方式——
      * 前端（Bearer JWT，``actor_runtime_owner_id is None``）：保持
        :meth:`_get_owned_session_for_update` 的 ``AgentSession.user_id``
        校验；
      * daemon（X-API-Key，router 传入 ``actor_runtime_owner_id``）：api-key
        owner 是 runtime owner，不等于 session 创建者，改走
        :meth:`_get_session_by_runtime_owner_for_update` 按 runtime 归属校验，
        否则 admin 共享 runtime 场景（creator≠owner）必 404。
    其余收口逻辑（lease 校验 / run killed / lease completed / SSE）两种身份
    完全一致。
    """
    try:
        if actor_runtime_owner_id is not None:
            session = await svc._get_session_by_runtime_owner_for_update(
                session_id, actor_runtime_owner_id
            )
        else:
            session = await svc._get_owned_session_for_update(session_id, user_id)

        # Idempotent: already terminal (ended/failed) → no-op return. failed
        # 也是终态——不得被 end 翻成 ended（终态覆写，2026-08-25 会话审查 P2）。
        if session.status in ("ended", "failed"):
            await svc._session.commit()
            # task-09 / FR-04：ended 终态清理 ready 状态（防前次未清残留，
            # clear 幂等多次调不报错），best-effort 不阻塞结束流程。
            try:
                _svc.get_session_readiness().clear(session_id)
            except Exception:
                _svc.log.warning(
                    "session_ready_clear_failed",
                    session_id=str(session_id),
                )
            return SessionControlResult(agent_session=session, current_run_id=None)

        if session.lease_id is None:
            raise DaemonSessionInvariantViolation(
                f"Session '{session_id}' has no bound lease.",
                details={"session_id": str(session_id)},
            )

        lease = await svc._session.get(DaemonTaskLease, session.lease_id)
        if lease is None or lease.kind != "interactive" or lease.id != session.lease_id:
            raise DaemonSessionInvariantViolation(
                f"Session '{session_id}' lease binding is invalid "
                f"(missing/non-interactive/mismatched).",
                details={
                    "session_id": str(session_id),
                    "lease_id": str(session.lease_id),
                    "lease_kind": lease.kind if lease else None,
                },
            )

        run = await svc._get_current_run(session.id)
    except AppError:
        await svc._session.rollback()
        raise
    except Exception:
        await svc._session.rollback()
        raise

    # Single-transaction local reconciliation (§8.5 收口)。P1 修复
    # （2026-08-25 会话审查）：本地收口在持有 AgentSession FOR UPDATE 行锁的
    # 事务内完成并 commit，SESSION_END WS 发送移到 commit 之后 best-effort
    # （对齐 interrupt_session :2233 的「先 commit 释放行锁、再发 WS」模式）——
    # ws_hub.send_session_control 最长挂 _SEND_TIMEOUT=10s，锁内等待会让 daemon
    # 半死时同会话的全部操作阻塞在行锁上。
    now = datetime.now(UTC)
    try:
        if run is not None and run.status not in _svc.TERMINAL_TURN_STATUSES:
            run.status = "killed"
            run.finished_at = now
            run.exit_code = -1
            svc._session.add(run)

        # 终态守卫（P2）：幂等早退已拦 ended/failed，此处必为活跃态；显式再
        # 守卫一次防御状态机扩展，failed 等终态不被 end 翻成 ended。
        if session.status not in ("ended", "failed"):
            session.status = "ended"
            session.ended_at = now
        session.last_active_at = now
        svc._session.add(session)

        # P2：lease 仅在非终态时收口 completed——已 cancelled（cancel_lease 抢先
        # 收口）的 lease 不被改写；terminating_at 的清空同样只在收口分支内。
        if lease.status not in ("completed", "cancelled", "expired"):
            lease.status = "completed"
            lease.updated_at = now
            # task-11 / FR-04 / D-007：daemon 回传 session_end（interactive ACK，
            # POST /sessions/{id}/end = notifySessionEnd 收敛点）→ 清 terminating_at。
            # cancel_lease 写 terminating_at 标记"等 daemon 回传"，本处即回传收敛点，
            # 清空让 sweeper（lease_service.alert_stuck_terminating_leases）不再误告警。
            # 幂等 None-set；仍在同一 try 单事务收口块内（commit 在下文）。
            lease.terminating_at = None
        svc._session.add(lease)

        # ql-20260825-011：会话结束 → 未派发的排队消息一律转 failed（随本事务
        # commit），队列表不再有永远 pending 的死条目。
        await svc._fail_pending_queued_messages(session.id, "会话已结束，排队消息未发送。")

        await svc._session.commit()
        await svc._session.refresh(session)

        # task-09 / FR-04：ended 终态清理 ready 状态（commit 后事务外，
        # best-effort；内层 try 隔离 clear 异常，不影响外层 commit 错误
        # raise 分支），避免残留 event 让后续 inject 误判已结束 session 为 ready。
        try:
            _svc.get_session_readiness().clear(session_id)
        except Exception:
            _svc.log.warning(
                "session_ready_clear_failed",
                session_id=str(session_id),
            )
    except Exception:
        await svc._session.rollback()
        raise

    # Best-effort SESSION_END（commit 之后）：kill currentRun + 清 daemon 侧
    # SessionStore。helper 内部吞掉一切异常（runtime/lease 缺失、daemon 离线、
    # WS 超时），仅记 warning——本地收口已 commit，daemon 离线不阻断结束语义
    # （与原锁内发送的 try 语义一致，只是不再占用会话行锁等待）。
    await _send_session_end_best_effort(
        svc._session,
        session_id=session.id,
        lease_id=session.lease_id,
        runtime_id=session.runtime_id,
        reason=reason,
    )

    # task-02：status→ended 已随上方 commit 落库，发布列表变更信号（user_id
    # 取会话属主——daemon 身份收口时刷新的仍是属主的列表视图）。
    await _svc.publish_sessions_changed("status_changed", session.id, session.user_id)

    await svc._publish_session_event(
        session.id,
        {
            "event": "session_ended",
            "session_id": str(session.id),
            "reason": reason,
            "current_run_id": str(run.id) if run else None,
        },
    )
    return SessionControlResult(
        agent_session=session,
        current_run_id=run.id if run else None,
    )


async def handle_plan_response(
    svc,
    session_id: uuid.UUID,
    run_id: uuid.UUID,
    decision: PlanResponseDecision,
    feedback: str | None,
    user_id: uuid.UUID,
) -> dict[str, bool]:
    """Handle user's response to a plan-mode confirmation request (task-02 / FR-02).

    Validates that the session is owned by ``user_id`` and that ``run_id`` is a
    turn bound to this session, persists the decision in ``session.config`` (no
    new tables per design §数据模型), then best-effort pushes a
    ``daemon:plan_response`` control message to the owning daemon so the Agent
    can continue / revise / cancel.

    Returns ``{"ok": True, "delivered": <ws-delivered>}``. Redis/WS failures are
    logged but do not roll back the persisted decision.
    """
    session = await svc._get_owned_session_for_update(session_id, user_id)

    # 归档区禁写（2026-08-30 审计④-7）：plan 确认会解除 daemon 侧 agent 的
    # 等待让其继续在归档工作区执行写操作——与 inject/interrupt 同拦（409），
    # 不持久化 decision、不推送控制消息。
    await svc._ensure_session_workspace_writable(session)

    # Validate the run exists and belongs to this session.
    run = (
        await svc._session.execute(
            select(AgentRun).where(
                AgentRun.id == run_id,
                AgentRun.agent_session_id == session_id,
            )
        )
    ).scalar_one_or_none()
    if run is None:
        raise DaemonSessionNotFound(
            f"AgentRun '{run_id}' not found for session '{session_id}'.",
            details={"session_id": str(session_id), "run_id": str(run_id)},
        )

    # Defensive service-level validation: DTO already enforces, but callers
    # bypassing the REST layer (e.g., internal scripts) must not leave invalid
    # state. Match the DTO error message so tests see consistent text.
    if decision not in (
        PlanResponseDecision.confirm,
        PlanResponseDecision.revise,
        PlanResponseDecision.cancel,
    ):
        raise DaemonSessionConfigInvalid(
            "decision must be one of confirm, revise, cancel.",
            details={"decision": str(decision)},
        )
    if decision in (PlanResponseDecision.revise, PlanResponseDecision.cancel) and (
        not feedback or not feedback.strip()
    ):
        raise DaemonSessionConfigInvalid(
            "decision 为 revise/cancel 时 feedback 必填且不可为空白",
            details={"decision": decision.value},
        )

    # Persist the decision into session.config (no new table).
    responded_at = datetime.now(UTC).isoformat().replace("+00:00", "Z")
    config = dict(session.config or {})
    config["plan_response"] = {
        "run_id": str(run_id),
        "decision": decision.value,
        "feedback": feedback,
        "responded_at": responded_at,
    }
    session.config = config
    flag_modified(session, "config")
    svc._session.add(session)
    await svc._session.commit()
    await svc._session.refresh(session)

    # Best-effort WebSocket push to the owning daemon.
    delivered = False
    if session.runtime_id is not None:
        from app.modules.daemon.ws_hub import get_daemon_ws_hub

        hub = get_daemon_ws_hub()
        daemon_id = await _resolve_daemon_id_for_runtime(svc._session, session.runtime_id)
        if daemon_id is not None:
            delivered = await hub.send_session_control(
                daemon_id,
                DAEMON_MSG_PLAN_RESPONSE,
                {
                    "session_id": str(session_id),
                    "run_id": str(run_id),
                    "decision": decision.value,
                    "feedback": feedback,
                    "runtime_id": str(session.runtime_id),
                },
            )
    if not delivered:
        _svc.log.warning(
            "plan_response_ws_send_failed",
            session_id=str(session_id),
            run_id=str(run_id),
            runtime_id=str(session.runtime_id) if session.runtime_id else None,
        )

    return {"ok": True, "delivered": delivered}


async def _dispatch_inject_turn(
    svc,
    session: AgentSession,
    run: AgentRun,
    *,
    prompt: str,
    config_switch: bool,
    profile_payload: dict | None,
    provider_config_payload: dict | None,
    first_turn_briefing: str | None,
    page_context: PageContextCreateBlock | None,
    inject_attachments: list,
) -> SessionDispatchResult:
    """commit 后派发段（task-08 自 _inject_into_session:4133-4291 拆出，零改写）。

    ready 等待（8s 超时 fallback）→ lease claim_token 取数 → 切换分支
    SESSION_SWITCH_CONFIG 直推 / 普通分支 SESSION_INJECT 三段式（页面前导 +
    首主控简报拼接）→ 失败收敛（取消 pending 指令 + run failed + 504）→
    turn_injected 事件。
    """
    # 原 _inject_into_session 局部变量（= session.id），随分段拆出保名。
    session_id = session.id

    # task-08 / FR-03 / D-003@v1：commit AgentRun 后、send SESSION_INJECT 前阻塞等
    # daemon session ready（确保 inject 不在 daemon create 完成前到而被静默丢弃，
    # /model 空白根因）。已 ready 立即返 True 零开销直通；超时 8s（ql-20260814-008，
    # 原 30s 会先被 Next.js 代理超时掐断）未 ready 不
    # 抛错不 return，落 warn 日志后 fallback 仍执行原 send SESSION_INJECT 分支，
    # 兼容旧 daemon 不上报 ready（D-003 / R-02）。
    ready = await _svc.get_session_readiness().wait(session_id, timeout=8)
    if not ready:
        _svc.log.warning("session_ready_timeout", session_id=str(session_id))

    # Dispatch the new turn control message.
    from app.modules.daemon.ws_hub import get_daemon_ws_hub

    # gap-2：从 lease metadata 取 claim_token（claim 时已写入或 prepare 时预生成），
    # 后续 turn 的 SESSION_INJECT 仍携带同一 lease 级 claim_token（跨 turn 复用）。
    lease_row = await svc._session.get(DaemonTaskLease, session.lease_id)
    lease_meta = dict((lease_row.metadata_ if lease_row else None) or {})
    inject_claim_token = lease_meta.get("claim_token", "")

    hub = get_daemon_ws_hub()
    # task-06: resolve provider runtime_id → daemon_instance_id (WS route key).
    runtime_id = session.runtime_id
    daemon_id = (
        await _resolve_daemon_id_for_runtime(svc._session, runtime_id)
        if runtime_id is not None
        else None
    )
    control_ok = False
    # ql-20260904-审计 H1：控制指令行仅在非切换分支的 enqueue_and_push 赋值
    # ——runtime 解析失败（daemon_id=None）与切换分支 hub 直推失败的路径没有
    # 指令行，须预初始化 None，下方 not control_ok 收链判空后再取消（原实现
    # 引用未绑定的 _row 抛 UnboundLocalError：500 + run 永久残留 running）。
    _row: DaemonControlCommand | None = None
    if daemon_id is not None and runtime_id is not None:
        if config_switch:
            # task-05 / D-012：切换分支下发 SESSION_SWITCH_CONFIG（原子 payload，
            # 字段对齐 design §7.2 与 task-08 SessionSwitchConfigPayload 契约，
            # camelCase；profile/providerConfig 为 null 表示该维度不切）。
            control_ok = await hub.send_session_control(
                daemon_id,
                _svc.DAEMON_MSG_SESSION_SWITCH_CONFIG,
                {
                    "sessionId": str(session.id),
                    "runId": str(run.id),
                    "claimToken": inject_claim_token,
                    # ql-20260901-002：切换轮带文本时同样剥 /team 前缀（切换
                    # 轮 prompt 也直达 agent）。
                    "prompt": _strip_team_command_prefix(prompt),
                    "profile": profile_payload,
                    "providerConfig": provider_config_payload,
                },
            )
        else:
            # task-08 / D-004@v1：命中首主控轮判定（first_turn_briefing 非空）时
            # prompt 前缀简报（简报+\n\n---\n\n+用户消息，简报在前）；仅改本
            # payload 的 prompt 内容，SESSION_INJECT 协议字段不变（零 daemon
            # 改动）。AgentRunLog(user_input)/上方 SESSION_SWITCH_CONFIG 分支/
            # 离线收敛 output_redacted 均保持用户原文（展示层干净）。
            # ql-20260825-004：每轮注入构建当前页面上下文前导（复用 create 路径
            # build_page_context_preamble，服务端 DB 回查；查无/未传 → None 不注入）。
            page_preamble = None
            if page_context is not None:
                from app.modules.daemon.session.context import (
                    build_page_context_preamble,
                )

                page_preamble = await build_page_context_preamble(
                    svc._session,
                    page_context.page_key,
                    page_context.project_id,
                    page_context.route_key,
                    page_context.workspace_id,
                    page_context.tab_key,
                )
            # 拼接顺序：页面前导（本轮实时）→ 团队简报（首主控轮一次性）→ 用户消息。
            # ql-20260901-002：派发文本剥 /team 前缀（前端发原始输入，展示层
            # 保留 "/team 目标"；agent 永不接收平台指令字面）。无前缀消息
            # 剥离为 no-op，无 mission 普通会话逐字节不变。
            _inject_user_msg = _strip_team_command_prefix(prompt)
            parts = []
            if page_preamble:
                parts.append(page_preamble)
            if first_turn_briefing:
                parts.append(first_turn_briefing)
            if parts:
                parts.append(_inject_user_msg)
                inject_prompt = "\n\n---\n\n".join(parts)
            else:
                inject_prompt = _inject_user_msg
            inject_payload = {
                "session_id": str(session.id),
                "lease_id": str(session.lease_id),
                "run_id": str(run.id),
                "prompt": inject_prompt,
                "claim_token": inject_claim_token,
                "runtime_id": str(runtime_id),  # design §5.3 provider discriminator
            }
            # 2026-08-20 task-06：附件仅在有附件时附加（无附件路径与现状
            # 逐字节一致零回归；旧 daemon 忽略未知键，协议向后兼容）。
            if inject_attachments:
                inject_payload["attachments"] = inject_attachments
            # task-04（design A2）：SESSION_INJECT 走控制指令三段式——WS
            # 失败/不在线落库 pending 待补拉（run failed 收敛语义保持，见
            # 下方 not control_ok 分支；补拉到达时 daemon 侧按 command_id
            # 幂等，GC 10min 过期联动兜底）。
            _row, control_ok = await ControlCommandService(svc._session).enqueue_and_push(
                daemon_id=daemon_id,
                runtime_id=runtime_id,
                kind=KIND_SESSION_INJECT,
                payload=inject_payload,
            )
    if not control_ok:
        # New run failed to dispatch → converge it to failed but leave the
        # session active so the caller can retry (boundary #13).
        # ql-20260903-016：run 即将判 failed + 504「未能发送」，pending 指令
        # 必须同步取消——否则 daemon TTL 内重连补拉会照常执行本轮（消息
        # 「复活」，用户重发后同一条消息跑两遍）。仅非切换分支落有指令行
        # （见上方 _row 预初始化注释）；无行路径（runtime 解析失败/切换直推
        # 失败）本就没有可补拉的指令，跳过取消。
        if _row is not None:
            await svc._cancel_pending_control_command(_row.id, run_id=run.id)
        # task-05 / Grill C-11：切换分支同款收敛——run→failed、session 保持
        # active、可重试；会话三列保留已切换的新配置（DB 先于消息落库，
        # 重试重发同一切换即收敛，daemon 未收到消息前不会跑切换轮）。
        try:
            run.status = "failed"
            run.finished_at = datetime.now(UTC)
            # task-04：错误码常量唯一落点迁 control_commands.py（GC inject
            # 过期联动复用同一取值），本处语义不变。
            run.error_code = INJECT_SEND_FAILED_ERROR_CODE
            run.output_redacted = f"failed to dispatch turn (daemon offline): prompt={prompt!r}"
            svc._session.add(run)
            await svc._session.commit()
            await svc._session.refresh(run)
        except Exception:
            await svc._session.rollback()
            _svc.log.warning(
                "session_inject_run_convergence_failed",
                session_id=str(session.id),
                run_id=str(run.id),
            )
        raise DaemonRuntimeOffline(
            "执行代理当前不在线，本轮消息未能发送。请确认 daemon 已运行后重试。",
            details={
                "runtime_id": str(session.runtime_id),
                "session_id": str(session.id),
                "run_id": str(run.id),
            },
        )

    await svc._publish_session_event(
        session.id,
        {"event": "turn_injected", "session_id": str(session.id), "run_id": str(run.id)},
    )
    return SessionDispatchResult(
        agent_session=session,
        agent_run=run,
        lease_id=session.lease_id,
    )
