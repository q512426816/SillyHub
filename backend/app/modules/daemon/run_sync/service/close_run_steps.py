"""close_interactive_run 拆分步函数（task-10 拆分）+ 鉴权瞬时失败自动重投。

603 行单方法拆分：_close_verify_and_load（lease 验证 + FOR UPDATE 行锁读 +
绑定校验）→ _close_apply_terminal（终态映射 + model_usage 明细 + result_
summary）→ _close_flip_session（session 终态翻转，返回双意图）→ commit →
_close_post_commit（自动重投 / SESSION_END / 列表信号 / borrow 钩子 / gate
enqueue / 双频道终态事件）→ group_bridge._close_group_hooks（群收口簇）→
_close_finish（收口日志 + 排队派发）。maybe_auto_recover_failed_turn（2026-09-12 三分支自动恢复，ql-20260903-011 auth 类并入）
由 close_run_steps 调用 auto_resume.py 实现。

D-007：get_redis 经 ``_rsvc.`` 延迟解析（43 处 patch 目标）；log 经
``_rsvc.log`` 保持原模块 logger 身份。对 session.service 私有符号
_apply_session_terminal_status / _send_session_end_best_effort 与
TERMINAL_TURN_STATUSES 的既有顶部导入语句原样落在本子模块（语义零变化）。
"""

from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime

from sqlalchemy import delete, select

import app.modules.daemon.run_sync.service as _rsvc
from app.modules.agent.model import (
    AgentRun,
    AgentRunModelUsage,
    AgentSession,
)
from app.modules.daemon.lease.service import DaemonAgentRunNotFound
from app.modules.daemon.model_error import ModelErrorDTO
from app.modules.daemon.schema import ModelUsageItemRead
from app.modules.daemon.session.service import (
    TERMINAL_TURN_STATUSES,
    _apply_session_terminal_status,
    _send_session_end_best_effort,
)
from app.modules.git_gateway.service import redact_output

from .group_bridge import _close_group_hooks


async def close_interactive_run(
    svc,
    *,
    lease_id: uuid.UUID,
    run_id: uuid.UUID,
    claim_token: str,
    status: str,
    is_error: bool,
    subtype: str | None = None,
    result_summary: str | None = None,
    total_cost_usd: float | None = None,
    num_turns: int | None = None,
    duration_ms: int | None = None,
    duration_api_ms: int | None = None,
    input_tokens: int | None = None,
    output_tokens: int | None = None,
    cache_read_tokens: int | None = None,
    cache_creation_tokens: int | None = None,
    model_usage: list[ModelUsageItemRead] | None = None,
    api_requests: int | None = None,
    error: ModelErrorDTO | None = None,
) -> AgentRun:
    """close_interactive_run 分步编排（task-10 拆分；公共签名与 docstring 见

    RunSyncService 壳）。各步骤方法体自原模块逐字节搬移。
    """
    lease_meta, agent_run = await _close_verify_and_load(
        svc, lease_id=lease_id, run_id=run_id, claim_token=claim_token
    )
    # Idempotent: already terminal → no-op return (daemon retry safety).
    if agent_run.status in TERMINAL_TURN_STATUSES:
        _rsvc.log.info(
            "interactive_run_close_already_terminal",
            lease_id=str(lease_id),
            agent_run_id=str(agent_run.id),
            status=agent_run.status,
        )
        # 已持 FOR UPDATE 行锁：rollback 释放（无写入可回滚），refresh 重取
        # 属性供响应序列化读取（rollback 会过期 ORM 实例属性）。
        await svc._session.rollback()
        await svc._session.refresh(agent_run)
        return agent_run
    now = datetime.now(UTC)
    await _close_apply_terminal(
        svc,
        agent_run,
        now,
        status=status,
        is_error=is_error,
        error=error,
        total_cost_usd=total_cost_usd,
        num_turns=num_turns,
        duration_ms=duration_ms,
        duration_api_ms=duration_api_ms,
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        cache_read_tokens=cache_read_tokens,
        cache_creation_tokens=cache_creation_tokens,
        model_usage=model_usage,
        result_summary=result_summary,
    )
    session_end_intent, sessions_changed_intent = await _close_flip_session(svc, agent_run, now)
    await svc._session.commit()
    await svc._session.refresh(agent_run)
    await _close_post_commit(
        svc,
        agent_run,
        lease_meta=lease_meta,
        now=now,
        lease_id=lease_id,
        subtype=subtype,
        error=error,
        session_end_intent=session_end_intent,
        sessions_changed_intent=sessions_changed_intent,
    )
    await _close_group_hooks(svc, agent_run, lease_id=lease_id, now=now)
    return await _close_finish(
        svc,
        agent_run,
        lease_id=lease_id,
        status=status,
        is_error=is_error,
        subtype=subtype,
        api_requests=api_requests,
    )


async def _close_verify_and_load(
    svc, *, lease_id: uuid.UUID, run_id: uuid.UUID, claim_token: str
) -> tuple[dict, AgentRun]:
    """lease 验证 + FOR UPDATE 行锁读 run + session 绑定校验（task-10 搬移）。"""
    lease = await svc._facade._get_lease_and_verify_token(lease_id, claim_token)
    lease_meta = lease.metadata_ or {}
    bound_session_id_raw = lease_meta.get("session_id")

    # P1 修复（2026-08-25 会话审查）：FOR UPDATE 行锁读 run——终态判定
    # （下方 TERMINAL 守卫）与终态写入（completed/failed）原子化。原
    # ``svc._session.get`` 无锁，并发 end_session 先 commit killed 后，本处
    # 基于未加锁的旧快照（running）过守卫并把 killed 覆写成 completed。
    agent_run = (
        await svc._session.execute(select(AgentRun).where(AgentRun.id == run_id).with_for_update())
    ).scalar_one_or_none()
    if agent_run is None:
        raise DaemonAgentRunNotFound(
            f"AgentRun '{run_id}' not found for lease '{lease_id}'.",
            details={
                "lease_id": str(lease_id),
                "agent_run_id": str(run_id),
            },
        )

    # Bind check: the run must belong to the lease's session. interactive
    # lease.agent_run_id is NULL (D-005@v1), so session_id is the link.
    # Missing bound session_id in metadata is treated as invariant failure.
    if (
        bound_session_id_raw is None
        or agent_run.agent_session_id is None
        or str(agent_run.agent_session_id) != str(bound_session_id_raw)
    ):
        raise DaemonAgentRunNotFound(
            f"AgentRun '{run_id}' is not bound to lease '{lease_id}' session.",
            details={
                "lease_id": str(lease_id),
                "agent_run_id": str(run_id),
                "lease_session_id": bound_session_id_raw,
                "run_session_id": (
                    str(agent_run.agent_session_id) if agent_run.agent_session_id else None
                ),
            },
        )
    return lease_meta, agent_run


async def _close_apply_terminal(
    svc,
    agent_run: AgentRun,
    now: datetime,
    *,
    status: str,
    is_error: bool,
    error: ModelErrorDTO | None,
    total_cost_usd: float | None,
    num_turns: int | None,
    duration_ms: int | None,
    duration_api_ms: int | None,
    input_tokens: int | None,
    output_tokens: int | None,
    cache_read_tokens: int | None,
    cache_creation_tokens: int | None,
    model_usage: list[ModelUsageItemRead] | None,
    result_summary: str | None,
) -> None:
    """终态字段映射：status 映射 + error_detail + stage 回写 + gate_status

    + usage/cost/duration 透传 + model_usage 明细 upsert + summary 脱敏
    （task-10 搬移，方法体逐字节一致）。
    """
    # Map SDK result → AgentRun terminal status (design §4).
    if status == "success" and not is_error:
        agent_run.status = "completed"
        agent_run.exit_code = 0
    elif status == "error_during_execution" or is_error:
        agent_run.status = "failed"
        agent_run.exit_code = 1
        # error_during_execution = interrupted turn (spike D1 / SDK abort);
        # other errors are genuine failures. error_code keeps them distinct.
        agent_run.error_code = (
            "interactive_interrupted"
            if status == "error_during_execution"
            else "interactive_failed"
        )
    else:
        # Unknown status → conservative failed (never leave a half-state).
        agent_run.status = "failed"
        agent_run.exit_code = 1
        agent_run.error_code = "interactive_unknown_status"

    # task-06 / FR-02 / D-009：模型层错误详情写入 error_detail（JSON 列）。
    # 与 error_code（上面 status 映射设置的调度层/系统错误）正交，不互相覆盖：
    # 这里只持久化 ModelError，绝不动 error_code。daemon 契约（design §7.5）
    # error 总伴随 is_error=true → 上面已置 failed；此处补存错误详情供前端展示。
    # model_dump(mode='json') 把 StrEnum 等转成 JSON 原生类型，适配 JSON 列存储。
    if error is not None:
        agent_run.error_detail = error.model_dump(mode="json")

    # task-05（D-003@v1）修正：interactive run 走 close_interactive_run（非
    # complete_lease，因 interactive lease agent_run_id=NULL per D-005），stage
    # 回写在此接线。从 agent_run.status 推导 changes.stages.last_dispatch.status
    # （running→completed/failed），不读 sillyspec.db，独立路径。try/except 容错。
    if agent_run.change_id is not None:
        try:
            from app.modules.change.model import Change

            change = await svc._session.get(Change, agent_run.change_id)
            if change is not None:
                stages = dict(change.stages or {})
                last_dispatch = stages.get("last_dispatch")
                if isinstance(last_dispatch, dict) and last_dispatch:
                    stage_status = "completed" if agent_run.status == "completed" else "failed"
                    # dict() copy 避免 SQLAlchemy JSON in-place mutation 不持久化
                    # （对齐 lease/service.py:_sync_stage_status_from_run 的模式）。
                    # 原地改 last_dispatch["status"] 会令旧 change.stages 同步被改
                    # （浅拷贝共享嵌套引用），change.stages = stages 时新旧值相等
                    # → SQLAlchemy 不标记 dirty → 回写不入库（stage 永远卡 running）。
                    new_last_dispatch = dict(last_dispatch)
                    new_last_dispatch["status"] = stage_status
                    stages["last_dispatch"] = new_last_dispatch
                    change.stages = stages
                    svc._session.add(change)
                    _rsvc.log.info(
                        "stage_status_synced_from_run",
                        change_id=str(change.id),
                        run_id=str(agent_run.id),
                        status=stage_status,
                    )
                else:
                    _rsvc.log.warning(
                        "sync_stage_status_from_run_no_last_dispatch",
                        change_id=str(change.id),
                    )
        except Exception as exc:
            _rsvc.log.warning(
                "sync_stage_status_from_run_failed",
                run_id=str(agent_run.id),
                error=str(exc),
            )

    agent_run.finished_at = now
    # task-05 / M2（design §5.1 / §170）：仅 verify stage 的 completed run 设
    # gate_status='pending'（随终态同 commit，gate 任务读到一致快照）。change_id=None
    # 的对话 turn、failed run，以及 quick/brainstorm/plan/execute/archive 等非 verify
    # stage 不进 gate——这些 stage 无 verify gate 产物，强行 gate verify 必然解析
    # 失败 exit 2 误报失败（_gate_applicable 守门）。gate 决策由 task-07 后台任务
    # cas running→decided/failed 推进。
    if await svc._gate_applicable(agent_run):
        agent_run.gate_status = "pending"
    # SDKResultSuccess 透传：usage / cost / duration（None 不覆盖 AgentRun 原值，
    # daemon 老版本不传这些字段时保持兼容）。对应 AgentRun.{total_cost_usd,
    # num_turns,duration_ms,duration_api_ms,input_tokens,output_tokens}，
    # 这几个列在 model.py 已存在（interactive 路径原先没写，导致全 NULL）。
    if total_cost_usd is not None:
        agent_run.total_cost_usd = total_cost_usd
    if num_turns is not None:
        agent_run.num_turns = num_turns
    if duration_ms is not None:
        agent_run.duration_ms = duration_ms
    if duration_api_ms is not None:
        agent_run.duration_api_ms = duration_api_ms
    if input_tokens is not None:
        agent_run.input_tokens = input_tokens
    if output_tokens is not None:
        agent_run.output_tokens = output_tokens
    # task-07：prompt cache 词元终态透传（直接覆盖，无 max — 终态一次写入，
    # 对齐上面 input/output 直接覆盖模式）。
    if cache_read_tokens is not None:
        agent_run.cache_read_tokens = cache_read_tokens
    if cache_creation_tokens is not None:
        agent_run.cache_creation_tokens = cache_creation_tokens

    # ── task-03（2026-08-29-usage-by-provider-model / FR-01-3 / design §1.2 §4.1）：
    # model_usage 明细落库 + run.model / llm_provider_id 填充。api_requests 无
    # run 级列——run 总数已由 daemon 按 design §2 分摊进各行（各行求和 == run
    # 总数），backend 不重复分摊直接落行；run 级精确值仅入下方 close 日志观测。
    if model_usage:
        try:
            # run 列填充（design §1.2）：model 终态填 input+output 最大行的
            # model（该列确从未写入，终态无条件覆盖对齐 input/output 模式）；
            # llm_provider_id 仅空时填会话当前值——dispatch（session/service.py
            # :3359）已按轮写入生效供应商，终态无条件覆盖会把 dispatch 时点的
            # 准确值改成终态会话当前值（切供应商竞态错归因，R-08），非空不触碰。
            agent_run.model = max(
                model_usage,
                key=lambda item: item.input_tokens + item.output_tokens,
            ).model
            if agent_run.llm_provider_id is None:
                bound_session = await svc._session.get(AgentSession, agent_run.agent_session_id)
                if bound_session is not None:
                    agent_run.llm_provider_id = bound_session.llm_provider_id
            # 明细幂等 upsert：同 run 先 DELETE 后 INSERT 全部行（等价 upsert
            # by (run_id, model)，重放同 payload 不叠行）。savepoint 包裹——
            # 明细落库失败只回滚本块，不阻塞 close 主事务（design §4.1
            # best-effort，对齐 session/service.py:1491 落绑定范式）。
            async with svc._session.begin_nested():
                await svc._session.execute(
                    delete(AgentRunModelUsage).where(AgentRunModelUsage.run_id == agent_run.id)
                )
                for item in model_usage:
                    svc._session.add(
                        AgentRunModelUsage(
                            run_id=agent_run.id,
                            model=item.model,
                            input_tokens=item.input_tokens,
                            output_tokens=item.output_tokens,
                            cache_read_tokens=item.cache_read_tokens,
                            cache_creation_tokens=item.cache_creation_tokens,
                            api_requests=item.api_requests,
                        )
                    )
                await svc._session.flush()
        except Exception as exc:
            _rsvc.log.warning(
                "model_usage_persist_failed",
                run_id=str(agent_run.id),
                error=str(exc),
            )
    if result_summary:
        # Redact via git_gateway redact_output to avoid leaking secrets in
        # the stored summary (mirrors batch completeLease path).
        try:
            agent_run.output_redacted = redact_output(result_summary)
        except Exception:
            agent_run.output_redacted = result_summary[:50000]

    svc._session.add(agent_run)


async def _close_flip_session(
    svc, agent_run: AgentRun, now: datetime
) -> tuple[
    tuple[uuid.UUID, uuid.UUID | None, uuid.UUID | None] | None,
    tuple[uuid.UUID, uuid.UUID | None] | None,
]:
    """run 终态回写 session 终态（同事务），返回 (SESSION_END 意图,

    列表信号意图) 二元组（task-10 搬移；原 _session_end_intent /
    _sessions_changed_intent 局部变量经参数与返回值显式流转）。
    """
    # task-03 / D-001 / D-009：run 终态回写 session 终态（同事务）。
    # close_interactive_run 是 daemon 回灌 run 终态的唯一收口点，病灶 B：自然
    # 覆盖批量路径（dispatch_to_daemon 创建的 pending session）的 pending/active
    # session 必须在此收口，否则 session 永远停在 active（D-001）。
    # D-009：必须新建 query（禁止复用 :1039 _resolve_gate_workspace_id 的 session
    # query，它在 commit 之后调用，回写不进同一事务）；D-005 幂等由
    # _apply_session_terminal_status 守卫（已 ended/failed 返 None）。
    session_end_intent: tuple[uuid.UUID, uuid.UUID | None, uuid.UUID | None] | None = None
    # task-03（2026-08-24-sessions-live-updates）：run 终态翻 session ended/failed
    # 时记下列表信号意图（session_id + user_id），commit 后广播 status_changed——
    # 多轮对话仅刷 last_active_at 的分支不置此意图（列表视图无状态变化，不发）。
    # user_id 同样须在 expire_on_commit 前取标量。
    sessions_changed_intent: tuple[uuid.UUID, uuid.UUID | None] | None = None
    if agent_run.agent_session_id is not None:
        # AgentSession 走模块顶 import（与上方 task-03 model_usage 块共用）：
        # 此处若保留函数内局部 import，Python 会把 AgentSession 判为整个
        # 函数体的局部名，上方先于本行执行的引用直接 UnboundLocalError。
        session = await svc._session.get(AgentSession, agent_run.agent_session_id)
        if session is not None:
            new_status = _apply_session_terminal_status(agent_run, session)
            # task-06 / FR-06 / D-006@v1（Grill M1-R 终版）：闸拒绝失败收口
            # ——命中优先于多轮 keep-active。daemon 会话闸拒绝的分身子会话首
            # run 回传 failed 时，_apply_session_terminal_status 对 interactive
            # 多轮返 active 会让子会话永驻 active（占 daemon 会话额度 + mission
            # 卡死）；触发面三条件齐备（_is_gate_rejected_first_failure）则覆写
            # 为 failed（非 ended），复用下方既有翻转块（ended_at + SESSION_END
            # + publish 链）。幂等守卫不变：new_status=None（会话已 ended/
            # failed）时下方整体跳过，本规则不复活终态会话。
            if new_status == "active" and await svc._is_gate_rejected_first_failure(
                agent_run, session
            ):
                new_status = "failed"
            if new_status is not None:
                session.status = new_status
                if new_status in ("ended", "failed"):
                    session.ended_at = now
                    sessions_changed_intent = (session.id, session.user_id)
                    # ql-20260823-006：会话被 run 终态翻成 ended/failed 时记下
                    # 发送意图，commit 后补发 SESSION_END 清理 daemon 内存副本——
                    # 否则 daemon SessionStore 残留活条目（backend 终态 ≠ daemon
                    # 感知），后续 reopen 全撞 SESSION_ALREADY_EXISTS 死循环
                    # （2026-08-23 会话 bdec91a4 事故）。expire_on_commit 前取标量。
                    session_end_intent = (session.id, session.lease_id, session.runtime_id)
                else:
                    session.last_active_at = now
                svc._session.add(session)
    return session_end_intent, sessions_changed_intent


async def _close_post_commit(
    svc,
    agent_run: AgentRun,
    *,
    lease_meta: dict,
    now: datetime,
    lease_id: uuid.UUID,
    subtype: str | None,
    error: ModelErrorDTO | None,
    session_end_intent: tuple[uuid.UUID, uuid.UUID | None, uuid.UUID | None] | None,
    sessions_changed_intent: tuple[uuid.UUID, uuid.UUID | None] | None,
) -> None:
    """commit 后钩子串：自动重投 + SESSION_END + 列表信号 + borrow 钩子

    + gate enqueue + run/session 双频道终态事件（task-10 搬移）。
    """
    # 2026-09-12-chat-turn-auto-recovery（task-04 / design §5.3）：上游故障轮
    # 三分支自动恢复（瞬时干净轮重放原文 / 有工具活动 nudge 续跑 / quota 到
    # 重置时间定时续跑）。泛化并取代 ql-20260903-011 的 auth-transient 专用
    # 钩子（auth 类并入统一判定序，D-004@v2）。终态已 commit，恢复走排队/
    # 定时消息表 + 既有派发链。helper 全程静默容错。
    from app.modules.daemon.session.service.auto_resume import (
        maybe_auto_recover_failed_turn,
    )

    try:
        await maybe_auto_recover_failed_turn(svc, agent_run)
    except Exception as exc:
        # 双层防御：钩子内部已全程静默容错，此处兜底防实现漂移（NFR-4——
        # 恢复失败绝不影响已 commit 终态）。
        _rsvc.log.warning(
            "auto_recover_hook_unexpected_failure",
            run_id=str(agent_run.id),
            error=str(exc),
        )

    # ql-20260823-006：run 终态翻会话 ended/failed → commit 后 best-effort 补发
    # SESSION_END（失败仅日志，不影响已 commit 终态），daemon 侧 end() 收口
    # （kill driver + close InputQueue + 终态条目不再落盘）。
    if session_end_intent is not None:
        flip_session_id, flip_lease_id, flip_runtime_id = session_end_intent
        await _send_session_end_best_effort(
            svc._session,
            session_id=flip_session_id,
            lease_id=flip_lease_id,
            runtime_id=flip_runtime_id,
            reason="run_terminal_flip",
        )

    # task-03（design §3 生命周期契约表）：run 终态翻 session ended/failed →
    # 广播列表变更信号（status_changed），打开的会话列表秒级收敛。publish 内部
    # 静默容错（Redis 抖动不拖垮已 commit 的终态）；仅刷 last_active_at 的多轮
    # 分支意图为 None，零发布。
    if sessions_changed_intent is not None:
        changed_sid, changed_uid = sessions_changed_intent
        await _rsvc.publish_sessions_changed("status_changed", changed_sid, changed_uid)

    # task-10 / FR-06 / D-010@v1：借用 agent run 完成 → 方案文本落文件中心 +
    # 补 daemon_borrow_audit.usage_summary。仅 borrowed lease 生效（helper 内部
    # 判别 ``lease_meta.borrowed=True``），普通 lease 零回归。helper 自带 try/except
    # 守门（落 file/审计失败仅记日志，不影响已 commit 的 run 终态——H4）。
    try:
        from app.modules.agent.service import AgentService

        await AgentService(svc._session).persist_borrow_run_output(agent_run, lease_meta)
    except Exception as exc:
        _rsvc.log.warning(
            "borrow_run_output_hook_failed",
            run_id=str(agent_run.id),
            error=str(exc),
        )

    # task-05 / design §5.1：commit 后 enqueue gate 决策后台任务并立即返回 HTTP
    # （<30s，daemon notifyRunResult 不重试）。仅 verify stage 的 completed run
    # enqueue（对话 turn / failed / 非 verify stage 不进 gate，_gate_applicable 守门）。不 await
    # gate 任务 —— _fire_background_task（task-03 / H4）创建 asyncio.Task 持强引用
    # 防静默 GC，enqueue 失败异常由 add_done_callback 兜底，不影响已 commit 终态行。
    # workspace_id 从 Change.workspace_id 推导（对齐 _trigger_stage_completion_callback
    # :1029 的稳定来源；AgentSession.workspace_id 亦可选，但 Change 更直接且 stage
    # run 必有 change）。task-07（Wave 3）替换 _run_gate_decision_task stub 实现真实
    # gate 决策（H1 独立 session + R3 cas + 跑 gate + 存 result + H2 内联 sync/auto_dispatch）。
    if await svc._gate_applicable(agent_run):
        gate_workspace_id = await svc._resolve_gate_workspace_id(agent_run)
        if gate_workspace_id is not None:
            svc._fire_background_task(
                svc._run_gate_decision_task(
                    agent_run_id=agent_run.id,
                    workspace_id=gate_workspace_id,
                    change_id=agent_run.change_id,
                ),
                workspace_id=gate_workspace_id,
                run_id=agent_run.id,
            )

    # Publish terminal event so SSE stream (task-06) emits turn_completed.
    try:
        redis = _rsvc.get_redis()
        await redis.publish(
            f"agent_run:{agent_run.id}",
            json.dumps(
                {
                    "event": "status_changed",
                    "status": agent_run.status,
                    "lease_id": str(lease_id),
                    "agent_run_id": str(agent_run.id),
                    "subtype": subtype,
                },
                default=str,
            ),
        )
    except Exception:
        _rsvc.log.warning(
            "interactive_run_close_redis_publish_failed",
            lease_id=str(lease_id),
            agent_run_id=str(agent_run.id),
        )

    # design §6 step3 / §8.2：往 session 级 channel 发 turn_completed，让前端
    # SSE onTurnCompleted 清空 currentRunId、解锁输入框发下一条。否则 turn 在
    # 后端已完成（status_changed 只发到 agent_run:{run_id}），但前端只订阅
    # agent_session:{session_id}，收不到结束信号 → UI 永远停在「运行中」、发不
    # 了下一条（用户报告的现象）。契约见 frontend/src/lib/daemon.ts
    # SessionStreamEnvelope（event=turn_completed + status + exit_code）。
    # _publish_session_event 自带 try/except，Redis 抖动不影响已提交的终态行。
    await svc._facade._publish_session_event(
        agent_run.agent_session_id,
        {
            "event": "turn_completed",
            "session_id": str(agent_run.agent_session_id),
            "run_id": str(agent_run.id),
            "status": agent_run.status,
            "exit_code": agent_run.exit_code,
            # ql-20260621：终态 token 一并推送，前端 onTurnCompleted 收敛时
            # 同步显示最终输入/输出词元（与执行中 onTokens 推送的累积值一致，
            # 覆盖 daemon 老版本不实时推 token 的情形）。
            "input_tokens": agent_run.input_tokens,
            "output_tokens": agent_run.output_tokens,
            "timestamp": now.isoformat().replace("+00:00", "Z"),
        },
    )


async def _close_finish(
    svc,
    agent_run: AgentRun,
    *,
    lease_id: uuid.UUID,
    status: str,
    is_error: bool,
    subtype: str | None,
    api_requests: int | None,
) -> AgentRun:
    """收口日志 + 排队消息后台派发（task-10 搬移，方法体逐字节一致）。"""
    _rsvc.log.info(
        "interactive_run_closed",
        lease_id=str(lease_id),
        agent_run_id=str(agent_run.id),
        status=agent_run.status,
        sdk_status=status,
        is_error=is_error,
        subtype=subtype,
        # task-03：run 级 API 调用次数精确值（AgentRun 无该列，日志观测；
        # 落库承载在 agent_run_model_usage 明细行，各行求和 == 该值，design §2）。
        api_requests=api_requests,
    )

    # ql-20260825-011（后端真实排队）：turn 终态 → 后台派发下一条排队消息。
    # 先查有无 pending 条目（close 已 commit，读快照零锁）——绝大多数会话
    # 无排队，不起空转任务；有才 fire（H4 强引用防 GC，独立 DB session H1）。
    # 会话可能已被终态翻成 ended/failed（dispatch 内部自查自弃）。
    if agent_run.agent_session_id is not None:
        from app.modules.agent.model import AgentSessionQueuedMessage

        has_pending = (
            await svc._session.execute(
                select(AgentSessionQueuedMessage.id)
                .where(
                    AgentSessionQueuedMessage.agent_session_id == agent_run.agent_session_id,
                    AgentSessionQueuedMessage.status == "pending",
                )
                .limit(1)
            )
        ).scalar_one_or_none()
        if has_pending is not None:
            from app.modules.daemon.session.service import dispatch_next_queued_message

            svc._fire_background_task(
                dispatch_next_queued_message(agent_run.agent_session_id),
                run_id=agent_run.id,
            )
    return agent_run
