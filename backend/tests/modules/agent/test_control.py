"""Tests for Mission control plane (Wave 4)."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.control import MissionControlService
from app.modules.agent.delegation import MAX_WORKERS
from app.modules.agent.model import AgentMission, AgentRun
from app.modules.workspace.model import Workspace


async def _setup(
    db_session: AsyncSession, *, budget_usd: float | None = None
) -> tuple[AgentMission, uuid.UUID]:
    ws = Workspace(id=uuid.uuid4(), name="t", slug="t", root_path="/tmp", status="active")
    db_session.add(ws)
    await db_session.commit()
    mission = AgentMission(workspace_id=ws.id, objective="o", budget_usd=budget_usd)
    db_session.add(mission)
    await db_session.commit()
    await db_session.refresh(mission)
    return mission, ws.id


async def _run(
    db_session: AsyncSession,
    *,
    mission_id: uuid.UUID,
    status: str = "pending",
    cost: float | None = None,
) -> AgentRun:
    run = AgentRun(
        mission_id=mission_id,
        agent_type="claude_code",
        status=status,
        total_cost_usd=cost,
    )
    db_session.add(run)
    await db_session.commit()
    await db_session.refresh(run)
    return run


async def test_cost_so_far_sums(db_session: AsyncSession) -> None:
    mission, _ = await _setup(db_session)
    await _run(db_session, mission_id=mission.id, status="completed", cost=1.5)
    await _run(db_session, mission_id=mission.id, status="completed", cost=2.0)
    svc = MissionControlService(db_session)
    assert await svc.cost_so_far(mission.id) == pytest.approx(3.5)


async def test_active_worker_count(db_session: AsyncSession) -> None:
    mission, _ = await _setup(db_session)
    await _run(db_session, mission_id=mission.id, status="running")
    await _run(db_session, mission_id=mission.id, status="pending")
    await _run(db_session, mission_id=mission.id, status="completed")
    svc = MissionControlService(db_session)
    assert await svc.active_worker_count(mission.id) == 2


async def test_can_dispatch_ok(db_session: AsyncSession) -> None:
    mission, _ = await _setup(db_session, budget_usd=10.0)
    await _run(db_session, mission_id=mission.id, status="completed", cost=1.0)
    svc = MissionControlService(db_session)
    allowed, reason = await svc.can_dispatch_worker(mission)
    assert (allowed, reason) == (True, "ok")


async def test_can_dispatch_blocked_by_budget(db_session: AsyncSession) -> None:
    mission, _ = await _setup(db_session, budget_usd=5.0)
    await _run(db_session, mission_id=mission.id, status="completed", cost=5.0)
    svc = MissionControlService(db_session)
    allowed, reason = await svc.can_dispatch_worker(mission)
    assert (allowed, reason) == (False, "budget_exceeded")


async def test_can_dispatch_blocked_by_concurrency(db_session: AsyncSession) -> None:
    mission, _ = await _setup(db_session)
    for _ in range(MAX_WORKERS):
        await _run(db_session, mission_id=mission.id, status="running")
    svc = MissionControlService(db_session)
    allowed, reason = await svc.can_dispatch_worker(mission)
    assert (allowed, reason) == (False, "max_workers_reached")


async def test_cancel_kills_active_and_marks_mission(db_session: AsyncSession) -> None:
    mission, _ = await _setup(db_session)
    r1 = await _run(db_session, mission_id=mission.id, status="running")
    r2 = await _run(db_session, mission_id=mission.id, status="pending")
    r3 = await _run(db_session, mission_id=mission.id, status="completed")
    svc = MissionControlService(db_session)
    killed = await svc.cancel(mission)

    assert killed == 2  # only running + pending
    await db_session.refresh(mission)
    assert mission.cancelled_at is not None
    for r in (r1, r2):
        await db_session.refresh(r)
        assert r.status == "killed"
    await db_session.refresh(r3)
    assert r3.status == "completed"  # untouched


async def test_cancel_delegates_to_cancel_lease(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """ql-20260712-001（P0-2）：cancel 对每个 active worker 委托 cancel_lease。

    旧实现只 flip status 不通知 daemon（僵尸 lease）；新实现必须调 cancel_lease
    让 daemon 真收到取消信号（batch 心跳 SIGTERM / interactive WS INTERRUPT）。
    """
    mission, _ = await _setup(db_session)
    r1 = await _run(db_session, mission_id=mission.id, status="running")
    r2 = await _run(db_session, mission_id=mission.id, status="pending")
    r3 = await _run(db_session, mission_id=mission.id, status="completed")

    from app.modules.daemon import lease_service as lease_svc_mod

    called_run_ids: list[uuid.UUID] = []
    original_cancel = lease_svc_mod.DaemonLeaseService.cancel_lease

    async def spy_cancel(self, agent_run_id):
        called_run_ids.append(agent_run_id)
        return await original_cancel(self, agent_run_id)

    monkeypatch.setattr(lease_svc_mod.DaemonLeaseService, "cancel_lease", spy_cancel)

    svc = MissionControlService(db_session)
    killed = await svc.cancel(mission)

    assert killed == 2
    # 对 r1（running）和 r2（pending）调了 cancel_lease；r3（completed）跳过
    assert set(called_run_ids) == {r1.id, r2.id}
    assert r3.id not in called_run_ids  # completed worker 不委托 cancel_lease


async def test_can_dispatch_blocked_after_cancel(db_session: AsyncSession) -> None:
    mission, _ = await _setup(db_session)
    mission.cancelled_at = datetime.now(UTC)
    db_session.add(mission)
    await db_session.commit()
    svc = MissionControlService(db_session)
    allowed, reason = await svc.can_dispatch_worker(mission)
    assert (allowed, reason) == (False, "mission_cancelled")
