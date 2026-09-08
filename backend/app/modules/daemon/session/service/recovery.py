"""daemon 重启恢复 / 优雅停止挂起 / 重连确认簇（task-08 拆分，原 :5338-6036）。

6 个方法体下沉为模块函数（第一参数 svc）。D-007：log /
get_session_readiness / publish_sessions_changed / ACTIVE_TURN_STATUSES /
DAEMON_*_ERROR_CODE 经 ``_svc.`` 延迟解析。
"""

from __future__ import annotations

import secrets
import uuid
from datetime import UTC, datetime
from typing import Literal

from sqlalchemy import select, update
from sqlalchemy.orm.attributes import flag_modified
from sqlmodel import col

import app.modules.daemon.session.service as _svc
from app.core.errors import AppError
from app.modules.agent.model import AgentRun, AgentSession, AgentSessionQueuedMessage
from app.modules.daemon.model import DaemonRuntime, DaemonTaskLease

from .errors import DaemonSessionInvariantViolation
from .results import SessionRecoveryResult, SuspendBatchResult


async def recover_session_after_daemon_restart(
    svc,
    session_id: uuid.UUID,
    *,
    runtime_id: uuid.UUID,
    lease_id: uuid.UUID,
    provider: str,
    agent_session_id: str,
    interrupted_run_id: uuid.UUID | None,
) -> SessionRecoveryResult:
    """Reconcile an interactive session after daemon restart (task-10 §4.4).

    Called once per persisted record on daemon boot, BEFORE the daemon runs
    ``SessionManager.restoreAndReconnect`` (query resume). Independent of
    end_session / create_session / inject_session — does not touch the
    existing 4 session REST paths.

    Single transaction must:
      1. SELECT AgentSession FOR UPDATE; validate ownership
         (runtime_id / lease_id / provider / lease.kind == interactive).
      2. Session already ended/failed → return terminal (no resurrect,
         no run convergence). Daemon deletes local record.
      3. Ownership mismatch (runtime/lease/provider/lease kind) OR session
         missing → return ``rejected``. Daemon deletes local record; no
         token rotation, no local session built.
      4. Recoverable（非终态一律：active/suspended/pending/reconnecting，
         task-05 起 suspended 经 offline sweep/优雅停止产生）→ write
         status=reconnecting + last_active_at=now.
      5. interrupted_run_id non-null → converge ONLY the same-session run
         whose status is in _svc.ACTIVE_TURN_STATUSES to failed (error_code=
         daemon_restarted, finished_at=now); already-terminal → idempotent
         (keep result). Cross-session run id → invariant violation (409).
      6. Another non-terminal run on same session (besides interrupted) →
         invariant violation (409) — never guess or batch-fail.
      7. Rotate lease.claim_token (防旧 claim 重放，task-10 §7 边界 15).
      8. Publish session reconnecting event; return result.

    ``agent_session_id`` is accepted for log/audit only (SDK session_id);
    backend never trusts it for ownership — runtime_id/lease_id/provider
    are the real guards.
    """
    try:
        # Ownership lock + validate. SELECT FOR UPDATE serializes concurrent
        # recover on same session (PostgreSQL); SQLite still exercises the
        # query + branches.
        stmt = select(AgentSession).where(AgentSession.id == session_id).with_for_update()
        session = (await svc._session.execute(stmt)).scalar_one_or_none()

        if session is None:
            _svc.log.info(
                "session_recover_not_found",
                session_id=str(session_id),
                runtime_id=str(runtime_id),
            )
            # P2（2026-08-25 会话审查）：SELECT FOR UPDATE 后早退必须 rollback
            # 释放行锁，否则事务悬挂到请求 teardown。
            await svc._session.rollback()
            return SessionRecoveryResult(
                session_id=session_id,
                lease_id=lease_id,
                status="rejected",
            )

        # Session already terminal → do not resurrect, do not converge runs.
        if session.status in ("ended", "failed"):
            _svc.log.info(
                "session_recover_already_terminal",
                session_id=str(session_id),
                status=session.status,
            )
            # rollback 前取标量（rollback 会过期 ORM 属性，异步下访问即炸）。
            ended_session_id = session.id
            ended_lease_id = session.lease_id
            ended_status = session.status
            await svc._session.rollback()
            return SessionRecoveryResult(
                session_id=ended_session_id,
                lease_id=ended_lease_id,
                status=ended_status,
            )

        # Ownership guards: runtime/lease/provider/lease kind must all match.
        ownership_ok = (
            session.runtime_id == runtime_id
            and session.lease_id == lease_id
            and session.provider == provider
        )
        lease: DaemonTaskLease | None = None
        if session.lease_id is not None:
            lease = await svc._session.get(DaemonTaskLease, session.lease_id)
        lease_ok = (
            lease is not None
            and lease.kind == "interactive"
            and lease.id == session.lease_id
            and lease.id == lease_id
        )
        if not ownership_ok or not lease_ok:
            _svc.log.warning(
                "session_recover_ownership_mismatch",
                session_id=str(session_id),
                runtime_id=str(runtime_id),
                expected_runtime_id=str(session.runtime_id),
                lease_id=str(lease_id),
                lease_kind=lease.kind if lease else None,
            )
            # rollback 前取标量 + 释放行锁（同上 P2）。
            rejected_session_id = session.id
            rejected_lease_id = session.lease_id
            await svc._session.rollback()
            return SessionRecoveryResult(
                session_id=rejected_session_id,
                lease_id=rejected_lease_id,
                status="rejected",
            )

        # Converge crashed currentRun BEFORE writing reconnecting, so the
        # reconnecting state never co-exists with a lingering running run.
        interrupted_status: Literal["failed"] | None = None
        if interrupted_run_id is not None:
            interrupted_status = await svc._converge_crashed_run(
                session_id=session.id,
                run_id=interrupted_run_id,
            )

        # Sanity invariant: no OTHER non-terminal run should remain on this
        # session after convergence (else daemon state is ambiguous). This
        # catches the rare double-crash / state-corruption case.
        await svc._assert_no_other_active_run(
            session_id=session.id,
            excluded_run_id=interrupted_run_id,
        )

        # Write reconnecting + rotate token.
        now = datetime.now(UTC)
        session.status = "reconnecting"
        session.last_active_at = now
        svc._session.add(session)

        if lease is not None:
            new_token = secrets.token_hex(32)
            metadata = dict(lease.metadata_ or {})
            metadata["claim_token"] = new_token
            lease.metadata_ = metadata
            flag_modified(lease, "metadata_")
            lease.updated_at = now
            svc._session.add(lease)

        await svc._session.commit()
        await svc._session.refresh(session)

        await svc._publish_session_event(
            session.id,
            {
                "event": "session_reconnecting",
                "session_id": str(session.id),
                "runtime_id": str(runtime_id),
                "interrupted_run_id": (str(interrupted_run_id) if interrupted_run_id else None),
            },
        )
        # task-02：status→reconnecting 已落库，发布全局列表变更信号。
        await _svc.publish_sessions_changed("status_changed", session.id, session.user_id)
        _svc.log.info(
            "session_recovered_reconnecting",
            session_id=str(session.id),
            runtime_id=str(runtime_id),
            interrupted_run_status=interrupted_status,
        )
        return SessionRecoveryResult(
            session_id=session.id,
            lease_id=session.lease_id,
            status="reconnecting",
            interrupted_run_status=interrupted_status,
        )
    except AppError:
        await svc._session.rollback()
        raise
    except Exception:
        await svc._session.rollback()
        raise


async def _converge_crashed_run(
    svc,
    *,
    session_id: uuid.UUID,
    run_id: uuid.UUID,
) -> Literal["failed"] | None:
    """Converge a single crashed run to failed (daemon_restarted).

    - Run belongs to a different session → invariant violation (409).
    - Run already terminal → idempotent, return None (keep result).
    - Run in _svc.ACTIVE_TURN_STATUSES → failed + finished_at + error_code.

    Returns ``"failed"`` only when this call actually converged the run.
    """
    run = await svc._session.get(AgentRun, run_id)
    if run is None:
        # Run id stale/unknown — treat as nothing to converge (idempotent).
        _svc.log.warning(
            "session_recover_interrupted_run_missing",
            session_id=str(session_id),
            run_id=str(run_id),
        )
        return None

    if run.agent_session_id != session_id:
        # Cross-session run id — never touch another session's run.
        raise DaemonSessionInvariantViolation(
            f"interrupted_run_id '{run_id}' belongs to another session.",
            details={
                "session_id": str(session_id),
                "run_id": str(run_id),
                "run_session_id": str(run.agent_session_id),
            },
        )

    if run.status in _svc.TERMINAL_TURN_STATUSES:
        # Idempotent: keep the original terminal result.
        return None

    if run.status not in _svc.ACTIVE_TURN_STATUSES:
        # Unexpected state (e.g. unknown status string) — still converge to
        # failed to avoid a stuck non-terminal run after restart.
        _svc.log.warning(
            "session_recover_run_unexpected_status",
            session_id=str(session_id),
            run_id=str(run_id),
            run_status=run.status,
        )

    now = datetime.now(UTC)
    run.status = "failed"
    run.finished_at = now
    run.error_code = "daemon_restarted"
    if not run.output_redacted:
        run.output_redacted = "daemon_restarted"
    svc._session.add(run)

    # ql-20260815-003：run 收敛 failed 后其 pending AskUserQuestion 卡成孤儿，
    # 置 cancelled（不自带 commit，随调用方 recover 事务一起提交）。
    from app.modules.daemon.permission_service import cancel_pending_dialogs_for_run

    await cancel_pending_dialogs_for_run(svc._session, run_id)
    return "failed"


async def _assert_no_other_active_run(
    svc,
    *,
    session_id: uuid.UUID,
    excluded_run_id: uuid.UUID | None,
) -> None:
    """Raise invariant violation if another non-terminal run lingers."""
    stmt = select(AgentRun.id).where(
        AgentRun.agent_session_id == session_id,
        col(AgentRun.status).in_(list(_svc.ACTIVE_TURN_STATUSES)),
    )
    ids = [row[0] for row in (await svc._session.execute(stmt)).all() if row[0] != excluded_run_id]
    if ids:
        raise DaemonSessionInvariantViolation(
            f"Session '{session_id}' has an unexpected lingering active run after daemon restart.",
            details={
                "session_id": str(session_id),
                "lingering_run_ids": [str(i) for i in ids],
            },
        )


async def suspend_sessions_for_daemon(
    svc,
    daemon_instance_id: uuid.UUID,
) -> SuspendBatchResult:
    """daemon 优雅停止批量挂起（2026-08-29-daemon-platform-resilience task-05 / design A5 / FR-04）.

    daemon ``stop()`` 在 markOffline 前经 ``POST /sessions/suspend-batch``
    调入（body ``daemon_local_id`` = ``daemon_instances.id``，归属校验在
    router 层）。该 daemon 全部 runtime 名下的 **active** 会话单事务收敛
    （对齐 offline sweep 手法，条件 UPDATE 重挂状态条件保证幂等可重入），
    2026-08-29-batch-session-inherit task-01 起按 ``parent_session_id``
    分流两组（design S1）：

    - **主会话组**（parent IS NULL，语义逐字不变）：会话 → ``suspended`` +
      ``last_active_at=now``（挂起时刻写入，作 sweep 超龄 GC
      （SUSPENDED_MAX_AGE_SEC，24h）的时间基准——对齐 recover 翻
      reconnecting 时写 last_active_at 的先例）；中断轮 run
      （_svc.ACTIVE_TURN_STATUSES）→ ``failed`` + ``finished_at`` +
      ``error_code=daemon_stopped``（D-001：被中断的一轮标失败，不影响
      会话存活）；
    - **worker 子会话组**（parent 非空）：会话 → ``failed`` + ``ended_at``
      （worker 是临时会话无用户手恢复，挂起只会卡 mission 等 24h GC）；
      中断轮 run → ``failed`` + ``error_code=daemon_interrupted``
      （与 daemon_stopped 区分来源，作 task-02 自动重派的种子标识）；终态
      行对齐 sweep 档发 ``session_ended`` + 列表 ``status_changed``；
    - 挂起 lease（pending/claimed）→ ``cancelled`` 两组共享（终态 lease
      不回写）。

    worker 识别唯一口径是 ``parent_session_id`` 非空（兼容 role=NULL 老
    worker 行，禁用 role 词表兜底）；本方法产出 ``workers`` 重派种子
    ``(session_id, runtime_id)`` 列表并在事务提交后异步 fire task-02 自动
    重派（失败仅记日志，不阻塞本路径）。

    **pending 会话不挂起**：daemon 本地 sessions.json 只快照 active 且有
    agentSessionId 的会话，pending 行标 suspended 后无人 recover 只能等
    24h GC（D-007 裁定维持 failed 归宿——那条路径归 offline sweep，本方法
    条件锁 ``status == "active"`` 不碰 pending/终态行）。

    commit 后逐行 best-effort 发列表变更信号 ``status_changed``；suspended
    **非终态不发 session_ended**（design A5：SSE 会话流继续 keepalive，
    列表视图经信号秒级刷新）；worker 组 failed 终态发 session_ended。
    """
    try:
        daemon_runtime_ids = select(DaemonRuntime.id).where(
            col(DaemonRuntime.daemon_instance_id) == daemon_instance_id
        )
        hit_rows = (
            await svc._session.execute(
                select(
                    AgentSession.id,
                    AgentSession.lease_id,
                    AgentSession.runtime_id,
                    AgentSession.parent_session_id,
                ).where(
                    AgentSession.status == "active",
                    col(AgentSession.runtime_id).in_(daemon_runtime_ids),
                )
            )
        ).all()
        if not hit_rows:
            return SuspendBatchResult(suspended=0, runs_failed=0)

        # task-01 分流（design S1）：parent_session_id 非空 = worker 子会话。
        main_ids = [row.id for row in hit_rows if row.parent_session_id is None]
        worker_rows = [row for row in hit_rows if row.parent_session_id is not None]
        worker_ids = [row.id for row in worker_rows]
        hit_ids = [row.id for row in hit_rows]
        now = datetime.now(UTC)

        # 主会话组：suspended 语义逐字不变（回归锁定）。
        suspended_result = await svc._session.execute(
            update(AgentSession)
            .where(
                AgentSession.id.in_(main_ids),
                AgentSession.status == "active",
            )
            .values(status="suspended", last_active_at=now)
        )
        suspended = int(suspended_result.rowcount or 0)

        # worker 组：改判 failed + ended_at（挂起无意义——无人手 recover，
        # 重派由 task-02 以 workers 种子翻回 active 续跑）。
        if worker_ids:
            await svc._session.execute(
                update(AgentSession)
                .where(
                    AgentSession.id.in_(worker_ids),
                    AgentSession.status == "active",
                )
                .values(status="failed", ended_at=now)
            )

        # 中断轮 run 收敛：主会话 daemon_stopped（既有语义）、worker 组
        # daemon_interrupted（新错误码区分来源）。
        runs_failed = 0
        if main_ids:
            runs_result = await svc._session.execute(
                update(AgentRun)
                .where(
                    AgentRun.agent_session_id.in_(main_ids),
                    col(AgentRun.status).in_(list(_svc.ACTIVE_TURN_STATUSES)),
                )
                .values(
                    status="failed",
                    finished_at=now,
                    error_code=_svc.DAEMON_STOPPED_ERROR_CODE,
                )
            )
            runs_failed += int(runs_result.rowcount or 0)
        if worker_ids:
            runs_result = await svc._session.execute(
                update(AgentRun)
                .where(
                    AgentRun.agent_session_id.in_(worker_ids),
                    col(AgentRun.status).in_(list(_svc.ACTIVE_TURN_STATUSES)),
                )
                .values(
                    status="failed",
                    finished_at=now,
                    error_code=_svc.DAEMON_INTERRUPTED_ERROR_CODE,
                )
            )
            runs_failed += int(runs_result.rowcount or 0)

        lease_ids = [row.lease_id for row in hit_rows if row.lease_id is not None]
        if lease_ids:
            await svc._session.execute(
                update(DaemonTaskLease)
                .where(
                    DaemonTaskLease.id.in_(lease_ids),
                    DaemonTaskLease.status.in_(("pending", "claimed")),
                )
                .values(status="cancelled", updated_at=now)
            )

        await svc._session.commit()

        # 以 UPDATE 后状态复查决定广播对象（并发翻转的行 status 已非
        # suspended / failed 不发——对齐 sweep 两档的防误伤口径）。
        final_rows = (
            await svc._session.execute(
                select(AgentSession.id, AgentSession.status, AgentSession.user_id).where(
                    AgentSession.id.in_(hit_ids)
                )
            )
        ).all()
        worker_id_set = set(worker_ids)
        for row in final_rows:
            if row.status == "suspended":
                await _svc.publish_sessions_changed("status_changed", row.id, row.user_id)
            elif row.id in worker_id_set and row.status == "failed":
                # worker 组终态：对齐 sweep 档发 session_ended（SSE 收尾）+
                # 列表 status_changed；reason 即中断错误码。
                await svc._publish_session_event(
                    row.id,
                    {
                        "event": "session_ended",
                        "session_id": str(row.id),
                        "reason": _svc.DAEMON_INTERRUPTED_ERROR_CODE,
                        "current_run_id": None,
                    },
                )
                await _svc.publish_sessions_changed("status_changed", row.id, row.user_id)
        result = SuspendBatchResult(
            suspended=suspended,
            runs_failed=runs_failed,
            workers=[(row.id, row.runtime_id) for row in worker_rows],
        )
        # task-02（design S2）：worker failed 落库（上方事务已 commit）后异步
        # fire 自动重派——复用原会话 + resume_session_id 续 SDK 上下文；不
        # 阻塞挂起主路径，重派失败仅记日志（下轮 offline sweep 60s 周期自愈）。
        if result.workers:
            from app.modules.agent.worker_redispatch import fire_worker_redispatch

            fire_worker_redispatch(result.workers)
        return result
    except Exception:
        await svc._session.rollback()
        raise


async def confirm_session_reconnected(
    svc,
    session_id: uuid.UUID,
    *,
    runtime_id: uuid.UUID,
    lease_id: uuid.UUID | None = None,
) -> str:
    """Flip a reconnecting session to active after daemon resume succeeds.

    Two-phase recover (task-10 §4.4 step 7): daemon runs
    recover_session_after_daemon_restart (writes reconnecting) → then
    restoreAndReconnect (driver.start resume) → on success calls this to
    flip reconnecting → active. On resume failure the daemon leaves the
    session in reconnecting (converged by task-07 idle sweep or manual end).

    Ownership guard: runtime_id must match; mismatch → rejected.
    Stale-confirmation guard (DS-4, 2026-08-21-session-reopen-resume):
    when ``lease_id`` is provided and differs from the session's current
    lease, this is a late confirmation from a previous reopen → idempotent
    skip (no flip, no error, current status returned; a reconnecting
    session therefore stays reconnecting). Omitted ``lease_id`` (legacy
    daemon-restart recover chain) keeps the pre-DS-4 behavior verbatim.
    Non-reconnecting session (already active/ended/failed) → idempotent
    return of current status. Soft-deleted session (``deleted_at`` set) is
    treated as nonexistent → ``"rejected"``（quick 风险审查修）：sweep 已
    不复活软删会话，此处收口 daemon 重启恢复链（本地 sessions.json 仍含
    已删会话）迟到的 confirm——不得把已删行翻回 active 并触发其遗留
    排队消息补派发。

    2026-08-31-session-queue-ux task-03 / D-008: after the active-flip
    commit succeeds, a queued-message redispatch is fired in the
    background if (and only if) pending queue entries exist.
    """
    try:
        stmt = (
            select(AgentSession)
            .where(
                AgentSession.id == session_id,
                AgentSession.runtime_id == runtime_id,
                AgentSession.deleted_at.is_(None),
            )
            .with_for_update()
        )
        session = (await svc._session.execute(stmt)).scalar_one_or_none()
        if session is None:
            # P2（2026-08-25 会话审查）：FOR UPDATE 后早退 rollback 释放行锁。
            await svc._session.rollback()
            return "rejected"
        if lease_id is not None and session.lease_id != lease_id:
            # DS-4 stale-confirmation guard: idempotent skip — 迟到的旧
            # 确认不得误翻第二次 reopen 的 reconnecting。
            _svc.log.info(
                "session_confirm_stale_lease_skipped",
                session_id=str(session_id),
                runtime_id=str(runtime_id),
                current_lease_id=str(session.lease_id),
                presented_lease_id=str(lease_id),
            )
            # rollback 前取标量（rollback 过期 ORM 属性）。
            stale_status = session.status
            await svc._session.rollback()
            return stale_status
        if session.status != "reconnecting":
            # Idempotent: already active (or terminal). Return current.
            current_status = session.status
            await svc._session.rollback()
            return current_status

        session.status = "active"
        session.last_active_at = datetime.now(UTC)
        svc._session.add(session)
        await svc._session.commit()
        await svc._session.refresh(session)

        await svc._publish_session_event(
            session.id,
            {"event": "session_reconnected", "session_id": str(session.id)},
        )
        # task-02：status→active 翻转已落库，发布全局列表变更信号。
        await _svc.publish_sessions_changed("status_changed", session.id, session.user_id)
        # task-10 / FR-04：recover 主路径双保险（design Phase 4 / gap-1）。
        # reconnecting→active 翻转 + commit + publish 成功之后调 mark_ready，
        # 与 daemon restoreAndReconnect 上报构成双保险，防 daemon 上报丢失致
        # inject 等 ready 超时。mark_ready 幂等（set.add + event.set），与
        # daemon 上报互为补集非互斥。best-effort（mark 内部仅内存操作，理论
        # 不抛；try 隔离异常防污染已 commit 成功的事务，参照 task-09 clear 风格）。
        try:
            _svc.get_session_readiness().mark_ready(session_id)
        except Exception:
            _svc.log.warning(
                "session_ready_mark_failed",
                session_id=str(session_id),
            )
        # 2026-08-31-session-queue-ux task-03 / FR-01 / D-008：恢复补派发钩子。
        # 锚点=active 翻转 commit 之后（recover_session_after_daemon_restart
        # 只置 reconnecting 从不翻 active，挂那里必空转——Grill 修正；reopen
        # 恢复链同样经本 confirm 翻 active，同点自然覆盖）。先查有无 pending
        # 排队条目（轻量 EXISTS，无 pending 零开销不起任务——防空转，对齐
        # run_sync close_interactive_run 先查后 fire 模式），有才 fire 独立
        # DB session 的 dispatch_next_queued_message（H1）；dispatch 内部
        # 自查自弃（会话可能已又翻非 active/终态）。try 隔离防 probe/fire
        # 异常污染已 commit 的 active 翻转事务（mark_ready 同款风格），
        # 后台任务异常由 done_callback 记日志不上抛。
        try:
            has_pending = (
                await svc._session.execute(
                    select(AgentSessionQueuedMessage.id)
                    .where(
                        AgentSessionQueuedMessage.agent_session_id == session_id,
                        AgentSessionQueuedMessage.status == "pending",
                    )
                    .limit(1)
                )
            ).scalar_one_or_none()
            if has_pending is not None:
                svc._fire_background_task(_svc.dispatch_next_queued_message(session_id))
        except Exception:
            _svc.log.warning(
                "session_reconnect_queue_redispatch_failed",
                session_id=str(session_id),
            )
        _svc.log.info(
            "session_reconnected_active",
            session_id=str(session.id),
            runtime_id=str(runtime_id),
        )
        return "active"
    except AppError:
        await svc._session.rollback()
        raise
    except Exception:
        await svc._session.rollback()
        raise


async def mark_session_recovery_failed(
    svc,
    session_id: uuid.UUID,
    *,
    runtime_id: uuid.UUID,
    reason: str = "restore_failed",
    lease_id: uuid.UUID | None = None,
) -> str:
    """Flip a non-terminal session to failed after daemon resume failed.

    Daemon calls this when driver.start({resume}) throws (cwd mismatch /
    executable missing / SDK jsonl missing). The session was written
    reconnecting by recover_session_after_daemon_restart; resume failing
    means it cannot be restored → failed terminal.

    Stale-confirmation guard (DS-4, 2026-08-21-session-reopen-resume):
    when ``lease_id`` is provided and differs from the session's current
    lease, this is a late failure report from a previous reopen →
    idempotent skip (no flip, no error, current status returned). Omitted
    ``lease_id`` keeps the pre-DS-4 behavior verbatim.

    Flip semantics are intentionally broad: any status outside
    ``{ended, failed}`` (reconnecting AND active alike) converges to
    ``failed`` — daemon.ts markRecoveredSessionFailed async-fail bridge
    relies on active→failed after confirm succeeded (DS-4 review gap:
    must NOT be narrowed to reconnecting-only).
    """
    try:
        stmt = (
            select(AgentSession)
            .where(
                AgentSession.id == session_id,
                AgentSession.runtime_id == runtime_id,
            )
            .with_for_update()
        )
        session = (await svc._session.execute(stmt)).scalar_one_or_none()
        if session is None:
            # P2（2026-08-25 会话审查）：FOR UPDATE 后早退 rollback 释放行锁。
            await svc._session.rollback()
            return "rejected"
        if lease_id is not None and session.lease_id != lease_id:
            # DS-4 stale-confirmation guard: idempotent skip — 迟到的旧
            # 失败上报不得误杀第二次 reopen 的会话。
            _svc.log.info(
                "session_recovery_failed_stale_lease_skipped",
                session_id=str(session_id),
                runtime_id=str(runtime_id),
                current_lease_id=str(session.lease_id),
                presented_lease_id=str(lease_id),
            )
            # rollback 前取标量（rollback 过期 ORM 属性）。
            stale_status = session.status
            await svc._session.rollback()
            return stale_status
        if session.status in ("ended", "failed"):
            current_status = session.status
            await svc._session.rollback()
            return current_status

        now = datetime.now(UTC)
        session.status = "failed"
        session.ended_at = now
        session.last_active_at = now
        svc._session.add(session)

        # ql-20260823-007：恢复失败 = 本次 reopen 的租约已死。挂起态
        # （pending/claimed——含被任务轮询误认领的）收敛 cancelled 防永挂；
        # 终态（completed/cancelled/expired）不动（幂等）。cancelled 语义对齐
        # sweep.py / reopen DS-5 分支（interactive lease 恒 NULL
        # lease_expires_at，expired 不适用）。
        if session.lease_id is not None:
            failed_lease = await svc._session.get(DaemonTaskLease, session.lease_id)
            if failed_lease is not None and failed_lease.status in ("pending", "claimed"):
                failed_lease.status = "cancelled"
                failed_lease.updated_at = now
                svc._session.add(failed_lease)
        # ql-20260903-017：恢复失败 = 会话终态，排队消息一并翻 failed
        # （对齐 end_session 收口——dispatch 只在 run 终态钩子触发，会话
        # 已死永无终态，pending 条目会永久「等待中」）。
        await svc._fail_pending_queued_messages(session_id, "会话恢复失败，排队消息未发送。")
        await svc._session.commit()
        await svc._session.refresh(session)

        # task-09 / FR-04：failed 终态清理 ready 状态（commit 后事务外，
        # best-effort；内层 try 隔离 clear 异常，不影响外层 commit 错误处理）。
        try:
            _svc.get_session_readiness().clear(session_id)
        except Exception:
            _svc.log.warning(
                "session_ready_clear_failed",
                session_id=str(session_id),
            )

        await svc._publish_session_event(
            session.id,
            {
                "event": "session_recovery_failed",
                "session_id": str(session.id),
                "reason": reason,
            },
        )
        # task-02：status→failed 已落库，发布全局列表变更信号。
        await _svc.publish_sessions_changed("status_changed", session.id, session.user_id)
        _svc.log.warning(
            "session_recovery_failed",
            session_id=str(session.id),
            runtime_id=str(runtime_id),
            reason=reason,
        )
        return "failed"
    except AppError:
        await svc._session.rollback()
        raise
    except Exception:
        await svc._session.rollback()
        raise
