"""Worker 子会话自动重派（2026-08-29-batch-session-inherit task-02 / design S2 / FR-02）.

daemon 掉线中断 worker 子会话（task-01 已分流标 ``failed`` + 中断 run
``error_code=daemon_interrupted``）后，自动重派**继承原会话**——复用原
``AgentSession`` 行经 ``RunPlacementService.prepare_interactive_dispatch`` 重建
interactive lease + 新首 run 挂原会话，并注入 ``resume_session_id``（取原
``AgentSession.agent_session_id``，NULL 回退最新 ``AgentRun.session_id``）续 SDK
上下文，消除「worker 挂起卡 mission 等 24h GC」。

独立文件（design 文件变更清单裁定）：重派编排不进 mcp_tools.py（防 2600 行
膨胀）。与首轮 ``_dispatch_worker_common``（mcp_tools.py）同构但独立实现——首轮
带治理段（scope 校验 / 越权预检 / worktree 建立），重派只做「原 session 行 +
首 run 行双表上下文重建」（per-worker worktree 已持久化在原 ``session.cwd``，
无需重建）；必须走 ``prepare_interactive_dispatch`` 而非 ``dispatch_to_daemon``
——后者造裸 AgentSession 脱离会话树，list_workers / patrol 全瞎（design S2）。

互斥守卫（design S2，plan 调研新增三守卫）：

- ① mission 终态守卫：``converged_at`` / ``cancelled_at`` 非空 → 不重派（对齐
  patrol.py:750-751 主循环守卫——已收敛 mission 不再派活）；
- ② patrol 职责④排除：``error_code=daemon_interrupted`` 的 run 不进
  ``_patrol_worker_recovery`` 候选（防旧 run 被翻回 pending 与新 run 双跑 +
  日志噪音）——落点在 patrol.py 本变更接线，非本模块；
- ③ worker_force_end 宽限窗守卫：mission.constraints 已带
  ``worker_force_ended_at`` 单向标记（patrol 职责⑦置位后无清除路径）、或会话
  ``ended_at`` 距今超该职责宽限（默认 30min，``_worker_force_end_grace_minutes``
  单源）→ 不重派——超窗后 mission 被 derive 映 failed，重派成功也救不回。

节流（design S2）：同 session 名下 ``kind='interactive'`` 历史 lease 行数 ≥
:data:`REDISPATCH_MAX_ATTEMPTS`（3）不再重派，session 留 failed 终态交 mission
converge / patrol 既有兜底。

触发：``suspend_sessions_for_daemon`` / ``session_offline_sweep_once`` 写 failed
的事务提交后经 :func:`fire_worker_redispatch` 异步 fire（不阻塞挂起主路径；
失败仅记日志，下轮 offline sweep 60s 周期自愈）。
"""

from __future__ import annotations

import asyncio
import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import col

from app.core.logging import get_logger
from app.modules.agent.execution import MISSION_WORKER_STAGE, worker_tool_config
from app.modules.agent.mission_context import build_worker_briefing
from app.modules.agent.model import (
    AgentMission,
    AgentRun,
    AgentRunLog,
    AgentSession,
)
from app.modules.agent.placement import NoOnlineDaemonError, RunPlacementService
from app.modules.daemon.model import DaemonTaskLease
from app.modules.daemon.session.service import DAEMON_INTERRUPTED_ERROR_CODE

log = get_logger(__name__)

# 节流上限（design S2：attempt>=3 不再重派）。计数锚 = 该 session 名下
# kind='interactive' 的历史 DaemonTaskLease 行数（含首轮派发）——interactive
# lease 的 agent_run_id 列恒 NULL（D-005@v1），归属锚是 metadata.session_id
# （prepare_interactive_dispatch 写入），或经 agent_runs.agent_session_id 关联
# （batch 形态兜底，对齐 task-02.md implementation 口径）。
REDISPATCH_MAX_ATTEMPTS = 3

# 互斥守卫②的排除口径 re-export 便利（patrol.py 消费同一常量，单一落点在
# daemon.session.service）：daemon_interrupted 的 run 归本模块重派链路，
# patrol 职责④ worker_recovery 不捞。
__all__ = [
    "DAEMON_INTERRUPTED_ERROR_CODE",
    "REDISPATCH_MAX_ATTEMPTS",
    "fire_worker_redispatch",
    "redispatch_worker_session",
]


def _as_utc(value: datetime) -> datetime:
    """SQLite DateTime round-trip 丢 tzinfo——naive 视作 UTC 归一（patrol 同款）。"""
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value


async def redispatch_worker_session(
    db: AsyncSession,
    session_id: uuid.UUID,
) -> uuid.UUID | None:
    """重派被 daemon 掉线中断的 worker 子会话，返回新 lease_id。

    流程（design S2）：

    1. **种子态守卫**：session 必须是 task-01 分流标的 worker failed 态
       （``parent_session_id`` 非空 + ``status == "failed"`` + ``runtime_id``
       非空）——并发二次 fire / 已翻回 active 的会话自然短路（幂等）；
    2. **双表上下文**：读首 run（该会话最早 run）承载派发参数
       （objective / role / read_only / model / mission_id / worktree_branch /
       agent_profile 快照），session 行承载路由参数（provider / cwd /
       workspace_id / tree_depth / runtime_id）；
    3. **守卫①③ + 节流**（见模块头），任一命中返回 ``None``（debug/info 日志）；
    4. **重建**：新首 run（pending，interactive）挂原会话 →
       ``prepare_interactive_dispatch``（flush-only）建新 interactive lease +
       ``resume_session_id`` 注入 + ``_merge_lease_metadata`` 补 role /
       tool_config（对齐 mcp_tools 首轮派发先例）→ session 翻回 active +
       清 ended_at + turn_count 归 0（新一轮语义）+ 绑新 lease → 单 commit；
    5. **唤醒**：commit 后 ``notify_interactive_dispatch``（WS wakeup）——
       投递不可达仅告警不收敛（worker 派发对投递失败容忍，lease pending 等
       daemon 轮询/重连自领取，与首轮派发同口径）。

    原 runtime 钉定（``pinned_runtime_id`` + 代表钉定旗标）：worker 的
    per-worker worktree 在原 daemon 机器上（cwd 机器局部），重派必须回原
    runtime，绝不静默换机；原 runtime 仍离线 → ``NoOnlineDaemonError`` →
    rollback 后返回 ``None``（失败仅记日志，触发方下轮自愈）。

    调用方拥有事务边界：本函数自行 commit（成功）/ rollback（失败），挂起
    主路径（suspend / sweep）在**事务提交后**异步 fire，二者不共享事务。
    """
    session = await db.get(AgentSession, session_id)
    if session is None:
        log.info("worker_redispatch_session_missing", session_id=str(session_id))
        return None
    # 种子态守卫：只重派 task-01 分流标 failed 的 worker 子会话（parent 非空 +
    # runtime_id 非空作派发路由键）。已被重派翻回 active（并发二次 fire）短路。
    if (
        session.parent_session_id is None
        or session.status != "failed"
        or session.runtime_id is None
    ):
        log.info(
            "worker_redispatch_not_failed_worker_seed",
            session_id=str(session_id),
            status=session.status,
            has_parent=session.parent_session_id is not None,
            has_runtime=session.runtime_id is not None,
        )
        return None

    # ── 双表上下文：首 run（最早）承载派发参数 ──────────────────────────────
    first_run = (
        await db.execute(
            select(AgentRun)
            .where(AgentRun.agent_session_id == session_id)
            .order_by(AgentRun.created_at)
            .limit(1)
        )
    ).scalar_one_or_none()
    # 无历史 run（脏数据）或 run 无 mission 锚（重派必须能挂回 mission 树，
    # 否则新 run 脱离 mission_worker_sessions 枚举）→ 不重派。
    if first_run is None or first_run.mission_id is None:
        log.info(
            "worker_redispatch_no_mission_anchored_run",
            session_id=str(session_id),
        )
        return None

    # ── 互斥守卫①：mission 终态（converged/cancelled）不重派 ────────────────
    mission = await db.get(AgentMission, first_run.mission_id)
    if mission is None:
        log.debug(
            "worker_redispatch_mission_missing",
            session_id=str(session_id),
            mission_id=str(first_run.mission_id),
        )
        return None
    if mission.converged_at is not None or mission.cancelled_at is not None:
        log.debug(
            "worker_redispatch_mission_terminal",
            session_id=str(session_id),
            mission_id=str(mission.id),
            converged_at=str(mission.converged_at),
            cancelled_at=str(mission.cancelled_at),
        )
        return None

    # ── 互斥守卫③：worker_force_end 宽限窗（patrol 职责⑦ 30min 单向置位）────
    # 标记已置位（单向无清除，mission derive 已映 failed）或会话终态超宽限
    # （patrol 即将置标）→ 重派成功也救不回 mission，不再重派留 failed 终态。
    from app.modules.agent.mission import WORKER_FORCE_ENDED_AT_KEY
    from app.modules.agent.patrol import _worker_force_end_grace_minutes

    constraints = mission.constraints if isinstance(mission.constraints, dict) else {}
    if WORKER_FORCE_ENDED_AT_KEY in constraints:
        log.debug(
            "worker_redispatch_force_ended_marker_set",
            session_id=str(session_id),
            mission_id=str(mission.id),
        )
        return None
    if session.ended_at is not None and (
        datetime.now(UTC) - _as_utc(session.ended_at)
        >= timedelta(minutes=_worker_force_end_grace_minutes())
    ):
        log.debug(
            "worker_redispatch_grace_window_expired",
            session_id=str(session_id),
            ended_at=str(session.ended_at),
        )
        return None

    # ── 节流：同 session 名下 interactive 历史 lease 行数 >= 3 不重派 ─────────
    run_ids = select(AgentRun.id).where(AgentRun.agent_session_id == session_id)
    attempt_count = int(
        await db.scalar(
            select(func.count())
            .select_from(DaemonTaskLease)
            .where(
                DaemonTaskLease.kind == "interactive",
                or_(
                    # JSON 列 Optional 注解（dict | None）在 SQL 构造语境必非 None
                    # 运行时安全——类属性取下标生成 JSON_EXTRACT/->> 表达式。
                    DaemonTaskLease.metadata_["session_id"].as_string()  # type: ignore[index]
                    == str(session_id),
                    DaemonTaskLease.agent_run_id.in_(run_ids),
                ),
            )
        )
        or 0
    )
    if attempt_count >= REDISPATCH_MAX_ATTEMPTS:
        log.info(
            "worker_redispatch_throttled",
            session_id=str(session_id),
            attempts=attempt_count,
            max_attempts=REDISPATCH_MAX_ATTEMPTS,
        )
        return None

    # ── 上下文重建要素 ────────────────────────────────────────────────────────
    # resume id：session 行 SDK 会话 id 优先；NULL 回退该会话最新 run 的
    # session_id（照 service.py _heal_agent_session_id_from_runs 同源逻辑的
    # 简化版——只读不写回，最新 created_at DESC 取有效 key）。两处皆空 =
    # SDK 会话 id 从未产出，无 resume 可续——照常重派但不带 resume 键
    # （daemon 全新会话起步，S4 降级语义同构）。
    resume_session_id = session.agent_session_id
    if not resume_session_id:
        resume_session_id = (
            await db.execute(
                select(AgentRun.session_id)
                .where(
                    AgentRun.agent_session_id == session_id,
                    col(AgentRun.session_id).is_not(None),
                    col(AgentRun.session_id) != "",
                )
                .order_by(AgentRun.created_at.desc())
                .limit(1)
            )
        ).scalar_one_or_none()

    # prompt 按 first_run.objective + role 重渲染（design：重派语义是「继续任务」
    # 非复刻首轮简报原文——objective 在 run 行不丢）；mode 按 worktree_branch
    # 有无推 git/direct；can_dispatch 按 tree_depth 推（对齐 mcp_tools 首轮
    # 派发同款判定，MAX_DISPATCH_DEPTH 单源 import 不建副本）。
    from app.modules.agent.mcp_tools import MAX_DISPATCH_DEPTH

    prompt = build_worker_briefing(
        objective=first_run.objective or "",
        role=first_run.role,
        mode="git" if first_run.worktree_branch else "direct",
        can_dispatch=(session.tree_depth < MAX_DISPATCH_DEPTH),
    )
    # tool_config 由 read_only 重算（claim payload 透传，与 batch 路径
    # worker_tool_config 同源；NULL 读作 False，对齐读侧口径 design §8.3）。
    tool_config = worker_tool_config(bool(first_run.read_only))

    # ── 新首 run + 新 lease + session 翻回 active（单事务收口）────────────────
    # 前置捕获标量：rollback 会 expire 会话内全部 ORM 对象，异常分支的日志
    # 入参不得再访问 ORM 属性（mcp_tools F06 同款防护）。
    sid_str = str(session.id)
    mission_id_str = str(mission.id)
    now = datetime.now(UTC)
    new_run = AgentRun(
        mission_id=first_run.mission_id,
        change_id=first_run.change_id,
        agent_type=first_run.agent_type,
        provider=first_run.provider or session.provider,
        model=first_run.model,
        status="pending",
        # 子会话形态首 run 与首轮派发同款（interactive 驱动）。
        spec_strategy="interactive",
        role=first_run.role,
        objective=first_run.objective,
        read_only=first_run.read_only,
        target_workspace_id=first_run.target_workspace_id,
        # worktree 分支沿用首轮（converge 合并按 run.worktree_branch 分组，
        # 复制保住「重派后产出仍可 merge 回工作区」的链路）。
        worktree_branch=first_run.worktree_branch,
        agent_profile_id=first_run.agent_profile_id,
        agent_profile_snapshot=first_run.agent_profile_snapshot,
        agent_session_id=session.id,
        user_id=first_run.user_id or session.user_id,
    )
    db.add(new_run)
    await db.flush()

    placement_svc = RunPlacementService(db)
    try:
        dispatch = await placement_svc.prepare_interactive_dispatch(
            agent_session_id=session.id,
            agent_run_id=new_run.id,
            user_id=session.user_id,
            provider=session.provider,
            prompt=prompt,
            model=first_run.model,
            workspace_id=session.workspace_id,
            # 原 cwd 复用（per-worker worktree 路径已持久化在 session 行）。
            cwd=session.cwd,
            # 原 runtime 钉定 + 代表钉定旗标（mission.created_by 常非代表机器
            # 属主，对齐首轮 resolve_representative_binding 钉定形态）。
            pinned_runtime_id=session.runtime_id,
            pinned_skip_owner_check=True,
            stage=MISSION_WORKER_STAGE,
            worker_depth=session.tree_depth,
            resume_session_id=resume_session_id,
        )
        # role + tool_config 经 _merge_lease_metadata 事务内补 lease metadata
        # （不单独 commit，对齐 mcp_tools 派发先例）。
        from app.modules.daemon.session.service import _merge_lease_metadata

        await _merge_lease_metadata(
            db,
            dispatch.lease_id,
            {"role": first_run.role, "tool_config": tool_config},
        )
        # session 翻回 active + 清 ended_at + turn_count 归 0（新一轮语义）+
        # 绑新 lease / 新 runtime。
        session.status = "active"
        session.ended_at = None
        session.turn_count = 0
        session.last_active_at = now
        session.runtime_id = dispatch.runtime_id
        session.lease_id = dispatch.lease_id
        db.add(session)
        # 新首 prompt 落一条 user_input 日志行（历史回看，首轮派发同源）。
        db.add(
            AgentRunLog(
                run_id=new_run.id,
                channel="user_input",
                content_redacted=prompt[:5000],
                timestamp=now,
            )
        )
        await db.commit()
    except NoOnlineDaemonError as exc:
        # 原 runtime 仍离线（daemon 未回归）：失败仅记日志返回 None——session
        # 保持 failed 终态，触发方（suspend fire / 下轮 sweep）自愈重试。
        await db.rollback()
        log.warning(
            "worker_redispatch_no_online_runtime",
            session_id=sid_str,
            mission_id=mission_id_str,
            error=str(exc),
        )
        return None
    except Exception as exc:
        # 兜底未预期异常：rollback 掉 flush-only 的 lease/run（无半孤儿态，
        # 对齐 mcp_tools F06 单事务无孤儿承诺），失败记日志不抛（异步 task
        # 消费，抛出只会进 task 异常黑洞）。
        await db.rollback()
        log.warning(
            "worker_redispatch_failed",
            session_id=sid_str,
            mission_id=mission_id_str,
            error=str(exc),
        )
        return None

    # ── commit 后唤醒 daemon（WS wakeup）──────────────────────────────────────
    delivered = await placement_svc.notify_interactive_dispatch(dispatch)
    if not delivered:
        log.warning(
            "worker_redispatch_wakeup_undelivered",
            session_id=sid_str,
            lease_id=str(dispatch.lease_id),
            runtime_id=str(dispatch.runtime_id),
        )
    log.info(
        "worker_redispatch_done",
        session_id=sid_str,
        mission_id=mission_id_str,
        lease_id=str(dispatch.lease_id),
        run_id=str(dispatch.run_id),
        resumed=resume_session_id is not None,
    )
    return dispatch.lease_id


def fire_worker_redispatch(workers: list[tuple[uuid.UUID, uuid.UUID]]) -> None:
    """suspend / sweep 挂起事务提交后异步 fire 重派（不阻塞挂起主路径）。

    对每个 worker 种子 ``(session_id, runtime_id)``（task-01
    ``SuspendBatchResult.workers`` / offline sweep 同款）起独立
    ``asyncio.create_task``；task 内经 ``get_session_factory()`` 开短 session
    执行 :func:`redispatch_worker_session`——调用方（请求 / 巡检作用域）的
    AsyncSession 随其生命周期结束，不能跨 task 复用。任何失败仅记日志
    （task 体内部兜底，不抛出）；调用方须在**事务提交后**调用（重派自开事务，
    与挂起主路径不共享）。
    """
    for session_id, runtime_id in workers:
        asyncio.create_task(_redispatch_task(session_id, runtime_id))


async def _redispatch_task(session_id: uuid.UUID, runtime_id: uuid.UUID) -> None:
    """重派 task 体：短 session 执行，任何异常仅记日志不抛（防异常黑洞刷屏）。"""
    from app.core.db import get_session_factory

    try:
        async with get_session_factory()() as db:
            lease_id = await redispatch_worker_session(db, session_id)
            if lease_id is None:
                log.info(
                    "worker_redispatch_skipped",
                    session_id=str(session_id),
                    runtime_id=str(runtime_id),
                )
    except Exception:
        log.exception(
            "worker_redispatch_task_failed",
            session_id=str(session_id),
            runtime_id=str(runtime_id),
        )
