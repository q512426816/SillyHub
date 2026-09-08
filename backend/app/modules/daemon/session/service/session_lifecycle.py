"""会话生命周期：reopen / 软删 / 归档 / ctx window（task-08 拆分，原 :6290-6837）。

方法体下沉为模块函数（第一参数 svc）。D-007：log /
publish_sessions_changed / ACTIVE_SESSION_STATUSES /
RECONNECTING_RETRY_WINDOW_SEC 经 ``_svc.`` 延迟解析。
"""

from __future__ import annotations

import secrets
import uuid
from datetime import UTC, datetime

from sqlalchemy import select
from sqlmodel import col

import app.modules.daemon.session.service as _svc
from app.modules.agent.model import AgentRun, AgentSession
from app.modules.agent.provider_caps import get_provider_caps
from app.modules.daemon.control_commands import (
    KIND_SESSION_END,
    KIND_SESSION_RESUME,
    ControlCommandService,
)
from app.modules.daemon.model import DaemonTaskLease
from app.modules.daemon.schema import SessionReopenResponse

from .errors import (
    DaemonOffline,
    DaemonSessionInvariantViolation,
    DaemonSessionNoAgentSession,
    DaemonSessionNoCwd,
    DaemonSessionNotActive,
    DaemonSessionNotFound,
    DaemonSessionResumeUnsupported,
    DaemonSessionTitleInvalid,
)
from .helpers import _resolve_daemon_id_for_runtime


async def reopen_session(
    svc,
    session_id: uuid.UUID,
    user_id: uuid.UUID,
) -> SessionReopenResponse:
    """Reopen an ended Claude/Codex session for resume (task-05+07 / FR-06).

    Validation (task-05) + full transition (task-07): new interactive lease,
    ``claim_token`` rotation, SESSION_RESUME WS. The daemon-side SDK resume
    is task-08. This method:

      1. SELECT AgentSession FOR UPDATE + ownership (user_id mismatch → 404,
         no existence leak — mirrors :meth:`end_session`).
      2. Pre-flight checks IN ORDER (first failure wins, see task-05 §边界):
         - provider not in {claude, codex} → :class:`DaemonSessionResumeUnsupported`
         - agent_session_id is None → 先尝试从该会话历史 run 的
           ``AgentRun.session_id`` 恢复 resume key（ql-20260821-001 存量自愈，
           :meth:`_heal_agent_session_id_from_runs`）；恢复不到（D-004:
           create-time handshake 从未产出 SDK session id）才抛
           :class:`DaemonSessionNoAgentSession`
         - cwd empty → :class:`DaemonSessionNoCwd` (DS-7: scan/bootstrap
           sessions have no cwd; SDK resume needs it to locate the
           transcript — reject up front, session NOT mutated)
         - status in _svc.ACTIVE_SESSION_STATUSES → :class:`DaemonSessionNotActive`
           (caller should use inject, not reopen), EXCEPT (DS-5): status
           == "reconnecting" with ``last_active_at`` older than
           :data:`RECONNECTING_RETRY_WINDOW_SEC` (F2: last_active_at is the
           single timeout basis — both reopen and daemon-restart recover
           write it on flipping to reconnecting; never ``lease.created_at``,
           which recover-path long sessions would always exceed) → the
           suspended recovery is deemed dead and a second reopen is
           allowed (the pending lease is converged to ``cancelled``,
           DS-6 value: interactive leases have NULL ``lease_expires_at``
           so ``expired`` never applies)
         - target runtime offline → :class:`DaemonOffline`
      3. task-07 transition: create a NEW interactive lease (on the
         ended/failed path the original ``completed`` lease is preserved
         untouched, design §6.2; on the DS-5 stale-reconnecting path the
         old suspended lease was just converged to ``cancelled``) with a
         fresh ``claim_token``, point ``session.lease_id`` at it, flip
         ``status="reconnecting"``, commit, then emit a best-effort
         ``daemon:session_resume`` WS (``agent_session_id`` is the SDK resume
         key and is preserved verbatim). The method signature + return shape
         are final.

    ``FOR UPDATE`` serializes concurrent reopen on the same row; a second
    reopen landing after the first commits is caught by the status check
    (now ``reconnecting`` ∈ _svc.ACTIVE_SESSION_STATUSES → NOT_ACTIVE, unless
    the retry window has already elapsed — DS-5).
    """
    session = await svc._get_owned_session_for_update(session_id, user_id)

    # 归档区禁写（2026-08-30 审计R8）：reopen 建 lease + SESSION_RESUME 会让
    # daemon 恢复在归档工作区执行——与 inject/interrupt/plan-response 同拦
    # （409），不在归档区复活会话句柄。
    await svc._ensure_session_workspace_writable(session)

    # DS-5：窗口判断需要统一时间基准，now 前移到前置校验之前；后续新建
    # lease / 状态翻转复用同一 now，避免双取漂移。
    now = datetime.now(UTC)

    # Pre-flight checks (order is load-bearing — see task-05 §边界处理).
    # provider-abstraction task-11：引擎门控收敛查 ProviderCaps（resume 键；
    # 英文文案逐字保留，与原 not in {"claude", "codex"} 判定等价——未知
    # provider 查表得全 False 同样拒绝）。
    if not get_provider_caps(session.provider)["resume"]:
        raise DaemonSessionResumeUnsupported(
            f"Session '{session_id}' provider '{session.provider}' does not "
            f"support resume (only claude/codex).",
            details={
                "session_id": str(session_id),
                "provider": session.provider,
            },
        )
    if not session.agent_session_id:
        # ql-20260821-001：存量会话自愈——SDK session id 在历史版本只写 run 级
        # 列 AgentRun.session_id，session 级列恒 NULL（详见 run_sync
        # submit_messages 的回填注释）。reopen 前从该会话最新 run 恢复 resume
        # key 并持久化（同事务，随下方 reopen 转换一起 commit）；无任何 run
        # 记录过 session id（create 阶段握手都没成功过，D-004）才真正拒绝。
        healed_id = await svc._heal_agent_session_id_from_runs(session)
        if healed_id is None:
            raise DaemonSessionNoAgentSession(
                f"会话 '{session_id}' 缺少可供恢复的 SDK 会话标识"
                "（该会话从未成功建立过 SDK 会话，无法重新打开）。",
                details={"session_id": str(session_id)},
            )
        _svc.log.info(
            "session_sdk_id_healed_from_runs",
            session_id=str(session_id),
            agent_session_id=healed_id,
        )
    if not session.cwd:
        # DS-7：scan/bootstrap 会话不写 cwd，空 cwd 的 SDK resume 必然失败
        # （claude transcript 按 projects/<encoded-cwd>/ 定位），提前拒绝。
        raise DaemonSessionNoCwd(
            "该会话无关联工作目录，无法恢复对话记录",
            details={"session_id": str(session_id)},
        )
    if session.status in _svc.ACTIVE_SESSION_STATUSES:
        # DS-5：仅 reconnecting 超窗是 _svc.ACTIVE_SESSION_STATUSES 例外（手动
        # 重试兜底）；窗口内 / last_active_at 为 NULL（保守）/ pending /
        # active 维持 409。基准锁 last_active_at（F2）。
        last_active = session.last_active_at
        if last_active is not None and last_active.tzinfo is None:
            # SQLite（测试）读回 naive datetime，按 UTC 补 tz（先例
            # lease_service.py term_at 处理）。
            last_active = last_active.replace(tzinfo=UTC)
        stale_reconnecting = (
            session.status == "reconnecting"
            and last_active is not None
            and (now - last_active).total_seconds() > _svc.RECONNECTING_RETRY_WINDOW_SEC
        )
        if not stale_reconnecting:
            raise DaemonSessionNotActive(
                f"Session '{session_id}' is still {session.status}; use inject instead of reopen.",
                details={
                    "session_id": str(session_id),
                    "status": session.status,
                },
            )
        # 旧挂起 lease 收敛 cancelled（DS-6 取值：expired 仅适用
        # lease_expires_at 非 NULL 的租约，interactive 恒 NULL；cancelled
        # 与"恢复放弃"语义一致），随下方 reopen 事务一起提交。ended/failed
        # 路径旧 lease 已是终态（completed），不进本分支。
        if session.lease_id is not None:
            stale_lease = await svc._session.get(DaemonTaskLease, session.lease_id)
            if stale_lease is not None and stale_lease.status not in (
                "completed",
                "cancelled",
                "expired",
            ):
                stale_lease.status = "cancelled"
                stale_lease.updated_at = now
                svc._session.add(stale_lease)
    # Runtime must be connected so the daemon can run the SDK resume.
    # P2（2026-08-25 会话审查）：runtime_id 为 None 是会话级不变量违规
    # （create/reopen 均写 runtime_id；NULL 意味着数据损坏）——原实现被
    # ``if runtime_id is not None`` 短路静默跳过在线检查、下方 assert 兜底
    # （python -O 下会被剥除），改为显式 raise 不变量违规错误。
    runtime_id = session.runtime_id
    if runtime_id is None:
        raise DaemonSessionInvariantViolation(
            f"Session '{session_id}' has no runtime binding; cannot reopen.",
            details={"session_id": str(session_id), "runtime_id": None},
        )
    from app.modules.daemon.ws_hub import get_daemon_ws_hub

    hub = get_daemon_ws_hub()
    # task-06: WS Hub routes by daemon_instance_id; resolve from runtime.
    target_daemon_id = await _resolve_daemon_id_for_runtime(svc._session, runtime_id)
    if target_daemon_id is None or not hub.is_connected(target_daemon_id):
        raise DaemonOffline(
            "执行代理当前不在线，无法恢复会话。请先启动 daemon 再重新打开。",
            details={
                "session_id": str(session_id),
                "runtime_id": str(runtime_id),
            },
        )

    # ── task-07: full reopen transition (design §6.1/§6.2/§6.4/§14) ───────
    # Do NOT revive the original (completed) lease — design §6.2: the ended
    # lease stays ``completed`` for audit; a brand-new interactive lease is
    # created with a fresh ``claim_token`` so a stale pre-reopen claim can
    # never be replayed against the resumed session (matches
    # recover_session_after_daemon_restart token rotation, task-10 §7).
    # ``now`` was hoisted above the pre-flight checks (DS-5) and is shared
    # by the window check + lease transition below.
    # 上方不变量检查已保证 runtime_id 非 None（持有行锁，中途无人改写），
    # 直接复用，不再用 ``python -O`` 下会被剥除的 assert 兜底。
    target_runtime_id = runtime_id

    new_token = secrets.token_hex(32)
    new_lease = DaemonTaskLease(
        runtime_id=target_runtime_id,
        agent_run_id=None,
        kind="interactive",
        status="pending",
        lease_expires_at=None,  # NULL → expire_leases skips (D-005@v1)
        attempt_number=1,
        metadata_={
            "session_id": str(session.id),
            "agent_session_id": session.agent_session_id,
            "provider": session.provider,
            "claim_token": new_token,
            "reopened_from_status": session.status,
            # ql-20260827-014：会话级供应商标记随新 lease 重建（与 create 路径
            # :1383 同款）。reopen 漏写会让 claim/恢复链路解析不到会话供应商
            # ——生产实证：reopen 后 lease 全缺此键，SDK 无凭证秒退、会话回
            # ended（每次重开约 2s 死亡循环）。
            **(
                {"session_llm_provider_id": str(session.llm_provider_id)}
                if session.llm_provider_id is not None
                else {}
            ),
        },
    )
    svc._session.add(new_lease)
    await svc._session.flush()  # populate new_lease.id before FK bind

    # Switch session onto the new lease. agent_session_id stays — it is the
    # SDK resume key and must never change. runtime_id is only updated if the
    # caller targets a different daemon (none today; reopen always reuses
    # session.runtime_id, but the branch is kept symmetric with create).
    session.lease_id = new_lease.id
    session.runtime_id = target_runtime_id
    session.status = "reconnecting"
    session.last_active_at = now
    svc._session.add(session)
    await svc._session.commit()
    await svc._session.refresh(session)
    await svc._session.refresh(new_lease)

    # task-02：status→reconnecting 已随上方 commit 落库，发布列表变更信号
    # （下方 SESSION_RESUME WS best-effort 失败不回滚本地状态，信号语义
    # 不受 WS 结果影响）。
    await _svc.publish_sessions_changed("status_changed", session.id, session.user_id)

    # ql-20260827-014：reopen 的 SESSION_RESUME 必须携带会话级供应商凭证。
    # daemon 侧 reopen 恢复（区别于 daemon 重启 recover——那条路走本机
    # sessions.json 快照里的 providerConfig）此前既拿不到 lease metadata 键、
    # WS payload 也不带凭证，恢复出的 SDK 子进程无任何凭证（隔离
    # CLAUDE_CONFIG_DIR 下无本机 OAuth 兜底）→ 首轮 "Not logged in · Please
    # run /login" 退出 → daemon 上报 end → 会话秒回 ended。解析复用
    # resolve_bound_provider_config（与 claim payload 同一真相源，D-006）；
    # 抛异常 / 返回 None（供应商已删 / 属主不符等）降级缺键 + warning 不阻断
    # reopen（对齐 claim 链路 _inject_provider_config 的降级语义，
    # context.py:297-303），daemon 走本机凭证链（零回归）。
    resume_provider_config: dict | None = None
    if session.llm_provider_id is not None:
        from app.modules.daemon.lease.context import resolve_bound_provider_config

        try:
            resume_provider_config = await resolve_bound_provider_config(
                svc._session,
                {"llm_provider_id": str(session.llm_provider_id)},
                session.user_id,
                session.provider,
            )
        except Exception:
            _svc.log.warning(
                "session_resume_provider_resolve_failed",
                session_id=str(session.id),
                llm_provider_id=str(session.llm_provider_id),
            )
            resume_provider_config = None

    # ── best-effort daemon:session_resume WS (design §6.4) ────────────────
    # WS failure does NOT roll back the local reconnecting state — the daemon
    # will converge on its own (pull/next-poll or recover-on-restart). The
    # frontend surfaces reconnecting immediately. cwd is forwarded so the
    # SDK resume runs in the original working directory (R-cwd).
    # task-04（design A2）：SESSION_RESUME 走控制指令三段式——reopen 租约的
    # WS 单次投递丢失即永挂缺陷由「落库 pending + 重连补拉」弥补（design A2
    # 末条）；失败不回滚 reconnecting 本地状态的既有语义保持。
    resume_payload = {
        "session_id": str(session.id),
        "lease_id": str(new_lease.id),
        "agent_session_id": session.agent_session_id,
        "cwd": session.cwd,
        "provider": session.provider,
        "runtime_id": str(target_runtime_id),
    }
    if resume_provider_config is not None:
        # R-02：明文 api_key 仅进 WS payload（服务端→daemon 下发通道），不入
        # 日志/ORM；daemon 侧同样不落日志（record.providerConfig 快照语义）。
        resume_payload["provider_config"] = resume_provider_config
    try:
        # task-06: resolve provider runtime_id → daemon_instance_id (WS key).
        resume_daemon_id = await _resolve_daemon_id_for_runtime(svc._session, target_runtime_id)
        resume_ok = False
        if resume_daemon_id is not None:
            _row, resume_ok = await ControlCommandService(svc._session).enqueue_and_push(
                daemon_id=resume_daemon_id,
                runtime_id=target_runtime_id,
                kind=KIND_SESSION_RESUME,
                payload=resume_payload,
            )
        if not resume_ok:
            _svc.log.warning(
                "session_resume_control_not_delivered",
                session_id=str(session.id),
                runtime_id=str(target_runtime_id),
                lease_id=str(new_lease.id),
            )
    except Exception:
        # best-effort: any WS error stays a warning, local reconnecting holds.
        _svc.log.warning(
            "session_resume_control_send_failed",
            session_id=str(session.id),
            runtime_id=str(target_runtime_id),
            lease_id=str(new_lease.id),
            exc_info=True,
        )

    return SessionReopenResponse(
        session_id=str(session.id),
        status="reconnecting",
    )


async def delete_agent_session(
    svc,
    session_id: uuid.UUID,
    user_id: uuid.UUID,
) -> None:
    """Soft-delete an owned session while retaining its row + run history.

    2026-07-11-unify-runtime-session-dialog / FR-06 / D-003: 改为软删除。
    active/pending/reconnecting 会话仍先做 best-effort end reconciliation
    （WS SESSION_END + currentRun killed + lease completed，镜像
    :meth:`end_session`），daemon 离线时该步失败仅 warning 不阻断；随后
    ``UPDATE agent_sessions SET deleted_at=now()`` 标记软删。行保留供审计，
    ``agent_runs.agent_session_id`` 外键**刻意不断**（run/log 历史仍可查），
    list/get 端点通过 ``deleted_at IS NULL`` 过滤隐藏软删会话。ended/failed
    会话直接 UPDATE 软删（不做 end reconciliation）。
    """
    agent_session = (
        await svc._session.execute(
            select(AgentSession)
            .where(
                AgentSession.id == session_id,
                AgentSession.user_id == user_id,
            )
            .with_for_update()
        )
    ).scalar_one_or_none()
    if agent_session is None:
        raise DaemonSessionNotFound(
            f"AgentSession '{session_id}' not found.",
            details={"session_id": str(session_id)},
        )

    if agent_session.status in _svc.ACTIVE_SESSION_STATUSES:
        # Best-effort end reconciliation. Failures here MUST NOT bubble up:
        # the caller asked to delete, so we still force the hard delete below
        # (daemon offline is handled by its own idle-timeout on its side).
        try:
            await svc._end_session_for_delete(agent_session)
        except Exception:
            _svc.log.warning(
                "session_delete_end_reconciliation_failed",
                session_id=str(session_id),
                status=agent_session.status,
                exc_info=True,
            )

    # 2026-07-11-unify-runtime-session-dialog / D-003 / C-7: 软删除——UPDATE
    # deleted_at（行保留供审计；刻意不断 agent_runs.agent_session_id 外键，
    # run/log 历史仍可查；list/get 端点过滤 deleted_at IS NULL 隐藏）。
    # 取代原硬删：删除了 update(AgentRun).set(agent_session_id=None) +
    # session.delete(agent_session) 两步（C-7 / R-4）。
    agent_session.deleted_at = datetime.now(UTC)
    await svc._session.commit()

    # task-02：软删已落库，发布列表删除信号（前端 invalidate 重拉后该行
    # 被 deleted_at IS NULL 过滤，从列表消失）。
    await _svc.publish_sessions_changed("deleted", agent_session.id, agent_session.user_id)


async def _end_session_for_delete(svc, session: AgentSession) -> None:
    """Internal end reconciliation used by delete_agent_session.

    task-03 / D-003@v1: mirrors the core of :meth:`end_session` (run
    killed + lease completed + WS) but never raises on WS failure and never
    touches ``session.status`` beyond the converged ``ended`` — the caller
    (delete) hard-deletes the row right after, so the session status is
    effectively throwaway; only the run/lease convergence matters for audit.
    Holds the same session row lock the caller already acquired.

    P1 修复（2026-08-25 会话审查）：本地收口（run killed + lease completed）
    先在本事务内 commit 释放行锁，SESSION_END WS 发送移到 commit 之后
    best-effort——与 :meth:`end_session` / interrupt_session 同款「先 commit、
    再发 WS」模式，锁内不等 ws_hub 最长 10s 的发送。
    """
    now = datetime.now(UTC)
    # Kill the current non-terminal run if any (single-transaction convergence).
    # P2：WHERE 直接过滤 _svc.ACTIVE_TURN_STATUSES（pending/running/pending_approval），
    # 不再全量加载该会话所有 run——循环只为找非终态 run，历史 run 无需入内存。
    runs = (
        (
            await svc._session.execute(
                select(AgentRun)
                .where(AgentRun.agent_session_id == session.id)
                .where(col(AgentRun.status).in_(list(_svc.ACTIVE_TURN_STATUSES)))
            )
        )
        .scalars()
        .all()
    )
    for run in runs:
        run.status = "killed"
        run.finished_at = now
        run.exit_code = -1
        svc._session.add(run)

    # Complete the bound interactive lease (if any).
    if session.lease_id is not None:
        lease = await svc._session.get(DaemonTaskLease, session.lease_id)
        if lease is not None and lease.status not in (
            "completed",
            "cancelled",
            "expired",
        ):
            lease.status = "completed"
            lease.updated_at = now
            svc._session.add(lease)

    # commit 释放调用方持有的会话行锁（原仅 flush 等 caller 一并提交），
    # WS 发送挪到锁外。
    await svc._session.commit()

    # Best-effort SESSION_END (kill currentRun + clear SessionStore on daemon).
    # task-04（design A2）：走控制指令三段式——WS 失败落库 pending 待补拉
    # （软删会话后 daemon 重连补拉仍能收到 end 清理本地 SessionStore）。
    if session.runtime_id is not None:
        try:
            # task-06: resolve provider runtime_id → daemon_instance_id.
            daemon_id = await _resolve_daemon_id_for_runtime(svc._session, session.runtime_id)
            end_ok = False
            if daemon_id is not None:
                _row, end_ok = await ControlCommandService(svc._session).enqueue_and_push(
                    daemon_id=daemon_id,
                    runtime_id=session.runtime_id,
                    kind=KIND_SESSION_END,
                    payload={
                        "session_id": str(session.id),
                        "lease_id": str(session.lease_id) if session.lease_id else "",
                        "runtime_id": str(session.runtime_id),
                    },
                )
            if not end_ok:
                _svc.log.warning(
                    "session_delete_end_control_send_failed",
                    session_id=str(session.id),
                    runtime_id=str(session.runtime_id),
                )
        except Exception:
            _svc.log.warning(
                "session_delete_end_control_send_failed",
                session_id=str(session.id),
                runtime_id=str(session.runtime_id),
                exc_info=True,
            )


async def archive_session(
    svc,
    session_id: uuid.UUID,
    user_id: uuid.UUID,
) -> None:
    """Archive an owned session (hide from default list view).

    2026-08-24 会话归档功能：设置 ``archived_at`` 时间戳。所有状态均可归档
    （活跃会话归档后从默认列表隐藏，筛选「已归档会话」可查看）。
    幂等：已归档会话重复调用无操作。archived_at 与 deleted_at 正交——
    可归档后删除，也可直接删除。
    """
    agent_session = (
        await svc._session.execute(
            select(AgentSession)
            .where(
                AgentSession.id == session_id,
                AgentSession.user_id == user_id,
            )
            .with_for_update()
        )
    ).scalar_one_or_none()
    if agent_session is None:
        raise DaemonSessionNotFound(
            f"AgentSession '{session_id}' not found.",
            details={"session_id": str(session_id)},
        )
    if agent_session.archived_at is not None:
        await svc._session.rollback()  # 释放 FOR UPDATE 行锁（幂等早退不悬挂事务）
        return  # 幂等：已归档
    agent_session.archived_at = datetime.now(UTC)
    await svc._session.commit()
    # task-02：归档已落库（列表按 archived_at IS NULL 过滤），发布列表变更
    # 信号——否则已打开 SSE 的其它客户端看不到该行从默认列表消失。
    await _svc.publish_sessions_changed("status_changed", agent_session.id, agent_session.user_id)


async def unarchive_session(
    svc,
    session_id: uuid.UUID,
    user_id: uuid.UUID,
) -> None:
    """Unarchive an owned session (restore to default list view).

    2026-08-24 会话归档功能：清除 ``archived_at`` 时间戳。
    幂等：未归档会话重复调用无操作。
    """
    agent_session = (
        await svc._session.execute(
            select(AgentSession)
            .where(
                AgentSession.id == session_id,
                AgentSession.user_id == user_id,
            )
            .with_for_update()
        )
    ).scalar_one_or_none()
    if agent_session is None:
        raise DaemonSessionNotFound(
            f"AgentSession '{session_id}' not found.",
            details={"session_id": str(session_id)},
        )
    if agent_session.archived_at is None:
        await svc._session.rollback()  # 释放 FOR UPDATE 行锁（幂等早退不悬挂事务）
        return  # 幂等：未归档
    agent_session.archived_at = None
    await svc._session.commit()
    # task-02：取消归档已落库（行回到默认列表视图），发布列表变更信号——
    # 与 archive_session 对称，SSE 客户端秒级看到该行重新出现。
    await _svc.publish_sessions_changed("status_changed", agent_session.id, agent_session.user_id)


# ── task-02（2026-09-07-session-pin-rename-scheduled-send）：置顶/取消置顶/
# 重命名三操作——照 archive_session/unarchive_session 模板（行锁归属 404 不
# 泄露、幂等早退 rollback 释放行锁、commit 后 publish_sessions_changed 广播
# status_changed，FR-06 SSE 多端秒级同步）。
# D-010 第二回合移植注：main 原定义于单文件 SessionService（unarchive 与
# update_ctx_window 之间）；拆分包形态落本子模块，publish 经 _svc 延迟解析。


async def pin_session(
    svc,
    session_id: uuid.UUID,
    user_id: uuid.UUID,
) -> None:
    """Pin an owned session (task-02 / FR-01：置顶，分组内置顶语义由列表
    pinned 优先排序 + 前端分组桶保序插入天然实现，D-002@v1)。

    写 ``pinned_at = now(UTC)``。幂等：已置顶早退（rollback 释放 FOR UPDATE
    行锁），不刷新时间戳（FR-02）。
    """
    agent_session = (
        await svc._session.execute(
            select(AgentSession)
            .where(
                AgentSession.id == session_id,
                AgentSession.user_id == user_id,
            )
            .with_for_update()
        )
    ).scalar_one_or_none()
    if agent_session is None:
        raise DaemonSessionNotFound(
            f"AgentSession '{session_id}' not found.",
            details={"session_id": str(session_id)},
        )
    if agent_session.pinned_at is not None:
        await svc._session.rollback()  # 释放 FOR UPDATE 行锁（幂等早退不悬挂事务）
        return  # 幂等：已置顶，不刷新时间戳
    agent_session.pinned_at = datetime.now(UTC)
    await svc._session.commit()
    # 置顶已落库（列表序变化），发布列表变更信号——SSE 客户端秒级重排。
    await _svc.publish_sessions_changed("status_changed", agent_session.id, agent_session.user_id)


async def unpin_session(
    svc,
    session_id: uuid.UUID,
    user_id: uuid.UUID,
) -> None:
    """Unpin an owned session (task-02 / FR-02：取消置顶，回到既有最近活跃序).

    清 ``pinned_at``。幂等：未置顶早退（rollback 释放行锁）。
    """
    agent_session = (
        await svc._session.execute(
            select(AgentSession)
            .where(
                AgentSession.id == session_id,
                AgentSession.user_id == user_id,
            )
            .with_for_update()
        )
    ).scalar_one_or_none()
    if agent_session is None:
        raise DaemonSessionNotFound(
            f"AgentSession '{session_id}' not found.",
            details={"session_id": str(session_id)},
        )
    if agent_session.pinned_at is None:
        await svc._session.rollback()  # 释放 FOR UPDATE 行锁（幂等早退不悬挂事务）
        return  # 幂等：未置顶
    agent_session.pinned_at = None
    await svc._session.commit()
    # 取消置顶已落库（行回到最近活跃序），发布列表变更信号——与 pin 对称。
    await _svc.publish_sessions_changed("status_changed", agent_session.id, agent_session.user_id)


async def rename_session(
    svc,
    session_id: uuid.UUID,
    user_id: uuid.UUID,
    title: str,
) -> None:
    """Rename an owned session (task-02 / FR-03：写持久 ``title`` 列).

    title 先 strip 再校验非空且 ≤255 字符（对齐列 String(255)），非法抛
    :class:`DaemonSessionTitleInvalid`（422 语义，不落库）。列表标题派生
    （router 层 title 优先、回退首条 user_input 摘要）零改动——重命名天然
    优先生效。
    """
    stripped = title.strip()
    if not stripped or len(stripped) > 255:
        raise DaemonSessionTitleInvalid(
            "会话标题不能为空且不超过 255 个字符。",
            details={"session_id": str(session_id), "title_length": len(stripped)},
        )
    agent_session = (
        await svc._session.execute(
            select(AgentSession)
            .where(
                AgentSession.id == session_id,
                AgentSession.user_id == user_id,
            )
            .with_for_update()
        )
    ).scalar_one_or_none()
    if agent_session is None:
        raise DaemonSessionNotFound(
            f"AgentSession '{session_id}' not found.",
            details={"session_id": str(session_id)},
        )
    if agent_session.title == stripped:
        await svc._session.rollback()  # 释放 FOR UPDATE 行锁（幂等早退不悬挂事务）
        return  # 幂等：标题未变，免事务免广播
    agent_session.title = stripped
    await svc._session.commit()
    # 标题已落库（列表行显示变化），发布列表变更信号——SSE 客户端秒级刷新。
    await _svc.publish_sessions_changed("status_changed", agent_session.id, agent_session.user_id)


async def update_ctx_window(
    svc,
    session_id: uuid.UUID,
    user_id: uuid.UUID,
    ctx_window_tokens: int | None,
) -> None:
    """Set/clear the session-level context window override (ql-20260831-002).

    纯展示配置（前端上下文环分母），不进 daemon 注入链、不发列表变更信号
    （列表视图不消费该列）。幂等：同值重复写无副作用。None = 清除覆盖。
    """
    agent_session = (
        await svc._session.execute(
            select(AgentSession)
            .where(
                AgentSession.id == session_id,
                AgentSession.user_id == user_id,
            )
            .with_for_update()
        )
    ).scalar_one_or_none()
    if agent_session is None:
        raise DaemonSessionNotFound(
            f"AgentSession '{session_id}' not found.",
            details={"session_id": str(session_id)},
        )
    if agent_session.ctx_window_tokens == ctx_window_tokens:
        await svc._session.rollback()  # 释放 FOR UPDATE 行锁（幂等早退不悬挂事务）
        return
    agent_session.ctx_window_tokens = ctx_window_tokens
    await svc._session.commit()
