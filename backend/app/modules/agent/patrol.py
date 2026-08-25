"""mission 收敛巡检服务（2026-08-21-mission-converge-patrol task-02 骨架）。

设计定位（design §2）：lifespan 常驻协程（对齐 ``monitoring`` watchdog 协程模式），
每轮顺序执行三职责，异常隔离双层——单 mission 隔离（FR-01.2）+ 三职责间互不阻断：

1. 收敛兜底（task-03）：活跃 mission 逐个 ``schedule_loop``（幂等，converged 计数）。
2. 离线重派（task-04）：``redispatch_pending_main_runs`` 覆盖 daemon 恢复场景。
3. 僵尸两阶段（task-05/06/07）：判死 / 复活 / 豁免解除。

task-02 落骨架（循环 / 活跃查询 limit 100 / 异常隔离框架 / ``mission_patrol_round_done``
日志 / 每轮独立短 session——``get_session_factory()()`` async with，轮间不长期持连接，
对齐 complete_lease 请求路径生命周期，D-001/D-002）；task-03~07 依次接线三职责。

task-08（2026-08-22-team-session-unify / design §5 Phase 1 patrol 适配 / §7.5
patrol auto-converge 行 / D-008 / FR-08）——mission 挂到会话后存续口径从「主控
run 常驻 running」改为「会话活跃 turn」：

- 职责①扩展：会话 mission awaiting_input 超时自动收敛（主控轮+分身全终态未
  converge 且会话无活跃 turn 持续超 ``mission_patrol_awaiting_input_timeout_minutes``
  → 走 task-06 explicit 置位入口，时钟起点=最新 orchestrator run 的 finished_at）。
- 职责③判死分流：会话 mission 判死对象从主 run 改为分身 run（非终态 + 承载
  daemon 离线超时 + 主控会话无活跃 turn）；存量 external 保持原主 run 判定链路
  零回归。

task-12（2026-08-25-team-subsession-governance / FR-06 / design §5.D 末行）追加
职责⑤孤儿子会话扫描：独立查询（方向与 ``_active_mission_ids`` 相反——那是活跃
mission 名单）找出已 converged/cancelled 终态 mission 下仍活跃
（pending/active/reconnecting）的分身子会话，逐个补发 ``SessionService.end_session``
收口——兜底 task-10 converge 批量收口 best-effort 部分失败与 cancel 链漏网，
实现零孤儿。
"""

from __future__ import annotations

import asyncio
import time
import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import col

from app.core.config import get_settings
from app.core.db import get_session_factory
from app.core.logging import get_logger
from app.modules.agent.model import (
    ACTIVE_RUN_STATUSES,
    AgentMission,
    AgentRun,
    AgentSession,
    mission_worker_sessions,
)
from app.modules.agent.orchestrator import (
    _ORCHESTRATOR_ROLE,
    OrchestratorService,
    _resolve_main_agent_config,
    render_orchestrator_prompt,
)
from app.modules.agent.placement import NoOnlineDaemonError, RunPlacementService
from app.modules.daemon.model import DaemonInstance, DaemonRuntime, DaemonTaskLease

log = get_logger(__name__)

# 每轮活跃 mission 上限（FR-01.3 / R-05）：防 mission 积压时单轮过载。
# created_at 升序 = 老 mission 先巡。模块级常量便于单测收紧验证 limit 生效。
ACTIVE_MISSION_LIMIT = 100

# run 终态集合（task-08）：与 mcp_tools._TERMINAL_RUN_STATUSES 同口径——
# awaiting_input 超时收敛的「全终态」判据与分身僵尸判死的「非终态」判据共用。
_TERMINAL_RUN_STATUSES = ("completed", "failed", "killed")

# run_once 返回 / round_done 日志共用的计数键（FR-04.2；task-12 追加
# orphan_sessions_ended——职责⑤孤儿子会话补收口计数）。
PATROL_COUNT_KEYS = (
    "checked",
    "converged",
    "redispatched",
    "zombie_marked",
    "zombie_revived",
    "worker_recovered",
    "orphan_sessions_ended",
)

# 僵尸标记态（task-05 provides，task-06/07/08 消费）：主 agent run 判死后写
# error_code=orchestrator_zombie；时间戳落 mission.constraints JSON（D-005 无新列，
# 同 mcp_tools.py conflict_attempts 的键复用模式）。
ZOMBIE_ERROR_CODE = "orchestrator_zombie"
ZOMBIE_MARKED_AT_KEY = "zombie_marked_at"
# 豁免解除标记（task-07）：复活窗口耗尽且 daemon 仍离线时置 true，解除
# schedule_loop 信号 1 对 zombie 主 run 的豁免（下轮按终态 failed 正常收敛）；
# 置位后保留 zombie_marked_at 作审计。
ZOMBIE_CONVERGED_KEY = "zombie_converged"


def _as_utc(value: datetime) -> datetime:
    """把 naive datetime 视作 UTC 归一（SQLite DateTime 列 round-trip 丢 tzinfo）。"""
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value


def _zombie_marked_at(mission: AgentMission) -> datetime | None:
    """从 mission.constraints 解析 zombie_marked_at（task-05 写入的 ISO 字符串）。

    缺失 / 非法字符串 → None（无法判复活窗口，调用方跳过该 run 不猜）。
    """
    raw = (mission.constraints or {}).get(ZOMBIE_MARKED_AT_KEY)
    if not raw:
        return None
    try:
        return _as_utc(datetime.fromisoformat(str(raw)))
    except ValueError:
        return None


async def _session_has_active_turn(db: AsyncSession, session_id: uuid.UUID) -> bool:
    """会话当前是否有活跃 turn（ACTIVE_RUN_STATUSES 词表单源）——task-08。

    状态集合与 daemon/router._session_has_active_turn、finalizer.
    _session_has_active_turn 同口径（task-02 契约的 ``session_active_turn``
    入参来源，task-04/05 同源判定）；patrol 不能 import daemon.router
    （循环依赖），2026-08-25 二审 #3 起改为共享 ``agent.model.ACTIVE_RUN_STATUSES``
    常量（pending/running/pending_approval——修复审批中主控轮漏判致 awaiting_input
    超时收敛误触发；interrupting 为前端展示态，backend 不落库，已剔除）。
    """
    stmt = (
        select(AgentRun.id)
        .where(
            AgentRun.agent_session_id == session_id,
            AgentRun.status.in_(list(ACTIVE_RUN_STATUSES)),
        )
        .limit(1)
    )
    return (await db.execute(stmt)).first() is not None


async def _mission_bound_session(db: AsyncSession, mission: AgentMission) -> AgentSession | None:
    """会话 mission 判别（task-08，与 finalizer/orchestrator 同款口径）。

    按该 id 的 AgentSession 真实存在判别：存在 → 会话 mission（awaiting_input
    档适用，Grill NEW-4）；NULL 或查无行 → 存量 external/team mission（保持
    原链路）。查表（而非仅列非 NULL）保持三处口径统一，防外部直构随机 uuid。
    """
    if mission.session_id is None:
        return None
    return await db.get(AgentSession, mission.session_id)


class MissionPatrolService:
    """mission 巡检服务：单轮执行体 ``run_once`` + 常驻循环 ``loop``。

    与 ``OrchestratorService`` 同款构造（session 由调用方传入）。巡检循环每轮
    开独立短 session 构造新实例，轮间不长期持连接（constraints：短 session）。
    """

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def _active_mission_ids(self) -> list[uuid.UUID]:
        """查活跃 mission id（FR-01.3）：未收敛且未取消，created_at 升序，至多 100 条。

        external / single / team 模式不区分——收敛兜底对无主 run 的 mission 由
        ``schedule_loop`` 内部跳过（零改动，design §2.1）。
        """
        stmt = (
            select(AgentMission.id)
            .where(
                AgentMission.converged_at.is_(None),
                AgentMission.cancelled_at.is_(None),
            )
            .order_by(AgentMission.created_at)
            .limit(ACTIVE_MISSION_LIMIT)
        )
        rows = (await self._session.execute(stmt)).scalars().all()
        return list(rows)

    async def run_once(self) -> dict[str, int]:
        """单轮巡检执行体：顺序跑三职责挂载点，返回五计数 dict（FR-04.2）。

        - ``checked``：本轮活跃 mission 数。
        - ``converged`` / ``redispatched`` / ``zombie_marked`` / ``zombie_revived``：
          三职责计数（task-03/04/05/06 依次接线）。
        - 三职责各自 try/except 互不阻断（design §2）：单职责崩溃只记
          ``mission_patrol_duty_failed``，同轮其它职责照常执行。
        """
        counts = dict.fromkeys(PATROL_COUNT_KEYS, 0)
        mission_ids = await self._active_mission_ids()
        counts["checked"] = len(mission_ids)

        # ── 职责①：收敛兜底（task-03 已接线）──
        # 活跃 mission 逐个 OrchestratorService(session).schedule_loop(mid)（幂等），
        # 逐 mission try/except 隔离在 _patrol_convergence 内（FR-01.2）。
        try:
            counts["converged"] = await self._patrol_convergence(mission_ids)
        except Exception:
            log.exception("mission_patrol_duty_failed", duty="convergence")

        # ── 职责②：离线重派（task-04 已接线）──
        # OrchestratorService(session).redispatch_pending_main_runs()，计数透传
        # （覆盖"运行中 daemon 恢复"场景，design §2.2）。
        try:
            counts["redispatched"] = await self._patrol_redispatch()
        except Exception:
            log.exception("mission_patrol_duty_failed", duty="redispatch")

        # ── 职责③：僵尸两阶段（task-05 判死 / task-06 复活 / task-07 豁免解除已接线）──
        # 返回 (zombie_marked, zombie_revived) 计数（design §2.3）。
        try:
            counts["zombie_marked"], counts["zombie_revived"] = await self._patrol_zombie()
        except Exception:
            log.exception("mission_patrol_duty_failed", duty="zombie")

        # ── 职责④：worker 断线恢复（ql-20260825-003）──
        # 断线 failed/killed worker：可补发（checkpoint_data 有产物快照）→
        # sync_agent_run_status 补发终态（幂等，不重跑）；未完成才 resume
        # 重置 pending 让 daemon 重跑。统计进 worker_recovered。
        try:
            counts["worker_recovered"] = await self._patrol_worker_recovery()
        except Exception:
            log.exception("mission_patrol_duty_failed", duty="worker_recovery")

        # ── 职责⑤：孤儿子会话扫描（task-12 / FR-06 / design §5.D 末行）──
        # 独立查询终态 mission（converged/cancelled）的活跃分身子会话补发
        # end_session 收口——兜底 task-10 converge 批量收口 best-effort 部分
        # 失败与 cancel 链漏网，零孤儿。独立 try/except 互不阻断（对齐四职责）。
        try:
            counts["orphan_sessions_ended"] = await self._patrol_orphan_subsessions()
        except Exception:
            log.exception("mission_patrol_duty_failed", duty="orphan_subsessions")

        return counts

    async def _patrol_convergence(self, mission_ids: list[uuid.UUID]) -> int:
        """职责① 收敛兜底挂载点（真实逻辑 task-03 填充）。

        单 mission 异常隔离框架（FR-01.2）：一个 mission 抛错只记
        ``mission_patrol_mission_failed`` warning，不阻断同轮其它 mission。
        """
        converged = 0
        for mission_id in mission_ids:
            try:
                converged += await self._converge_mission(mission_id)
            except Exception as exc:
                log.warning(
                    "mission_patrol_mission_failed",
                    mission_id=str(mission_id),
                    error=repr(exc),
                )
                continue
        return converged

    async def _converge_mission(self, mission_id: uuid.UUID) -> int:
        """单 mission 收敛兜底（task-03 + task-08 扩展，design §2.1/§7.5）。

        task-03：``schedule_loop`` 幂等巡检（external / single 模式无主 run →
        内部跳过返回 None，本方法零额外过滤，taskcard 约束）。

        task-08：``schedule_loop`` 返回 None（含会话 mission 整体 no-op——orchestrator
        分流后不再自动收敛）时，再探会话 mission awaiting_input 超时自动收敛
        （``_auto_converge_awaiting_input``），命中计入 converged 计数。

        Returns:
            本 mission 本轮是否触发收敛（1 / 0）。
        """
        status = await OrchestratorService(self._session).schedule_loop(mission_id)
        if status is not None:
            return 1
        return await self._auto_converge_awaiting_input(mission_id)

    async def _auto_converge_awaiting_input(self, mission_id: uuid.UUID) -> int:
        """会话 mission awaiting_input 超时自动收敛（task-08 / FR-08 / §7.5 行）。

        判据全格（任一不满足 → 0 不收敛）：
        - 会话 mission（``session_id`` 指向真实 AgentSession——存量 external/team
          的随机 uuid 查无会话行，不进此档，Grill NEW-4 零回归）；
        - 未 converge 未 cancel（活跃态）；
        - 会话无活跃 turn（ACTIVE_RUN_STATUSES 词表，task-02/04/05 同源口径）；
        - 主控轮 + 分身全终态（task-02 派生态 awaiting_input 的 run 维度前提）；
        - 时钟起点=最新 ``role='orchestrator'`` run 的 ``finished_at``（锚点与
          task-06 一致），距今持续超 ``mission_patrol_awaiting_input_timeout_minutes``；
          finished_at 缺失 → 跳过不猜（对齐判死链路断链语义）。

        命中 → 走 task-06 explicit 置位入口（``converge_explicit=True``：分身维度
        判据 + converged_at 原子抢占，不依赖主控 run 状态；冲突时入口内回滚置位
        保重入），推进 mission 进 done/degraded/failed 终态。

        Returns:
            1 = 本次触发收敛且 converged_at 落库；0 = 未触发 / 置位被抢占或回滚。
        """
        # 延迟 import 避免与 control/finalizer/delegation 的循环 import 风险
        # （与 orchestrator.schedule_loop 同款处理）。
        from app.modules.agent.control import MissionControlService

        mission = await self._session.get(AgentMission, mission_id)
        if mission is None or mission.converged_at is not None or mission.cancelled_at is not None:
            return 0
        if await _mission_bound_session(self._session, mission) is None:
            return 0
        if await _session_has_active_turn(self._session, mission.session_id):
            # 主控新一轮进行中（会话活跃 turn）→ 非 awaiting_input。
            return 0

        all_runs = await MissionControlService(self._session).worker_runs(mission_id)
        if not all_runs or any(r.status not in _TERMINAL_RUN_STATUSES for r in all_runs):
            # 空集合=planning；有非终态 run=running——均不属 awaiting_input。
            return 0

        # ql-20260825-003：awaiting_input 即「分身全完成、等主控下一轮」——先尝试
        # 系统通知唤醒主控（幂等，lease complete_lease 即时钩子漏报时的兜底）。
        # 通知成功后主控大概率自行收敛，超时自动收敛逻辑保持不变（双保险）。
        try:
            from app.modules.agent.mission_context import (
                notify_orchestrator_workers_done,
                workers_all_terminal_with_stats,
            )

            _done, _ok, _bad = await workers_all_terminal_with_stats(self._session, mission)
            if _done:
                await notify_orchestrator_workers_done(
                    mission_id, mission.session_id, completed=_ok, failed=_bad
                )
        except Exception as exc:
            log.warning(
                "mission_patrol_workers_done_notify_failed",
                mission_id=str(mission_id),
                error=str(exc),
            )

        anchor = max(
            (r for r in all_runs if r.role == _ORCHESTRATOR_ROLE),
            key=lambda r: r.created_at,
            default=None,
        )
        if anchor is None or anchor.finished_at is None:
            # 无主控轮回填 / 时钟缺失：无法定超时起点，跳过不猜（Grill P2-2 同语义）。
            log.debug(
                "mission_patrol_awaiting_input_clock_missing",
                mission_id=str(mission_id),
            )
            return 0
        timeout = timedelta(minutes=get_settings().mission_patrol_awaiting_input_timeout_minutes)
        now = datetime.now(UTC)
        if now - _as_utc(anchor.finished_at) < timeout:
            return 0

        from app.modules.agent.delegation import GLMConfig
        from app.modules.agent.finalizer import converge_mission_for_completed_run

        result_status = await converge_mission_for_completed_run(
            self._session, anchor.id, GLMConfig.from_env(), converge_explicit=True
        )
        # 置位走原子 UPDATE 绕过身份映射（expire_on_commit=False 下内存对象不自动
        # 刷新），refresh 重读判定是否真置位（抢占失败 rowcount=0 / 冲突回滚均未置位）。
        await self._session.refresh(mission)
        if mission.converged_at is not None and result_status in ("done", "degraded", "failed"):
            log.info(
                "mission_patrol_awaiting_input_auto_converged",
                mission_id=str(mission_id),
                anchor_run_id=str(anchor.id),
                status=result_status,
                timeout_minutes=get_settings().mission_patrol_awaiting_input_timeout_minutes,
            )
            return 1
        return 0

    async def _patrol_redispatch(self) -> int:
        """职责② 离线重派（task-04，design §2.2）。

        直接复用既有 ``redispatch_pending_main_runs``（内部过滤 role=orchestrator +
        status=pending + error_code=no_online_daemon 并跳过已取消/已收敛 mission），
        本方法零重派/渲染逻辑重复（taskcard 约束）；巡检周期调用即覆盖
        「daemon 离线期间建的 mission 主 run，daemon 恢复后自动启动」场景。

        Returns:
            成功重派的 run 数（计数透传 round_done，Grill P2-6）。
        """
        return await OrchestratorService(self._session).redispatch_pending_main_runs()

    async def _patrol_zombie(self) -> tuple[int, int]:
        """职责③ 僵尸两阶段（design §2.3；task-05 判死 / task-06 复活 / task-07 豁免解除）。

        判死（存量 external 链路）：项目维度 mission（change_id IS NULL，Grill P1）
        的主 run running + 有 lease + 承载 daemon 持续离线超阈值 →
        failed(orchestrator_zombie) + zombie_marked_at，不收敛（信号豁免期开始）。
        判死双条件 = daemon.status != online AND now - last_heartbeat_at >=
        zombie_after_minutes（D-003 持续离线，R-02 防 status 断连标记滞后）；链路
        断链跳过（Grill P2-2）。

        判死（会话 mission 分流，task-08 / D-008）：会话 mission 判死对象=分身
        run——非终态 + 有 lease + 承载 daemon 持续离线超阈值 + 主控会话无活跃
        turn（主控存续按会话活跃 turn 判定，会话活跃期间不判死）；命中标
        failed(orchestrator_zombie) + finished_at，不写 mission.zombie_marked_at
        （该标记由复活段消费，复活候选仅 role=orchestrator——分身无重派复活
        语义），mission 后续走 awaiting_input 超时自动收敛。会话 mission 主控轮
        （短生命周期 turn run）不进存量主 run 判死。

        复活（task-06）：zombie 主 run 窗口内（now - zombie_marked_at <
        revive_window_minutes）且 daemon 恢复 online → 翻回 running + 清标记 +
        重渲染 prompt 重派；重派失败回滚 zombie 态。豁免解除（task-07）：窗口
        耗尽且 daemon 仍离线 → constraints.zombie_converged=true（走独立 info
        日志，不占 round_done 五计数键——task-02 骨架契约）。

        Returns:
            (zombie_marked, zombie_revived) 计数（对接 run_once 五计数键）。
        """
        settings = get_settings()
        now = datetime.now(UTC)
        zombie_after = timedelta(minutes=settings.mission_patrol_zombie_after_minutes)
        revive_window = timedelta(minutes=settings.mission_patrol_revive_window_minutes)

        # ── 判死段·存量主 run（task-05，task-08 排除会话 mission）──
        # 候选：项目维度 mission（change_id IS NULL）未收敛未取消 + 主 run
        # role=orchestrator AND status='running' 且存在 lease（pending 无 lease 天然
        # 排除——pending+no_online_daemon 归职责②重派，design §2.3）。幂等判重
        # （Grill P2-6）：候选仅取 status='running'，已 failed+zombie 的 run 不再进。
        # task-08：会话 mission（session_id 指向真实 AgentSession）主控轮为短生命
        # 周期 turn run，不进存量主 run 判定——其僵尸判定走下方分身段。
        stmt = (
            select(AgentRun)
            .join(AgentMission, AgentRun.mission_id == AgentMission.id)
            .where(
                AgentMission.change_id.is_(None),
                AgentMission.converged_at.is_(None),
                AgentMission.cancelled_at.is_(None),
                AgentRun.role == _ORCHESTRATOR_ROLE,
                AgentRun.status == "running",
                select(DaemonTaskLease.id)
                .where(DaemonTaskLease.agent_run_id == AgentRun.id)
                .exists(),
                ~select(AgentSession.id).where(AgentSession.id == AgentMission.session_id).exists(),
            )
        )
        runs = (await self._session.execute(stmt)).scalars().all()

        zombie_marked = 0
        for run in runs:
            daemon = await self._resolve_run_daemon(run.id)
            if daemon is None:
                # 链路断链：log debug 跳过不判死，不猜不崩（Grill P2-2）。
                continue
            # 双条件判死：daemon 在线 / 心跳缺失 / 离线未超阈值 → 不动。
            if daemon.status == "online" or daemon.last_heartbeat_at is None:
                continue
            if now - _as_utc(daemon.last_heartbeat_at) < zombie_after:
                continue

            run.status = "failed"
            run.error_code = ZOMBIE_ERROR_CODE
            run.finished_at = now
            self._session.add(run)
            mission = await self._session.get(AgentMission, run.mission_id)
            if mission is not None:
                # constraints 整体换新 dict 让 SQLAlchemy 标脏（constraints 可能
                # None 先建 dict，D-005 键复用模式）；不触发收敛——两阶段第一阶段。
                mission.constraints = {
                    **(mission.constraints or {}),
                    ZOMBIE_MARKED_AT_KEY: now.isoformat(),
                }
                self._session.add(mission)
            zombie_marked += 1
            log.info(
                "mission_patrol_zombie_marked",
                mission_id=str(run.mission_id),
                run_id=str(run.id),
                daemon_id=str(daemon.id),
                last_heartbeat_at=str(daemon.last_heartbeat_at),
            )

        # ── 判死段·会话 mission 分身（task-08，design §5 Phase 1 / D-008）──
        # 候选：会话 mission（session_id 指向真实 AgentSession 行）未收敛未取消 +
        # 分身 run（role!='orchestrator' 含 NULL——SQL 三值逻辑下 ``!=`` 漏 NULL
        # 行，须显式 ``role IS NULL OR`` 守卫）非终态且存在 lease。判死条件与
        # 存量段同款 daemon 双条件 + 「主控会话无活跃 turn」；不写 mission
        # zombie 标记（复活段候选仅 role=orchestrator，见 docstring）。
        session_stmt = (
            select(AgentRun)
            .join(AgentMission, AgentRun.mission_id == AgentMission.id)
            .where(
                AgentMission.converged_at.is_(None),
                AgentMission.cancelled_at.is_(None),
                select(AgentSession.id).where(AgentSession.id == AgentMission.session_id).exists(),
                or_(AgentRun.role.is_(None), AgentRun.role != _ORCHESTRATOR_ROLE),
                AgentRun.status.notin_(_TERMINAL_RUN_STATUSES),
                select(DaemonTaskLease.id)
                .where(DaemonTaskLease.agent_run_id == AgentRun.id)
                .exists(),
            )
        )
        session_runs = (await self._session.execute(session_stmt)).scalars().all()

        # 同 mission 多分身共享「会话活跃 turn」判定，逐 mission 查一次缓存复用。
        session_active_cache: dict[uuid.UUID, bool] = {}
        for run in session_runs:
            daemon = await self._resolve_run_daemon(run.id)
            if daemon is None:
                continue
            if daemon.status == "online" or daemon.last_heartbeat_at is None:
                continue
            if now - _as_utc(daemon.last_heartbeat_at) < zombie_after:
                continue
            mission = await self._session.get(AgentMission, run.mission_id)
            if mission is None:
                continue
            if mission.session_id is None:
                continue
            if mission.session_id not in session_active_cache:
                session_active_cache[mission.session_id] = await _session_has_active_turn(
                    self._session, mission.session_id
                )
            if session_active_cache[mission.session_id]:
                # 主控会话有活跃 turn：主控本轮还活着（可能仍在等该分身），不判死。
                continue

            run.status = "failed"
            run.error_code = ZOMBIE_ERROR_CODE
            run.finished_at = now
            self._session.add(run)
            zombie_marked += 1
            log.info(
                "mission_patrol_zombie_marked_session_worker",
                mission_id=str(run.mission_id),
                run_id=str(run.id),
                role=run.role,
                daemon_id=str(daemon.id),
                last_heartbeat_at=str(daemon.last_heartbeat_at),
            )

        if zombie_marked:
            await self._session.commit()

        # ── 复活段（task-06，D-004 两阶段后半段）──
        # 候选：failed + error_code=orchestrator_zombie 的主 run（zombie 标记态由
        # 判死段写入）。同轮先判复活再判耗尽（task-07 填充 else 分支）。
        zombie_stmt = (
            select(AgentRun)
            .join(AgentMission, AgentRun.mission_id == AgentMission.id)
            .where(
                AgentMission.converged_at.is_(None),
                AgentMission.cancelled_at.is_(None),
                AgentRun.role == _ORCHESTRATOR_ROLE,
                AgentRun.status == "failed",
                AgentRun.error_code == ZOMBIE_ERROR_CODE,
            )
        )
        zombie_runs = (await self._session.execute(zombie_stmt)).scalars().all()

        zombie_revived = 0
        exempt_released = 0
        for run in zombie_runs:
            mission = await self._session.get(AgentMission, run.mission_id)
            if mission is None:
                continue
            marked_at = _zombie_marked_at(mission)
            if marked_at is None:
                # 标记缺失/损坏：无法判窗口，跳过不猜（对齐断链语义）。
                log.debug(
                    "mission_patrol_zombie_marker_missing",
                    mission_id=str(mission.id),
                    run_id=str(run.id),
                )
                continue
            daemon = await self._resolve_run_daemon(run.id)
            if daemon is None:
                continue
            if now - marked_at < revive_window:
                # 窗口内 + daemon 恢复 online → 复活；仍离线/断链 → 等待窗口。
                if daemon.status != "online":
                    continue
                zombie_revived += await self._revive_zombie_run(run, mission, marked_at, now)
            elif daemon.status != "online" and not (mission.constraints or {}).get(
                ZOMBIE_CONVERGED_KEY
            ):
                # 豁免解除（task-07）：窗口耗尽 + daemon 仍离线 → zombie_converged=true
                # 解除信号 1 豁免（下轮 schedule_loop 视主 run 终态 failed 正常收敛）。
                # daemon 已恢复在线的走复活路径（两分支互斥）；zombie_marked_at 保留作
                # 审计。写后不再干预该 run（不清 error_code / 不重派 / 不直接收敛）。
                mission.constraints = {
                    **(mission.constraints or {}),
                    ZOMBIE_CONVERGED_KEY: True,
                }
                self._session.add(mission)
                exempt_released += 1
                log.info(
                    "mission_patrol_zombie_exemption_released",
                    mission_id=str(mission.id),
                    run_id=str(run.id),
                    zombie_marked_at=str(mission.constraints.get(ZOMBIE_MARKED_AT_KEY)),
                )

        if exempt_released:
            await self._session.commit()

        return zombie_marked, zombie_revived

    async def _patrol_worker_recovery(self) -> int:
        """职责④：worker 断线恢复（ql-20260825-003 / 设计：恢复优先于重派）。

        背景：worker 的 per-lease 运行（``daemon_task_leases.kind='batch'``）在
        daemon 网络断开时会被后端标 failed/killed，但 daemon 侧实际可能已跑完
        （stdout/产物已写 checkpoint）。直接 ``resume_run`` 重置 pending 会让
        daemon 重跑一次——浪费。正确序：①若 run 已有 ``checkpoint_data`` 且其
        中捕获了终态（网络断开前已写到 checkpoint 的产物），→ 补发终态（经
        ``DaemonService.sync_agent_run_status``，幂等，非终态回退被守卫）；②
        否则才走 ``ExecutionCoordinator.resume_run``（重置 pending，daemon 恢复
        后重跑）。

        候选 run 判据：``status ∈ {failed, killed}`` 且 ``mission_id`` 非空且
        属于「会话 mission」（session_id 指向真实 AgentSession——本次主修的
        会话团队场景；存量 external/team mission 的 worker 仍由 legacy 僵尸
        链路管，不重复处理）且 ``role != 'orchestrator'``（主控轮专属
        redispatch_pending_main_runs 链路负责，不重复）。

        恢复只按本职责计数进 ``worker_recovered``；简历定的 run 由 daemon
        侧重连后 outbox drain 补发终态（FileOutbox 持久化，R-07/R-10 既有
        语义）。

        Returns:
            本轮恢复的 run 数（补发 + resume 合计）。
        """
        from app.modules.agent.coordinator import ExecutionCoordinatorService
        from app.modules.agent.model import AgentMission as _Mission
        from app.modules.daemon.service import DaemonService

        stmt = (
            select(AgentRun)
            .where(
                col(AgentRun.status).in_(["failed", "killed"]),
                col(AgentRun.mission_id).is_not(None),
                col(AgentRun.role) != "orchestrator",
                col(AgentRun.agent_session_id).is_not(None),  # 会话 mission 锚
            )
            .order_by(AgentRun.created_at.desc())
            .limit(50)
        )
        runs = list((await self._session.execute(stmt)).scalars().all())
        if not runs:
            return 0

        recovered = 0
        coord = ExecutionCoordinatorService(self._session)
        for run in runs:
            # 会话 mission 判别（Grill NEW-4 口径：session_id 查真实会话行）。
            mission = await self._session.get(_Mission, run.mission_id)
            if mission is None or mission.session_id is None:
                continue
            if await _mission_bound_session(self._session, mission) is None:
                continue
            if mission.converged_at is not None or mission.cancelled_at is not None:
                continue

            # ① 补发终态（不重跑）：checkpoint_data 快照里已有 daemon 完成的产物。
            if run.checkpoint_data and isinstance(run.checkpoint_data, dict):
                cp_status = run.checkpoint_data.get("status")
                if cp_status in ("completed", "failed", "killed"):
                    lease = await self._resolve_run_lease_for_sync(run.id)
                    if lease is not None:
                        try:
                            await DaemonService(self._session).sync_agent_run_status(
                                lease.id,
                                lease.claim_token or "",
                                cp_status,
                                error=run.checkpoint_data.get("error"),
                            )
                            recovered += 1
                            continue
                        except Exception as exc:
                            log.warning(
                                "mission_patrol_worker_sync_failed",
                                run_id=str(run.id),
                                error=str(exc),
                            )

            # ② 未完成（无 checkpoint 终态快照）→ resume 重置 pending，daemon
            # 恢复后重跑。resume_run 仅接 failed/killed（显式守卫，不猜）。
            try:
                await coord.resume_run(run.id, run.resume_token or "")
                recovered += 1
            except Exception as exc:
                # resume_token 缺失 / 状态不符 / token 校验失败：记 warn 跳过，
                # 下轮 patrol 或人工介入；不翻转既有 failed/killed 终态。
                log.warning(
                    "mission_patrol_worker_resume_failed",
                    run_id=str(run.id),
                    error=str(exc),
                )
        return recovered

    async def _patrol_orphan_subsessions(self) -> int:
        """职责⑤：孤儿子会话扫描补收口（task-12 / FR-06 / design §5.D 末行）。

        独立查询（方向与 ``_active_mission_ids`` 相反，绝不共用名单——那是活跃
        mission 集合）：converged_at / cancelled_at 任一非空的**终态** mission，
        经 ``mission_worker_sessions`` 一层枚举分身子会话（枚举单一真相源，
        不过滤 status——过滤语义归调用方），取仍活跃者（词表复用
        ``control._ACTIVE_SESSION_STATUSES`` = pending/active/reconnecting，与
        task-11 cancel 沿树收口同源，不另写判据）逐个补发
        ``SessionService.end_session``（user_id=子会话属主 session.user_id，
        reason=``mission_terminal_orphan``）——子会话 ended + interactive lease
        completed + P0-2 SESSION_END WS best-effort 下发（end_session 自带幂等
        与收口链，不重造 kill 逻辑、不直接翻 DB 会话状态，TaskCard 约束）。
        兜底 task-10 converge 批量收口 best-effort 部分失败与 cancel 链漏网。

        - 查询自带 limit（对齐 ``ACTIVE_MISSION_LIMIT`` 惯例）：终态 mission 持续
          积累，防单轮过载；created_at 升序 = 老 mission 先补，溢出留待下轮。
        - best-effort：单个收口失败 log.warning 继续下一个（对齐 task-10
          收口语义）；职责整体异常由 run_once 的 try/except 兜底，不阻断同轮
          其余职责。预取 (id, user_id) 标量后才进收口循环——end_session 失败
          分支 rollback 会 expire 会话内全部实例，循环内再访问 ORM 属性触发
          隐式同步 refresh（asyncio 下 MissingGreenlet，task-10 同款防护）。
        - 存量 mission（session_id 查无会话行 / 根下无子会话）枚举空集 no-op
          返 0（FR-09 零行为变化）；活跃 mission 不进查询名单，子会话绝不被碰。

        Returns:
            本轮成功补收口的孤儿子会话数（对接 run_once orphan_sessions_ended）。
        """
        # 延迟 import 对齐本文件 control / daemon.session.service 既有防循环
        # 模式（task-10 helper 同款：SessionService 依赖链宽）。
        from app.modules.agent.control import _ACTIVE_SESSION_STATUSES
        from app.modules.daemon.session.service import SessionService

        stmt = (
            select(AgentMission.id)
            .where(
                or_(
                    AgentMission.converged_at.is_not(None),
                    AgentMission.cancelled_at.is_not(None),
                )
            )
            .order_by(AgentMission.created_at)
            .limit(ACTIVE_MISSION_LIMIT)
        )
        mission_ids = list((await self._session.execute(stmt)).scalars().all())
        if not mission_ids:
            return 0

        svc = SessionService(self._session)
        ended = 0
        for mission_id in mission_ids:
            workers = await mission_worker_sessions(self._session, mission_id)
            # 只取仍活跃子会话；预取属主标量（MissingGreenlet 防护见 docstring）。
            active_workers = [
                (w.id, w.user_id) for w in workers if w.status in _ACTIVE_SESSION_STATUSES
            ]
            for worker_id, owner_id in active_workers:
                try:
                    await svc.end_session(worker_id, owner_id, reason="mission_terminal_orphan")
                    ended += 1
                    log.info(
                        "mission_patrol_orphan_session_ended",
                        mission_id=str(mission_id),
                        worker_session_id=str(worker_id),
                        reason="mission_terminal_orphan",
                    )
                except Exception as exc:
                    # best-effort：单个失败（lease 绑定异常 / daemon 离线抛出）只记
                    # warning 继续下一个，残留孤儿下轮扫描再补（TaskCard 约束）。
                    log.warning(
                        "mission_patrol_orphan_end_failed",
                        mission_id=str(mission_id),
                        worker_session_id=str(worker_id),
                        error=str(exc),
                    )
        return ended

    async def _resolve_run_lease_for_sync(self, run_id: uuid.UUID) -> DaemonTaskLease | None:
        """worker 断线恢复的 lease 解析：取该 run 最新 lease（与
        ``_resolve_run_daemon`` 同款按 updated_at 倒序），链路断链返回 None
        由调用方跳过（不猜不崩，同 Grill P2-2）。
        """
        return (
            (
                await self._session.execute(
                    select(DaemonTaskLease)
                    .where(DaemonTaskLease.agent_run_id == run_id)
                    .order_by(DaemonTaskLease.updated_at.desc())
                    .limit(1)
                )
            )
            .scalars()
            .first()
        )

    async def _resolve_run_daemon(self, agent_run_id: uuid.UUID) -> DaemonInstance | None:
        """判死/复活动作共用的链路解析：run → 最新 lease → runtime → daemon 实体。

        最新 lease = ``daemon_task_leases.agent_run_id`` 过滤后按 ``updated_at``
        倒序取 1（design §2.3 判死链路）。链路断链（lease 无 runtime_id / runtime
        行不存在 / runtime.daemon_instance_id NULL（迁移期遗留）/ daemon 行不存在）
        → log debug 返回 None，调用方跳过该 run 不判死不猜不崩（Grill P2-2）。
        """
        lease = (
            (
                await self._session.execute(
                    select(DaemonTaskLease)
                    .where(DaemonTaskLease.agent_run_id == agent_run_id)
                    .order_by(DaemonTaskLease.updated_at.desc())
                    .limit(1)
                )
            )
            .scalars()
            .first()
        )
        if lease is None or lease.runtime_id is None:
            log.debug(
                "mission_patrol_zombie_chain_broken",
                agent_run_id=str(agent_run_id),
                missing="lease_or_runtime_id",
            )
            return None
        runtime = await self._session.get(DaemonRuntime, lease.runtime_id)
        if runtime is None or runtime.daemon_instance_id is None:
            log.debug(
                "mission_patrol_zombie_chain_broken",
                agent_run_id=str(agent_run_id),
                missing="runtime_or_instance_id",
            )
            return None
        daemon = await self._session.get(DaemonInstance, runtime.daemon_instance_id)
        if daemon is None:
            log.debug(
                "mission_patrol_zombie_chain_broken",
                agent_run_id=str(agent_run_id),
                missing="daemon_instance",
            )
            return None
        return daemon

    async def _revive_zombie_run(
        self,
        run: AgentRun,
        mission: AgentMission,
        marked_at: datetime,
        now: datetime,
    ) -> int:
        """复活单个 zombie 主 run（task-06，design §2.3 复活分支）。

        run 翻回 running + 清 error_code/finished_at + 移除 zombie_marked_at，
        重渲染 ``render_orchestrator_prompt`` 后 ``dispatch_to_daemon`` 重派 lease
        （传参对齐 orchestrator.redispatch_pending_main_runs 重派块：run.id、
        mission.created_by、workspace_id、_resolve_main_agent_config 的
        provider/model/agent_profile_id、stage=orchestrator、read_only=False）。

        重派抛 ``NoOnlineDaemonError`` → 回滚 zombie 态并 commit（status 回 failed
        + error_code 回 orchestrator_zombie + finished_at 恢复 + zombie_marked_at
        写回原时间戳），不出现"既非 zombie 又未重派"的中间态（taskcard 约束）。
        旧 claimed interactive lease 残留是 R-06 known 边界（claim 侧归属校验保安全）。

        Returns:
            1 = 复活成功（重派成功）；0 = 重派失败已回滚 zombie 态。
        """
        cfg = _resolve_main_agent_config(mission.main_agent_config)
        run.status = "running"
        run.error_code = None
        run.finished_at = None
        mission.constraints = {
            key: value
            for key, value in (mission.constraints or {}).items()
            if key != ZOMBIE_MARKED_AT_KEY
        }
        self._session.add(run)
        self._session.add(mission)
        try:
            placement = RunPlacementService(self._session)
            lease_id = await placement.dispatch_to_daemon(
                run.id,
                mission.created_by,
                workspace_id=mission.workspace_id,
                provider=cfg["provider"] or None,
                model=cfg["model"] or None,
                prompt=await render_orchestrator_prompt(mission, run, self._session),
                stage=_ORCHESTRATOR_ROLE,
                read_only=False,
                agent_profile_id=cfg["agent_profile_id"],
            )
        except NoOnlineDaemonError as exc:
            # 回滚 zombie 态：zombie_marked_at 写回原时间戳（保真窗口语义，不刷新）。
            run.status = "failed"
            run.error_code = ZOMBIE_ERROR_CODE
            run.finished_at = now
            mission.constraints = {
                **(mission.constraints or {}),
                ZOMBIE_MARKED_AT_KEY: marked_at.isoformat(),
            }
            self._session.add(run)
            self._session.add(mission)
            await self._session.commit()
            log.warning(
                "mission_patrol_zombie_revive_dispatch_failed",
                mission_id=str(mission.id),
                run_id=str(run.id),
                message=exc.message,
            )
            return 0
        await self._session.commit()
        log.info(
            "mission_patrol_zombie_revived",
            mission_id=str(mission.id),
            run_id=str(run.id),
            lease_id=str(lease_id) if lease_id else None,
        )
        return 1

    @classmethod
    async def loop(cls) -> None:
        """常驻巡检循环（lifespan 经模块级 ``mission_patrol_loop`` 接线，task-09）。

        - ``mission_patrol_enabled`` 为 False 时循环体一次不进，直接返回（零回归）。
        - 每轮计时调 ``run_once``，结束打 ``mission_patrol_round_done`` 结构化日志
          （五计数 + duration_ms，FR-04.2）。
        - 单轮整体失败只记 ``mission_patrol_round_failed``，不崩循环；
          ``asyncio.CancelledError`` 属 BaseException，不被 ``except Exception`` 吞，
          cancel 时干净退出（design §4 关停契约）。
        """
        while get_settings().mission_patrol_enabled:
            started = time.perf_counter()
            try:
                async with get_session_factory()() as session:
                    counts = await cls(session).run_once()
                log.info(
                    "mission_patrol_round_done",
                    duration_ms=round((time.perf_counter() - started) * 1000, 2),
                    **counts,
                )
            except Exception:
                log.exception("mission_patrol_round_failed")
            # cancel 透传：sleep 是循环唯一的常规挂起点，CancelledError 必须穿出
            # 循环保证 task-09 的 cancel + await 干净落地。
            try:
                await asyncio.sleep(get_settings().mission_patrol_interval_seconds)
            except asyncio.CancelledError:
                raise


async def mission_patrol_loop() -> None:
    """mission 巡检常驻协程入口（task-09 main.py lifespan ``create_task`` 消费）。

    对齐 ``monitoring.start_event_loop_watchdog`` 常驻协程模式；关停由调用方
    ``task.cancel()`` + ``await asyncio.gather(task, return_exceptions=True)``
    落地（design §4，比 watchdog 的 fire-and-forget cancel 严谨——巡检轮内有
    DB 写，须等取消落地）。
    """
    await MissionPatrolService.loop()
