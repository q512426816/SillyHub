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

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import col

from app.core.logging import get_logger
from app.modules.agent.delegation import CoordinatorPlanner, DelegationError
from app.modules.agent.model import AgentMission, AgentRun

log = get_logger(__name__)

_ACTIVE = {"pending", "running"}
_DONE = {"completed"}
_FAILED = {"failed", "killed"}


def derive_status(
    runs: Iterable[AgentRun],
    cancelled: bool = False,
    *,
    converged: bool = False,
    has_session: bool = False,
    session_active_turn: bool = False,
) -> str:
    """Derive Mission status from its child AgentRuns.

    Returns one of:
    ``planning | running | awaiting_input | degraded | done | failed | cancelled``.

    判据矩阵（2026-08-22-team-session-unify task-02 / design §5 Phase1，按序判）：

    - ``cancelled``: mission explicitly cancelled (``cancelled_at`` set).
    - ``planning``: no child runs yet（无分身 run 且无主控轮回填，输入为空）.
    - ``running``: any run（主控轮或分身）still pending/running.
    - ``awaiting_input``: all runs terminal + 未 converge（``converged_at`` IS NULL）
      + 无会话活跃 turn + mission 绑定会话（``has_session``）——会话 mission 等
      主控输入的中间档，仅派生不落库（design §8）。
    - ``degraded``: all terminal, at least one completed AND at least one failed.
    - ``done``: all terminal, at least one completed, none failed.
    - ``failed``: all terminal, none completed.

    纯函数契约：``converged`` / ``has_session`` / ``session_active_turn`` 由调用方
    查明后以 keyword-only 布尔传入，函数内不查 DB。NULL 守卫（Grill NEW-4）：
    ``has_session=False``（存量 external/bootstrap mission，session 维度缺失）永不
    进 ``awaiting_input``——存量调用方不传新参时返回值逐字节不变，complete_lease
    自动收敛依赖的 derive∈{done, degraded} 语义零回归。
    """
    if cancelled:
        return "cancelled"
    statuses = [r.status for r in runs]
    if not statuses:
        return "planning"
    if any(s in _ACTIVE for s in statuses):
        return "running"
    # awaiting_input 仅会话 mission（session_id 非 NULL）可进；converge 置位
    # （已终态化）或主控会话有活跃 turn（新一轮进行中）时回落存量终态判定。
    if has_session and not converged and not session_active_turn:
        return "awaiting_input"
    has_completed = any(s in _DONE for s in statuses)
    has_failed = any(s in _FAILED for s in statuses)
    if has_completed and has_failed:
        return "degraded"
    if has_completed:
        return "done"
    return "failed"


async def get_active_mission_for_session(
    db: AsyncSession, session_id: uuid.UUID
) -> AgentMission | None:
    """按会话取活跃 mission（design §6 辅助查询，R-07 单活跃约束）。

    活跃 = ``session_id = X`` AND ``converged_at IS NULL`` AND
    ``cancelled_at IS NULL``；命中多条时取 ``created_at`` 最新一条（数据库侧
    部分唯一索引 ``uq_agent_missions_session_active`` 已保证至多一条，排序仅
    防御），无活跃返回 ``None``。消费方：task-03 预建 409 冲突检测 / task-04
    inject 双标记回填 / task-05 mcp_tools 会话定位。注意：懒建并发守卫
    （Grill NEW-3）在 daemon 侧另走 SELECT...FOR UPDATE，本查询不加锁。
    """
    stmt = (
        select(AgentMission)
        .where(
            col(AgentMission.session_id) == session_id,
            col(AgentMission.converged_at).is_(None),
            col(AgentMission.cancelled_at).is_(None),
        )
        .order_by(col(AgentMission.created_at).desc())
        .limit(1)
    )
    result = await db.execute(stmt)
    return result.scalars().first()


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
