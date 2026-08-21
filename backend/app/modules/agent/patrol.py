"""mission 收敛巡检服务（2026-08-21-mission-converge-patrol task-02 骨架）。

设计定位（design §2）：lifespan 常驻协程（对齐 ``monitoring`` watchdog 协程模式），
每轮顺序执行三职责，异常隔离双层——单 mission 隔离（FR-01.2）+ 三职责间互不阻断：

1. 收敛兜底（task-03）：活跃 mission 逐个 ``schedule_loop``（幂等，converged 计数）。
2. 离线重派（task-04）：``redispatch_pending_main_runs`` 覆盖 daemon 恢复场景。
3. 僵尸两阶段（task-05/06/07）：判死 / 复活 / 豁免解除。

task-02 落骨架（循环 / 活跃查询 limit 100 / 异常隔离框架 / ``mission_patrol_round_done``
日志 / 每轮独立短 session——``get_session_factory()()`` async with，轮间不长期持连接，
对齐 complete_lease 请求路径生命周期，D-001/D-002）；task-03~07 依次接线三职责。
"""

from __future__ import annotations

import asyncio
import time
import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.db import get_session_factory
from app.core.logging import get_logger
from app.modules.agent.model import AgentMission, AgentRun
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

# run_once 返回 / round_done 日志共用的五计数键（FR-04.2）。
PATROL_COUNT_KEYS = (
    "checked",
    "converged",
    "redispatched",
    "zombie_marked",
    "zombie_revived",
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
        """单 mission 收敛兜底（task-03，design §2.1）：``schedule_loop`` 幂等巡检。

        返回 ``str`` = 收敛后 mission status（done/degraded/...）、``None`` = 本轮
        未触发收敛（orchestrator.py schedule_loop 返回值语义）。external / single
        模式无主 run → 内部跳过返回 None，本方法零额外过滤（taskcard 约束）。

        Returns:
            本 mission 本轮是否触发收敛（1 / 0）。
        """
        status = await OrchestratorService(self._session).schedule_loop(mission_id)
        return 1 if status is not None else 0

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

        判死：项目维度 mission（change_id IS NULL，Grill P1）的主 run running + 有
        lease + 承载 daemon 持续离线超阈值 → failed(orchestrator_zombie) +
        zombie_marked_at，不收敛（信号豁免期开始）。判死双条件 = daemon.status !=
        online AND now - last_heartbeat_at >= zombie_after_minutes（D-003 持续离线，
        R-02 防 status 断连标记滞后）；链路断链跳过（Grill P2-2）。

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

        # ── 判死段（task-05）──
        # 候选：项目维度 mission（change_id IS NULL）未收敛未取消 + 主 run
        # role=orchestrator AND status='running' 且存在 lease（pending 无 lease 天然
        # 排除——pending+no_online_daemon 归职责②重派，design §2.3）。幂等判重
        # （Grill P2-6）：候选仅取 status='running'，已 failed+zombie 的 run 不再进。
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
