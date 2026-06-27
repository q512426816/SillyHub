"""Tests for Mission Finalizer + convergence (Wave 1, 2026-06-28-team-mainline-integration).

Covers the three P0 Design-Grill fixes that make the team pipeline actually
converge:
- D-007@v1 — ``converge_mission_for_completed_run`` is the Finalizer trigger
  anchor (called at ``complete_lease`` end); ``derive_status`` is a pure fn with
  no watcher, so the anchor must be the lease-completion path.
- D-008@v1 — ``can_dispatch_worker`` rejects (budget/max/cancelled) and the
  dispatch loop marks rejected Runs ``killed`` (not dangling pending).
- D-004@v2 — tool governance v1 is non-enforcing (tested indirectly: Workers
  carry no canUseTool expectation; Finalizer is backend-embedded, no daemon).

Also covers C2: ``collect_completed_artifacts`` fires per-run in
``complete_lease`` (decoupled from session end) — exercised via converge.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.control import MissionControlService
from app.modules.agent.finalizer import (
    FinalizerService,
    converge_mission_for_completed_run,
)
from app.modules.agent.model import AgentArtifact, AgentMission, AgentRun


async def _make_mission(session: AsyncSession, *, budget_usd: float | None = None) -> AgentMission:
    m = AgentMission(
        workspace_id=uuid.uuid4(),
        objective="分析项目架构与规范",
        budget_usd=budget_usd,
    )
    session.add(m)
    await session.commit()
    await session.refresh(m)
    return m


async def _make_worker(
    session: AsyncSession,
    mission_id: uuid.UUID,
    *,
    status: str = "completed",
    output: str | None = "Worker 结构化摘要",
    role: str = "arch",
    cost: float = 0.0,
) -> AgentRun:
    r = AgentRun(
        mission_id=mission_id,
        agent_type="claude_code",
        provider="claude",
        status=status,
        role=role,
        objective=f"{role} objective",
        spec_strategy="oneshot",
        output_redacted=output,
        total_cost_usd=cost,
    )
    session.add(r)
    await session.commit()
    await session.refresh(r)
    return r


# ── D-007@v1: converge_mission_for_completed_run ────────────────────────────


class TestConvergeSkipsNonMissionRun:
    @pytest.mark.asyncio
    async def test_run_without_mission_returns_none(self, db_session: AsyncSession) -> None:
        """非 mission run（绝大多数 lease）→ converge 零影响（SC-5 兼容）。"""
        run = AgentRun(
            agent_type="claude_code",
            provider="claude",
            status="completed",
            spec_strategy="oneshot",
        )
        db_session.add(run)
        await db_session.commit()
        await db_session.refresh(run)

        result = await converge_mission_for_completed_run(db_session, run.id, None)
        assert result is None


class TestConvergeCollectsAndFinalizes:
    @pytest.mark.asyncio
    async def test_all_done_triggers_finalizer_concat_merge(self, db_session: AsyncSession) -> None:
        """全 worker completed → collect 回灌 + Finalizer 合并（config=None 走 concat）。"""
        mission = await _make_mission(db_session)
        r1 = await _make_worker(db_session, mission.id, output="架构摘要A", role="arch")
        await _make_worker(db_session, mission.id, output="规范摘要B", role="code_style")

        status = await converge_mission_for_completed_run(db_session, r1.id, None)

        assert status == "done"
        # collect 回灌：每个 completed worker 一个 summary Artifact
        arts = (
            (await db_session.execute(select(AgentArtifact).where(AgentArtifact.run_id == r1.id)))
            .scalars()
            .all()
        )
        assert any(("架构摘要A" in (a.content_ref or "")) for a in arts)
        # Finalizer 合并产物（concat，config=None）：内容含两摘要 + 合并标记
        merged = [
            a
            for a in (
                (
                    await db_session.execute(
                        select(AgentArtifact)
                        .join(AgentRun, AgentArtifact.run_id == AgentRun.id)
                        .where(AgentRun.mission_id == mission.id)
                    )
                )
                .scalars()
                .all()
            )
            if "架构摘要A" in (a.content_ref or "") and "规范摘要B" in (a.content_ref or "")
        ]
        assert merged, "Finalizer 应产出含所有 worker 摘要的合并 Artifact"

    @pytest.mark.asyncio
    async def test_partial_failure_converges_degraded(self, db_session: AsyncSession) -> None:
        """1 completed + 1 killed → derive_status=degraded → Finalizer 仍触发（D6 降级不阻断）。"""
        mission = await _make_mission(db_session)
        ok = await _make_worker(db_session, mission.id, output="完成的摘要", role="arch")
        await _make_worker(db_session, mission.id, status="killed", output=None, role="test")

        status = await converge_mission_for_completed_run(db_session, ok.id, None)

        assert status == "degraded"
        merged = [
            a
            for a in (
                (
                    await db_session.execute(
                        select(AgentArtifact)
                        .join(AgentRun, AgentArtifact.run_id == AgentRun.id)
                        .where(AgentRun.mission_id == mission.id)
                    )
                )
                .scalars()
                .all()
            )
            if "完成的摘要" in (a.content_ref or "")
        ]
        assert merged, "degraded 仍应 Finalizer 合并（降级不阻断收敛）"

    @pytest.mark.asyncio
    async def test_pending_worker_keeps_running_no_finalizer(
        self, db_session: AsyncSession
    ) -> None:
        """有 pending → status=running，Finalizer 不触发（等待全终态）。"""
        mission = await _make_mission(db_session)
        done = await _make_worker(db_session, mission.id, output="done摘要", role="arch")
        await _make_worker(db_session, mission.id, status="pending", output=None, role="test")

        before = len(
            (
                await db_session.execute(
                    select(AgentArtifact)
                    .join(AgentRun, AgentArtifact.run_id == AgentRun.id)
                    .where(AgentRun.mission_id == mission.id)
                )
            )
            .scalars()
            .all()
        )
        status = await converge_mission_for_completed_run(db_session, done.id, None)

        assert status == "running"
        after = len(
            (
                await db_session.execute(
                    select(AgentArtifact)
                    .join(AgentRun, AgentArtifact.run_id == AgentRun.id)
                    .where(AgentRun.mission_id == mission.id)
                )
            )
            .scalars()
            .all()
        )
        # collect 回灌了 done worker 的 1 个 Artifact，但 Finalizer 未触发（无合并产物）
        assert after == before + 1


class TestFinalizerNoArtifacts:
    @pytest.mark.asyncio
    async def test_no_artifacts_returns_none(self, db_session: AsyncSession) -> None:
        """mission 无 Artifact（worker 无 output）→ Finalizer 返回 None，不写空合并。"""
        mission = await _make_mission(db_session)
        await _make_worker(db_session, mission.id, output=None, role="arch")
        fin = FinalizerService(db_session, None)
        result = await fin.finalize_bootstrap_mission(mission.id)
        assert result is None


# ── D-008@v1: can_dispatch_worker (running-based concurrency) ───────────────


class TestCanDispatchWorker:
    @pytest.mark.asyncio
    async def test_running_count_excludes_pending(self, db_session: AsyncSession) -> None:
        """running_worker_count 只算 running，不算 pending（D-008 修复 N pending 误触发）。"""
        mission = await _make_mission(db_session)
        await _make_worker(db_session, mission.id, status="pending", role="arch")
        await _make_worker(db_session, mission.id, status="pending", role="test")
        ctrl = MissionControlService(db_session)
        assert await ctrl.running_worker_count(mission.id) == 0
        assert await ctrl.active_worker_count(mission.id) == 2  # pending+running

    @pytest.mark.asyncio
    async def test_allows_dispatch_for_flat_pending_mission(self, db_session: AsyncSession) -> None:
        """5 个 pending（plan 允许上限）→ can_dispatch_worker 应 allow（running=0）。

        修复前用 active（pending+running）会误判 max_workers_reached。
        """
        mission = await _make_mission(db_session)
        for role in ("arch", "code_style", "test", "integration", "risk"):
            await _make_worker(db_session, mission.id, status="pending", role=role)
        ctrl = MissionControlService(db_session)
        allowed, reason = await ctrl.can_dispatch_worker(mission)
        assert allowed, f"5 pending mission 应 allow dispatch，got reason={reason}"
        assert reason == "ok"

    @pytest.mark.asyncio
    async def test_rejects_cancelled(self, db_session: AsyncSession) -> None:
        """mission cancelled → 拒绝（reason=mission_cancelled）。"""
        mission = await _make_mission(db_session)
        mission.cancelled_at = datetime.now(UTC)
        db_session.add(mission)
        await db_session.commit()
        ctrl = MissionControlService(db_session)
        allowed, reason = await ctrl.can_dispatch_worker(mission)
        assert not allowed
        assert reason == "mission_cancelled"

    @pytest.mark.asyncio
    async def test_rejects_budget_exceeded(self, db_session: AsyncSession) -> None:
        """累计成本 >= budget → 拒绝（reason=budget_exceeded，超预算=收敛信号非错误）。"""
        mission = await _make_mission(db_session, budget_usd=1.0)
        await _make_worker(
            db_session,
            mission.id,
            status="completed",
            role="arch",
            cost=1.5,  # 超预算
        )
        ctrl = MissionControlService(db_session)
        allowed, reason = await ctrl.can_dispatch_worker(mission)
        assert not allowed
        assert reason == "budget_exceeded"

    @pytest.mark.asyncio
    async def test_rejects_max_workers_when_running_full(self, db_session: AsyncSession) -> None:
        """已有 MAX_WORKERS(5) 个 running → 拒绝（reason=max_workers_reached）。"""
        from app.modules.agent.delegation import MAX_WORKERS

        mission = await _make_mission(db_session)
        for _ in range(MAX_WORKERS):
            await _make_worker(db_session, mission.id, status="running", role="arch")
        ctrl = MissionControlService(db_session)
        allowed, reason = await ctrl.can_dispatch_worker(mission)
        assert not allowed
        assert reason == "max_workers_reached"
