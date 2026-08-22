"""Mission control plane — governance (Wave 4, 2026-06-19-multi-agent-orchestration).

Budget / concurrency / cancellation / partial-failure policies for a Mission,
operating on the Wave 1 data model. Status stays derived (``derive_status``);
this service only enforces gates and mutates cancellation.

- Budget (brainstorm 坑 4): before dispatching a Worker, check cumulative cost
  vs ``Mission.budget_usd``; exceeding refuses new Workers (a convergence
  signal, not an error).
- Concurrency: cap active Workers at ``MAX_WORKERS``.
- Cancellation: mark ``cancelled_at`` + kill active child Runs.
- Partial failure (D6): handled by ``derive_status`` → ``degraded`` (not here).

2026-08-22-team-session-unify task-07（design §5 D-009 / 审查 B3 / D-007@v2）：
治理口径（并发额度 / 成本 / kill 对象）统一收窄为仅分身 run
（``non_orchestrator_runs``，NULL role 三值逻辑守卫）——主控轮
（role='orchestrator'）回填 mission_id 后不占 MAX_WORKERS、不计分身成本、
不进 cancel kill 名单；``worker_runs`` 保持全量供主控锚点 / derive 消费。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import col

from app.core.logging import get_logger
from app.modules.agent.delegation import MAX_WORKERS
from app.modules.agent.model import AgentMission, AgentRun

log = get_logger(__name__)

_ACTIVE = ("pending", "running")

# 主控轮标记（2026-08-22-team-session-unify task-07 / D-009，design §5 核心机制）：
# role='orchestrator' 的 mission run 是主控轮（存量 external mission 同标记）。
_ORCHESTRATOR_ROLE = "orchestrator"


class MissionControlService:
    """Enforces budget / concurrency / cancellation gates for a Mission."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def worker_runs(self, mission_id: uuid.UUID) -> list[AgentRun]:
        """Mission 下**全量** run（含主控轮）。

        消费方：orchestrator.py schedule_loop 主控锚点（``role == 'orchestrator'``
        的 main_run 查找）与 finalizer.py converge 的 derive_status 输入——两者
        依赖全量，故本方法不收窄。治理口径（并发额度/成本/kill 对象）一律走
        ``non_orchestrator_runs``（task-07 / D-009，审查 B3）。
        """
        stmt = select(AgentRun).where(col(AgentRun.mission_id) == mission_id)
        return list((await self._session.execute(stmt)).scalars().all())

    async def non_orchestrator_runs(self, mission_id: uuid.UUID) -> list[AgentRun]:
        """Mission 下仅**分身** run（role 非 orchestrator，含 NULL role）。

        2026-08-22-team-session-unify task-07（design §5 核心机制 D-009 / 审查 B3）：
        主控轮回填 mission_id 后不占 MAX_WORKERS 并发额度、不计入分身成本、不进
        cancel kill 名单——治理门/成本/workers 列表的统一口径。

        NULL role 守卫：AgentRun.role 可空（存量分身 run），SQL 三值逻辑下
        ``role != 'orchestrator'`` 会漏掉 NULL 行，须显式 ``role IS NULL OR ...``
        （D-007@v2 / R-08 存量规则统一）。
        """
        stmt = select(AgentRun).where(
            col(AgentRun.mission_id) == mission_id,
            or_(
                col(AgentRun.role).is_(None),
                col(AgentRun.role) != _ORCHESTRATOR_ROLE,
            ),
        )
        return list((await self._session.execute(stmt)).scalars().all())

    @staticmethod
    def cost_from_runs(runs: list[AgentRun]) -> float:
        """第六批：从内存 runs 直接求 cost（与 cost_so_far 同公式），供调用方复用
        已 fetch 的 runs 避免「worker_runs 后又 cost_so_far 再 SELECT 一遍」的冗余。

        注意（task-07）：求和口径 = 传入的 runs 本身——治理预算口径请传
        ``non_orchestrator_runs`` 结果；orchestrator.py 信号 3 预算强收等需要全量
        成本的调用方传 ``worker_runs`` 结果，两者由调用方按语义选择。
        """
        return sum(r.total_cost_usd or 0.0 for r in runs)

    async def cost_so_far(self, mission_id: uuid.UUID) -> float:
        """Sum of ``total_cost_usd`` across the Mission's Worker Runs.

        task-07（D-009）：仅累计分身 run 成本，主控轮不计入（审查 B3）。
        """
        return self.cost_from_runs(await self.non_orchestrator_runs(mission_id))

    async def active_worker_count(self, mission_id: uuid.UUID) -> int:
        runs = await self.non_orchestrator_runs(mission_id)
        return sum(1 for r in runs if r.status in _ACTIVE)

    async def running_worker_count(self, mission_id: uuid.UUID) -> int:
        """Count Workers already claimed by a daemon (``running``) — concurrency basis.

        Distinct from ``active_worker_count`` (pending+running, used by cancel): the
        dispatch gate limits *concurrently running* daemon processes, not pending
        (not-yet-dispatched) Runs — otherwise a flat mission of N pending Workers
        trips ``max_workers`` before any dispatch happens (2026-06-28 D-008@v1).

        task-07（D-009 / 审查 B3）：仅统计分身 run——主控轮（role='orchestrator'，
        含 running 态）不占 MAX_WORKERS 并发额度。
        """
        runs = await self.non_orchestrator_runs(mission_id)
        return sum(1 for r in runs if r.status == "running")

    async def can_dispatch_worker(self, mission: AgentMission) -> tuple[bool, str]:
        """Pre-dispatch gate. Returns ``(allowed, reason)``.

        ``reason`` is ``ok`` when allowed, otherwise one of:
        ``mission_cancelled | max_workers_reached | budget_exceeded``.

        Concurrency uses ``running_worker_count`` (claimed by daemon), NOT
        ``active_worker_count`` (pending+running) — see D-008@v1.
        """
        if mission.cancelled_at is not None:
            return False, "mission_cancelled"
        if await self.running_worker_count(mission.id) >= MAX_WORKERS:
            return False, "max_workers_reached"
        if (
            mission.budget_usd is not None
            and await self.cost_so_far(mission.id) >= mission.budget_usd
        ):
            return False, "budget_exceeded"
        return True, "ok"

    async def cancel(self, mission: AgentMission) -> int:
        """Cancel a Mission: mark ``cancelled_at`` + kill active child Runs.

        委托 ``DaemonLeaseService.cancel_lease`` 收尾每个 active Worker，确保 daemon
        真收到取消信号（batch 走心跳 SIGTERM、interactive 走 WS SESSION_INTERRUPT）。
        ql-20260712-001（审计 P0-2）：旧实现只 flip ``AgentRun.status`` 不通知 daemon，
        worker 继续跑成僵尸 lease。``cancel_lease`` 内部已含"标记 killed + lease
        cancelled + 发信号"，对无 active lease 的 run 也走 ``_mark_agent_run_killed_if_pending``
        兜底标记，故覆盖旧手动 status flip 的全部场景。

        Returns the number of Runs killed.

        task-07（D-009 / design §7.5）：kill 对象仅为分身 run（``non_orchestrator_runs``，
        含 NULL role）——主控轮非分身，不进 kill 名单；存量 external mission 规则
        同步统一（R-08）。
        """
        # lazy import：agent.control → daemon.lease_service，避免顶层循环 import
        from app.modules.daemon.lease_service import DaemonLeaseService

        mission.cancelled_at = datetime.now(UTC)
        self._session.add(mission)
        await self._session.commit()

        lease_svc = DaemonLeaseService(self._session)
        killed = 0
        for r in await self.non_orchestrator_runs(mission.id):
            if r.status not in _ACTIVE:
                continue
            try:
                await lease_svc.cancel_lease(r.id)
                killed += 1
            except Exception as exc:
                log.warning(
                    "mission_cancel_worker_failed",
                    mission_id=str(mission.id),
                    run_id=str(r.id),
                    error=str(exc),
                )
        log.info("mission_cancelled", mission_id=str(mission.id), killed=killed)
        return killed
