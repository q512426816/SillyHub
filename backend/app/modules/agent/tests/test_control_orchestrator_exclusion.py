"""task-07（2026-08-22-team-session-unify）：MissionControlService 治理口径排除主控轮 run。

design §5 核心机制 D-009 / 审查 B3 / D-007@v2：
- 主控轮 run（role='orchestrator'）回填 mission_id 后不计入 MAX_WORKERS=5 并发
  额度（running_worker_count / can_dispatch_worker）、分身成本（cost_so_far）与
  cancel 的 kill 对象（design §7.5 叫停行为：分身级联，主控轮非分身）。
- AgentRun.role 可空（nullable String(30)）：NULL role 的存量分身 run 必须仍计入
  （SQL 三值逻辑 `role != 'orchestrator'` 会漏 NULL 行——审查 B3 关键点）。
- worker_runs 本身保持全量（含主控轮）：orchestrator.py schedule_loop 主控锚点
  （``next(r for r in all_runs if r.role == _ORCHESTRATOR_ROLE)``）与
  finalizer.py converge derive 输入依赖全量 run；治理口径经 non_orchestrator_runs
  收窄（卡片"单点收窄 worker_runs"与源码消费方不符，见任务报告）。

task-11（2026-08-25-team-subsession-governance / design §5.C.6 + §5.D）追加
子会话形态口径守卫（TestSubsessionFormOrchestratorExclusion）：治理三口径换
「存量 run + 未完成子会话」混跑形态后，主控轮排除保证在新形态下不变——
不占并发额度、不计分身成本、不进 kill 名单；无子会话 mission 的既有断言
全部回落现行为（FR-09，本文件 11 条既有断言零改动全绿）。
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.control import MissionControlService
from app.modules.agent.delegation import MAX_WORKERS
from app.modules.agent.model import AgentMission, AgentRun, AgentSession


async def _make_mission(session: AsyncSession, *, budget_usd: float | None = None):
    m = AgentMission(workspace_id=uuid.uuid4(), objective="团队目标", budget_usd=budget_usd)
    session.add(m)
    await session.commit()
    await session.refresh(m)
    return m


async def _make_run(
    session: AsyncSession,
    mission_id: uuid.UUID,
    *,
    role: str | None = "arch",
    status: str = "running",
    cost: float = 0.0,
    agent_session_id: uuid.UUID | None = None,
) -> AgentRun:
    """建 mission run；``agent_session_id`` 供 task-11 子会话形态播种（首 run
    双标记 / 追问轮只挂会话）。"""
    r = AgentRun(
        mission_id=mission_id,
        agent_type="claude_code",
        provider="claude",
        status=status,
        role=role,
        objective=f"{role or 'legacy'} objective",
        total_cost_usd=cost,
        agent_session_id=agent_session_id,
    )
    session.add(r)
    await session.commit()
    await session.refresh(r)
    return r


class TestWorkerRunsKeepsAllRuns:
    """worker_runs 全量守卫：orchestrator.py:500 主控锚点 / finalizer.py:575 derive
    输入依赖含主控轮的全量 run——本任务不收窄该方法（治理口径走
    non_orchestrator_runs），防止 schedule_loop 找不到 main_run 提前返回。"""

    @pytest.mark.asyncio
    async def test_worker_runs_includes_orchestrator_run(self, db_session: AsyncSession):
        mission = await _make_mission(db_session)
        main = await _make_run(db_session, mission.id, role="orchestrator")
        worker = await _make_run(db_session, mission.id, role="arch")

        runs = await MissionControlService(db_session).worker_runs(mission.id)

        ids = {r.id for r in runs}
        assert ids == {main.id, worker.id}

    @pytest.mark.asyncio
    async def test_worker_runs_includes_null_role_run(self, db_session: AsyncSession):
        """NULL role（存量分身）必须出现在全量与治理口径中（三值逻辑守卫）。"""
        mission = await _make_mission(db_session)
        legacy = await _make_run(db_session, mission.id, role=None)

        runs = await MissionControlService(db_session).worker_runs(mission.id)

        assert {r.id for r in runs} == {legacy.id}


class TestNonOrchestratorRuns:
    @pytest.mark.asyncio
    async def test_excludes_orchestrator_keeps_null_and_worker_roles(
        self, db_session: AsyncSession
    ):
        mission = await _make_mission(db_session)
        main = await _make_run(db_session, mission.id, role="orchestrator")
        legacy = await _make_run(db_session, mission.id, role=None)
        arch = await _make_run(db_session, mission.id, role="arch")

        runs = await MissionControlService(db_session).non_orchestrator_runs(mission.id)

        ids = {r.id for r in runs}
        assert ids == {legacy.id, arch.id}, f"orchestrator run {main.id} 不应入治理口径"

    @pytest.mark.asyncio
    async def test_other_mission_runs_not_leaked(self, db_session: AsyncSession):
        mission_a = await _make_mission(db_session)
        mission_b = await _make_mission(db_session)
        await _make_run(db_session, mission_a.id, role="arch")
        other = await _make_run(db_session, mission_b.id, role="arch")

        runs = await MissionControlService(db_session).non_orchestrator_runs(mission_a.id)

        assert all(r.id != other.id for r in runs)


class TestConcurrencyGateExcludesOrchestrator:
    @pytest.mark.asyncio
    async def test_max_orchestrator_runs_do_not_trip_gate(self, db_session: AsyncSession):
        """验收（B3）：MAX_WORKERS 个 running 主控轮 → running_worker_count=0、
        can_dispatch_worker 不误报 max_workers_reached（主控轮不占并发额度）。"""
        mission = await _make_mission(db_session)
        for _ in range(MAX_WORKERS):
            await _make_run(db_session, mission.id, role="orchestrator", status="running")
        ctrl = MissionControlService(db_session)

        assert await ctrl.running_worker_count(mission.id) == 0
        assert await ctrl.active_worker_count(mission.id) == 0
        allowed, reason = await ctrl.can_dispatch_worker(mission)
        assert allowed, f"主控轮不应占并发额度，got reason={reason}"
        assert reason == "ok"

    @pytest.mark.asyncio
    async def test_running_workers_including_null_role_trip_gate(self, db_session: AsyncSession):
        """验收：MAX_WORKERS 个 running 分身（含 NULL role 存量）→ max_workers_reached。"""
        mission = await _make_mission(db_session)
        for i in range(MAX_WORKERS):
            await _make_run(
                db_session, mission.id, role=None if i == 0 else "arch", status="running"
            )
        ctrl = MissionControlService(db_session)

        assert await ctrl.running_worker_count(mission.id) == MAX_WORKERS
        allowed, reason = await ctrl.can_dispatch_worker(mission)
        assert not allowed
        assert reason == "max_workers_reached"

    @pytest.mark.asyncio
    async def test_active_count_counts_pending_workers_only(self, db_session: AsyncSession):
        """active_worker_count（pending+running）口径同样排除主控轮。"""
        mission = await _make_mission(db_session)
        await _make_run(db_session, mission.id, role="orchestrator", status="running")
        await _make_run(db_session, mission.id, role="arch", status="pending")
        await _make_run(db_session, mission.id, role=None, status="running")

        assert await MissionControlService(db_session).active_worker_count(mission.id) == 2


class TestCostExcludesOrchestrator:
    @pytest.mark.asyncio
    async def test_cost_so_far_sums_worker_runs_only(self, db_session: AsyncSession):
        """验收：主控轮成本不计入分身预算口径；NULL role 分身成本仍累计。"""
        mission = await _make_mission(db_session, budget_usd=10.0)
        await _make_run(db_session, mission.id, role="orchestrator", cost=5.0)
        await _make_run(db_session, mission.id, role=None, cost=1.5)
        await _make_run(db_session, mission.id, role="arch", cost=2.5)

        cost = await MissionControlService(db_session).cost_so_far(mission.id)

        assert cost == pytest.approx(4.0)

    @pytest.mark.asyncio
    async def test_budget_gate_ignores_orchestrator_cost(self, db_session: AsyncSession):
        """主控轮花掉全部预算 → 治理门仍放行（分身成本 0 < budget）。"""
        mission = await _make_mission(db_session, budget_usd=1.0)
        await _make_run(db_session, mission.id, role="orchestrator", cost=9.9)
        ctrl = MissionControlService(db_session)

        allowed, reason = await ctrl.can_dispatch_worker(mission)
        assert allowed, f"主控轮成本不应触发 budget_exceeded，got reason={reason}"


class TestCancelKillsWorkersOnly:
    @pytest.mark.asyncio
    async def test_cancel_skips_orchestrator_run(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ):
        """design §7.5：cancel 的 kill 对象仅为分身 run（主控轮非分身，语义一致）。

        monkeypatch DaemonLeaseService.cancel_lease 记录被 kill 的 run id，
        断言主控轮不在 kill 名单。
        """
        from app.modules.daemon import lease_service

        cancelled_run_ids: list[uuid.UUID] = []

        class _FakeLeaseService:
            def __init__(self, session) -> None:
                self._session = session

            async def cancel_lease(self, agent_run_id: uuid.UUID) -> None:
                cancelled_run_ids.append(agent_run_id)

        monkeypatch.setattr(lease_service, "DaemonLeaseService", _FakeLeaseService)

        mission = await _make_mission(db_session)
        main = await _make_run(db_session, mission.id, role="orchestrator", status="running")
        worker = await _make_run(db_session, mission.id, role="arch", status="running")
        done_worker = await _make_run(db_session, mission.id, role=None, status="completed")

        killed = await MissionControlService(db_session).cancel(mission)

        assert killed == 1
        assert cancelled_run_ids == [worker.id], "kill 名单必须只含活跃分身 run"
        assert main.id not in cancelled_run_ids
        assert done_worker.id not in cancelled_run_ids
        assert mission.cancelled_at is not None


class TestOrchestratorRunsInWorkerRunsGuard:
    """回归守卫：schedule_loop 主控锚点消费路径不受治理收窄影响（R-08）。"""

    @pytest.mark.asyncio
    async def test_worker_runs_still_finds_main_run_anchor(self, db_session: AsyncSession):
        mission = await _make_mission(db_session)
        await _make_run(db_session, mission.id, role="arch", status="running")
        main = await _make_run(db_session, mission.id, role="orchestrator", status="running")

        runs = await MissionControlService(db_session).worker_runs(mission.id)
        main_run = next((r for r in runs if r.role == "orchestrator"), None)

        assert main_run is not None and main_run.id == main.id


class TestSubsessionFormOrchestratorExclusion:
    """task-11 混跑形态下的主控轮排除守卫（D-009 在子会话新形态下不变）。"""

    async def _make_root_mission(self, session: AsyncSession, *, budget: float | None = None):
        root = AgentSession(
            id=uuid.uuid4(), user_id=uuid.uuid4(), provider="claude", status="active"
        )
        session.add(root)
        await session.commit()
        mission = AgentMission(
            workspace_id=uuid.uuid4(),
            objective="团队目标",
            session_id=root.id,
            budget_usd=budget,
        )
        session.add(mission)
        await session.commit()
        await session.refresh(mission)
        return root, mission

    async def _make_worker(self, session: AsyncSession, root: AgentSession) -> AgentSession:
        w = AgentSession(
            id=uuid.uuid4(),
            user_id=uuid.uuid4(),
            provider="claude",
            status="active",
            parent_session_id=root.id,
        )
        session.add(w)
        await session.commit()
        await session.refresh(w)
        return w

    @pytest.mark.asyncio
    async def test_orchestrator_run_not_counted_with_subsessions(self, db_session: AsyncSession):
        """MAX_WORKERS 个 running 主控轮 + 1 个未完成子会话 → 计数=1（主控轮
        不占额度，子会话占）；can_dispatch 放行。"""
        root, mission = await self._make_root_mission(db_session)
        for _ in range(MAX_WORKERS):
            await _make_run(db_session, mission.id, role="orchestrator", status="running")
        w = await self._make_worker(db_session, root)
        await _make_run(
            db_session,
            mission.id,
            role="impl",
            status="completed",
            agent_session_id=w.id,
        )

        ctrl = MissionControlService(db_session)
        assert await ctrl.running_worker_count(mission.id) == 1
        assert await ctrl.active_worker_count(mission.id) == 1
        allowed, reason = await ctrl.can_dispatch_worker(mission)
        assert allowed, f"主控轮不应占并发额度，got reason={reason}"

    @pytest.mark.asyncio
    async def test_orchestrator_cost_excluded_with_subsessions(self, db_session: AsyncSession):
        """主控轮成本不计分身预算（子会话形态）：仅子会话轮次 run 成本计入。"""
        root, mission = await self._make_root_mission(db_session, budget=10.0)
        await _make_run(db_session, mission.id, role="orchestrator", status="running", cost=9.9)
        w = await self._make_worker(db_session, root)
        await _make_run(
            db_session, mission.id, role="impl", status="completed", agent_session_id=w.id, cost=1.0
        )
        # 追问轮 run（无 mission_id，仅挂子会话）——union 成本来源
        await _make_run(db_session, None, status="completed", agent_session_id=w.id, cost=2.0)

        ctrl = MissionControlService(db_session)
        assert await ctrl.cost_so_far(mission.id) == pytest.approx(3.0)
        allowed, reason = await ctrl.can_dispatch_worker(mission)
        assert allowed, f"主控轮成本不应计入预算，got reason={reason}"

    @pytest.mark.asyncio
    async def test_cancel_excludes_orchestrator_run_with_subsessions(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ):
        """cancel kill 名单含子会话（首 run 兜底）但排除主控轮。"""
        from app.modules.daemon import lease_service

        cancelled_run_ids: list[uuid.UUID] = []

        class _FakeLeaseService:
            def __init__(self, session) -> None:
                self._session = session

            async def cancel_lease(self, agent_run_id: uuid.UUID) -> None:
                cancelled_run_ids.append(agent_run_id)

        monkeypatch.setattr(lease_service, "DaemonLeaseService", _FakeLeaseService)

        root, mission = await self._make_root_mission(db_session)
        main = await _make_run(db_session, mission.id, role="orchestrator", status="running")
        w = await self._make_worker(db_session, root)
        first_run = await _make_run(
            db_session,
            mission.id,
            role="impl",
            status="completed",
            agent_session_id=w.id,
        )

        killed = await MissionControlService(db_session).cancel(mission)

        assert killed == 1
        assert cancelled_run_ids == [first_run.id]
        assert main.id not in cancelled_run_ids
        assert mission.cancelled_at is not None


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
