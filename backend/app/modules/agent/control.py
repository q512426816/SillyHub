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
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import col

from app.core.logging import get_logger
from app.modules.agent.delegation import MAX_WORKERS
from app.modules.agent.model import AgentMission, AgentRun

log = get_logger(__name__)

_ACTIVE = ("pending", "running")


class MissionControlService:
    """Enforces budget / concurrency / cancellation gates for a Mission."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def worker_runs(self, mission_id: uuid.UUID) -> list[AgentRun]:
        stmt = select(AgentRun).where(col(AgentRun.mission_id) == mission_id)
        return list((await self._session.execute(stmt)).scalars().all())

    async def cost_so_far(self, mission_id: uuid.UUID) -> float:
        """Sum of ``total_cost_usd`` across the Mission's Worker Runs."""
        runs = await self.worker_runs(mission_id)
        return sum(r.total_cost_usd or 0.0 for r in runs)

    async def active_worker_count(self, mission_id: uuid.UUID) -> int:
        runs = await self.worker_runs(mission_id)
        return sum(1 for r in runs if r.status in _ACTIVE)

    async def running_worker_count(self, mission_id: uuid.UUID) -> int:
        """Count Workers already claimed by a daemon (``running``) — concurrency basis.

        Distinct from ``active_worker_count`` (pending+running, used by cancel): the
        dispatch gate limits *concurrently running* daemon processes, not pending
        (not-yet-dispatched) Runs — otherwise a flat mission of N pending Workers
        trips ``max_workers`` before any dispatch happens (2026-06-28 D-008@v1).
        """
        runs = await self.worker_runs(mission_id)
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
        """
        # lazy import：agent.control → daemon.lease_service，避免顶层循环 import
        from app.modules.daemon.lease_service import DaemonLeaseService

        mission.cancelled_at = datetime.now(UTC)
        self._session.add(mission)
        await self._session.commit()

        lease_svc = DaemonLeaseService(self._session)
        killed = 0
        for r in await self.worker_runs(mission.id):
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
