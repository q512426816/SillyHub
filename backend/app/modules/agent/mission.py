"""Mission aggregation + status derivation (2026-06-19-multi-agent-orchestration).

Wave 1: ``derive_status`` — Mission status is NOT persisted, derived from child
AgentRuns so the source of truth stays AgentRun + Lease (no second state system).
Wave 2: ``MissionService.start_mission`` — create a Mission, plan Worker
delegations via a direct GLM call (CoordinatorPlanner), and persist pending
Worker Runs. Worker *execution* (daemon dispatch) is Wave 3.
"""

from __future__ import annotations

import uuid
from collections.abc import Iterable
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.modules.agent.delegation import CoordinatorPlanner, DelegationError
from app.modules.agent.model import AgentMission, AgentRun

log = get_logger(__name__)

_ACTIVE = {"pending", "running"}
_DONE = {"completed"}
_FAILED = {"failed", "killed"}


def derive_status(runs: Iterable[AgentRun], cancelled: bool = False) -> str:
    """Derive Mission status from its child AgentRuns.

    Returns one of: ``planning | running | degraded | done | failed | cancelled``.

    - ``cancelled``: mission explicitly cancelled (``cancelled_at`` set).
    - ``planning``: no child runs yet.
    - ``running``: any child run still pending/running.
    - ``done``: all terminal, at least one completed, none failed.
    - ``degraded``: all terminal, at least one completed AND at least one failed.
    - ``failed``: all terminal, none completed.
    """
    if cancelled:
        return "cancelled"
    statuses = [r.status for r in runs]
    if not statuses:
        return "planning"
    if any(s in _ACTIVE for s in statuses):
        return "running"
    has_completed = any(s in _DONE for s in statuses)
    has_failed = any(s in _FAILED for s in statuses)
    if has_completed and has_failed:
        return "degraded"
    if has_completed:
        return "done"
    return "failed"


class MissionService:
    """Create + plan a multi-agent Mission (Wave 2).

    Planning is a direct GLM call (``CoordinatorPlanner``); Worker execution is
    Wave 3 (daemon dispatch). This service only persists the Mission + pending
    Worker Runs (flat — no inter-worker DAG edges in v1; Finalizer dependency
    wiring lands in Wave 3).
    """

    def __init__(self, session: AsyncSession, planner: CoordinatorPlanner | None = None) -> None:
        self._session = session
        self._planner = planner

    async def start_mission(
        self,
        *,
        workspace_id: uuid.UUID,
        objective: str,
        created_by: uuid.UUID | None = None,
        change_id: uuid.UUID | None = None,
        constraints: dict[str, Any] | None = None,
        budget_tokens: int | None = None,
        budget_usd: float | None = None,
        planner: CoordinatorPlanner | None = None,
    ) -> tuple[AgentMission, list[AgentRun]]:
        """Plan delegations and persist Mission + pending Worker Runs.

        Returns ``(mission, worker_runs)``. Workers stay ``pending`` until Wave 3
        dispatches them to a daemon.
        """
        active_planner = planner or self._planner
        if active_planner is None:
            raise DelegationError("MissionService requires a CoordinatorPlanner")
        coordinator_summary, delegations = await active_planner.plan(objective, constraints)

        # 存 Coordinator 拆解 summary 到 constraints（供前端展示拆解结果，无 migration，
        # 2026-06-28：让"Coordinator 拆解"从黑盒变为页面可见）。
        merged_constraints: dict[str, Any] = dict(constraints or {})
        if coordinator_summary:
            merged_constraints["coordinator_summary"] = coordinator_summary

        mission = AgentMission(
            workspace_id=workspace_id,
            change_id=change_id,
            objective=objective,
            constraints=merged_constraints,
            budget_tokens=budget_tokens,
            budget_usd=budget_usd,
            created_by=created_by,
        )
        self._session.add(mission)
        await self._session.commit()
        await self._session.refresh(mission)

        runs: list[AgentRun] = []
        for d in delegations:
            run = AgentRun(
                mission_id=mission.id,
                change_id=change_id,
                agent_type="claude_code",
                status="pending",
                role=d.role,
                objective=d.objective,
            )
            self._session.add(run)
            runs.append(run)
        await self._session.commit()
        for r in runs:
            await self._session.refresh(r)

        log.info(
            "mission_started",
            mission_id=str(mission.id),
            workers=len(runs),
            roles=[d.role for d in delegations],
        )
        return mission, runs
