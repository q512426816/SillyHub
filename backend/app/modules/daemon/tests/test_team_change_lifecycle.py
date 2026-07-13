"""team→change 生命周期修复测试。

覆盖 ``_trigger_stage_completion_callback`` 的 team 分支 +
``_handle_team_run_completion`` + ``_advance_team_stage``（run_sync/service.py）：

1. **缺口 A**：team worker run 完成 → ``schedule_loop`` 被调用（后端收敛兜底接线）。
2. **缺口 B（execute）**：mission 收敛（schedule_loop 返 "done"）→
   ``auto_dispatch_next_step`` 被调，sync_result.current_stage="execute"、
   stage_completed=True（桥接推进到 verify）。
3. **缺口 B（verify）**：mission 收敛 → worker gate_results 经 ``merge_gate_results``
   合并落主 run.gate_result（gate_status=decided）→ ``auto_dispatch_next_step`` 被调。
4. **零回归（single）**：mission_id=None 的 single stage run 完成 → 不进 team 分支，
   走原 ``sync_stage_status`` 路径（schedule_loop 不被调）。
5. **幂等**：change.current_stage != team_stage → 不推进（已推进过）。
6. **未收敛**：schedule_loop 返 None → 不调 auto_dispatch（仍有 worker 在跑）。

Mock 策略：``OrchestratorService.schedule_loop`` /
``auto_dispatch_next_step`` / ``SillySpecStageDispatchService.sync_stage_status`` 均按
需 patch（不起 daemon RPC / 不读 sillyspec.db）。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.model import AgentMission, AgentRun, AgentSession
from app.modules.daemon.model import DaemonRuntime
from app.modules.daemon.run_sync.service import RunSyncService

# ── Fixtures ────────────────────────────────────────────────────────────────


async def _create_user(session: AsyncSession) -> uuid.UUID:
    from app.modules.auth.model import User

    uid = uuid.uuid4()
    session.add(
        User(
            id=uid,
            email=f"team-life-{uid}@example.com",
            password_hash="x",
            display_name="T",
            status="active",
        )
    )
    await session.commit()
    return uid


async def _create_runtime(session: AsyncSession, user_id: uuid.UUID) -> DaemonRuntime:
    rt = DaemonRuntime(
        id=uuid.uuid4(),
        user_id=user_id,
        name="daemon",
        provider="claude",
        status="online",
        last_heartbeat_at=datetime.now(UTC),
    )
    session.add(rt)
    await session.commit()
    await session.refresh(rt)
    return rt


async def _seed_team(
    db_session: AsyncSession,
    *,
    team_stage: str = "execute",
    current_stage: str | None = None,
    worker_count: int = 1,
    worker_gate_results: list[dict | None] | None = None,
    worker_status: str = "completed",
) -> tuple[AgentRun, AgentMission, object]:
    """建 user/runtime/workspace/change(team_mode)/mission/orchestrator+worker runs。

    返回 (orchestrator_run, mission, change)。current_stage 默认 = team_stage。
    worker_gate_results[i] 写入第 i 个 worker run 的 gate_result（测 verify 合并）。
    """
    from app.modules.change.model import Change
    from app.modules.workspace.model import Workspace

    uid = await _create_user(db_session)
    rt = await _create_runtime(db_session, uid)

    workspace_id = uuid.uuid4()
    workspace = Workspace(
        id=workspace_id,
        name="ws-team-life",
        slug=f"ws-team-life-{uuid.uuid4().hex[:6]}",
        root_path="/host-projects/demo",
        status="active",
    )
    change_id = uuid.uuid4()
    session_id = uuid.uuid4()
    change = Change(
        id=change_id,
        workspace_id=workspace_id,
        change_key=f"team-life-{uuid.uuid4().hex[:6]}",
        title="team lifecycle test",
        status="in-progress",
        location="active",
        path=".sillyspec/changes/team-life",
        current_stage=current_stage if current_stage is not None else team_stage,
        stages={"team_mode": True},
        owner_id=uid,
    )
    agent_session = AgentSession(
        id=session_id,
        user_id=uid,
        provider="claude",
        status="active",
        config={},
        turn_count=1,
        runtime_id=rt.id,
        last_active_at=datetime.now(UTC),
        created_at=datetime.now(UTC),
    )
    mission = AgentMission(
        id=uuid.uuid4(),
        workspace_id=workspace_id,
        change_id=change_id,
        objective="team objective",
        constraints={"mode": "team", "stage": team_stage},
        created_by=uid,
    )
    orchestrator_run = AgentRun(
        id=uuid.uuid4(),
        agent_type="claude_code",
        provider="claude",
        status="completed",
        spec_strategy="interactive",
        agent_session_id=session_id,
        change_id=change_id,
        mission_id=mission.id,
        role="orchestrator",
    )
    runs = [workspace, change, agent_session, mission, orchestrator_run]
    gate_list = worker_gate_results or [None] * worker_count
    for i in range(worker_count):
        w = AgentRun(
            id=uuid.uuid4(),
            agent_type="claude_code",
            provider="claude",
            status=worker_status,
            change_id=change_id,
            mission_id=mission.id,
            role="impl" if team_stage == "execute" else "verify",
        )
        if i < len(gate_list) and gate_list[i] is not None:
            w.gate_result = gate_list[i]
        runs.append(w)
    db_session.add_all(runs)
    await db_session.commit()
    return orchestrator_run, mission, change


@pytest.fixture()
def _no_redis_publish():
    """patch get_redis 避免 publish 噪音（本测试不验证 SSE）。"""
    with patch("app.modules.daemon.run_sync.service.get_redis", return_value=AsyncMock()):
        yield


# ── 缺口 A：schedule_loop 接线 ──────────────────────────────────────────────


class TestScheduleLoopWired:
    """team run 完成 → schedule_loop 被调用（缺口 A 接线验证）。"""

    async def test_worker_completion_invokes_schedule_loop(self, db_session, _no_redis_publish):
        orchestrator_run, mission, _change = await _seed_team(db_session)

        with patch("app.modules.agent.orchestrator.OrchestratorService") as MockOrch:
            MockOrch.return_value.schedule_loop = AsyncMock(return_value=None)
            svc = RunSyncService(db_session)
            await svc._trigger_stage_completion_callback(orchestrator_run.id)

            MockOrch.return_value.schedule_loop.assert_awaited_once_with(mission.id)

    async def test_not_converged_skips_advance(self, db_session, _no_redis_publish):
        """schedule_loop 返 None（仍有 worker 在跑）→ 不调 auto_dispatch。"""
        orchestrator_run, _mission, _change = await _seed_team(db_session)

        with (
            patch("app.modules.agent.orchestrator.OrchestratorService") as MockOrch,
            patch(
                "app.modules.change.dispatch.auto_dispatch_next_step",
                new_callable=AsyncMock,
            ) as mock_ad,
        ):
            MockOrch.return_value.schedule_loop = AsyncMock(return_value=None)
            svc = RunSyncService(db_session)
            await svc._trigger_stage_completion_callback(orchestrator_run.id)

            mock_ad.assert_not_called()


# ── 缺口 B：mission 收敛 → stage 推进 ───────────────────────────────────────


class TestAdvanceTeamStage:
    async def test_execute_converged_calls_auto_dispatch_to_verify(
        self, db_session, _no_redis_publish
    ):
        """execute mission 收敛 → auto_dispatch_next_step 收到 stage_completed=True。"""
        orchestrator_run, _mission, _change = await _seed_team(db_session, team_stage="execute")

        with (
            patch("app.modules.agent.orchestrator.OrchestratorService") as MockOrch,
            patch(
                "app.modules.change.dispatch.auto_dispatch_next_step",
                new_callable=AsyncMock,
            ) as mock_ad,
        ):
            MockOrch.return_value.schedule_loop = AsyncMock(return_value="done")
            svc = RunSyncService(db_session)
            await svc._trigger_stage_completion_callback(orchestrator_run.id)

            mock_ad.assert_awaited_once()
            _call_kwargs = mock_ad.call_args.kwargs
            sync_result = _call_kwargs["sync_result"]
            assert sync_result.synced is True
            assert sync_result.current_stage == "execute"
            assert sync_result.stage_completed is True
            assert sync_result.has_pending_step is False

    async def test_verify_converged_merges_worker_gates(self, db_session, _no_redis_publish):
        """verify mission 收敛 → 多 worker gate_results 合并落主 run.gate_result。"""
        orchestrator_run, _mission, _change = await _seed_team(
            db_session,
            team_stage="verify",
            worker_count=2,
            worker_gate_results=[
                {"exit_code": 0, "errors": []},
                {"exit_code": 1, "errors": ["bug-x"]},
            ],
        )

        with (
            patch("app.modules.agent.orchestrator.OrchestratorService") as MockOrch,
            patch(
                "app.modules.change.dispatch.auto_dispatch_next_step",
                new_callable=AsyncMock,
            ) as mock_ad,
        ):
            MockOrch.return_value.schedule_loop = AsyncMock(return_value="done")
            svc = RunSyncService(db_session)
            await svc._trigger_stage_completion_callback(orchestrator_run.id)

            # 主 run 已落合并 gate_result（exit 1 最严重）+ gate_status=decided。
            await db_session.refresh(orchestrator_run)
            assert orchestrator_run.gate_result is not None
            assert orchestrator_run.gate_result["exit_code"] == 1
            assert orchestrator_run.gate_status == "decided"
            mock_ad.assert_awaited_once()
            assert mock_ad.call_args.kwargs["sync_result"].current_stage == "verify"

    async def test_verify_all_pass_exit_zero(self, db_session, _no_redis_publish):
        """verify 全 worker exit 0 → 合并 exit 0（推进 archive 由 auto_dispatch 决策）。"""
        orchestrator_run, _mission, _change = await _seed_team(
            db_session,
            team_stage="verify",
            worker_count=2,
            worker_gate_results=[
                {"exit_code": 0, "errors": []},
                {"exit_code": 0, "errors": []},
            ],
        )
        with (
            patch("app.modules.agent.orchestrator.OrchestratorService") as MockOrch,
            patch("app.modules.change.dispatch.auto_dispatch_next_step", new_callable=AsyncMock),
        ):
            MockOrch.return_value.schedule_loop = AsyncMock(return_value="done")
            svc = RunSyncService(db_session)
            await svc._trigger_stage_completion_callback(orchestrator_run.id)

            await db_session.refresh(orchestrator_run)
            assert orchestrator_run.gate_result["exit_code"] == 0


# ── 零回归：single 模式不走 team 分支 ────────────────────────────────────────


class TestSingleModeZeroRegression:
    async def test_single_run_does_not_invoke_team_path(self, db_session, _no_redis_publish):
        """mission_id=None 的 single stage run → 走 sync_stage_status，不调 schedule_loop。"""
        from app.modules.change.model import Change
        from app.modules.workspace.model import Workspace

        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)
        ws = Workspace(
            id=uuid.uuid4(),
            name="ws-single",
            slug=f"ws-single-{uuid.uuid4().hex[:6]}",
            root_path="/host-projects/single",
            status="active",
        )
        session_id = uuid.uuid4()
        change = Change(
            id=uuid.uuid4(),
            workspace_id=ws.id,
            change_key=f"single-{uuid.uuid4().hex[:6]}",
            title="single run",
            status="in-progress",
            location="active",
            path=".sillyspec/changes/single",
            current_stage="plan",
            stages={},  # 无 team_mode
            owner_id=uid,
        )
        sess = AgentSession(
            id=session_id,
            user_id=uid,
            provider="claude",
            status="active",
            config={},
            turn_count=1,
            runtime_id=rt.id,
            last_active_at=datetime.now(UTC),
            created_at=datetime.now(UTC),
        )
        single_run = AgentRun(
            id=uuid.uuid4(),
            agent_type="claude_code",
            provider="claude",
            status="completed",
            spec_strategy="interactive",
            agent_session_id=session_id,
            change_id=change.id,
            # mission_id=None → single stage run
        )
        db_session.add_all([ws, change, sess, single_run])
        await db_session.commit()

        sync_mock = MagicMock()
        sync_mock.sync_stage_status = AsyncMock(
            return_value=MagicMock(synced=False, error="synced_false_for_test")
        )
        with (
            patch("app.modules.agent.orchestrator.OrchestratorService") as MockOrch,
            patch(
                "app.modules.change.dispatch.SillySpecStageDispatchService",
                return_value=sync_mock,
            ),
        ):
            svc = RunSyncService(db_session)
            await svc._trigger_stage_completion_callback(single_run.id)

            # single 路径：sync_stage_status 被调；team 路径：schedule_loop 不被调。
            sync_mock.sync_stage_status.assert_awaited_once()
            MockOrch.return_value.schedule_loop.assert_not_called()


# ── 幂等：已推进过的 stage 不重复处理 ───────────────────────────────────────


class TestIdempotent:
    async def test_stage_already_advanced_skips(self, db_session, _no_redis_publish):
        """change.current_stage 已离开 team_stage（推进过）→ 不调 schedule_loop。"""
        # mission stage=execute，但 change.current_stage 已是 verify（被推进过）。
        orchestrator_run, _mission, _change = await _seed_team(
            db_session, team_stage="execute", current_stage="verify"
        )

        with patch("app.modules.agent.orchestrator.OrchestratorService") as MockOrch:
            MockOrch.return_value.schedule_loop = AsyncMock(return_value="done")
            svc = RunSyncService(db_session)
            await svc._trigger_stage_completion_callback(orchestrator_run.id)

            MockOrch.return_value.schedule_loop.assert_not_called()
