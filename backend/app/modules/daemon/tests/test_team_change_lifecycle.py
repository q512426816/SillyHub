"""team→change 生命周期测试（形态A 按需触发，2026-08-08-change-center-on-demand）。

覆盖 ``_trigger_stage_completion_callback`` 的 team 分支 +
``_handle_team_run_completion``（run_sync/service.py，task-03 修订）：

1. **缺口 A**：team worker run 完成 → ``schedule_loop`` 被调用（后端收敛兜底接线）。
2. **未收敛**：schedule_loop 返 None（仍有 worker 在跑）→ 不调 ``complete_stage``
   桥（不推进 stage）。
3. **零回归（single）**：mission_id=None 的 single stage run 完成 → 不进 team 分支，
   走原 ``sync_stage_status`` 路径（schedule_loop 不被调）。
4. **幂等**：change.current_stage != team_stage → 不推进（已推进过）。

收敛成功后的桥接推进（``_advance_team_stage``：merge_gate_results +
``ChangeService.complete_stage``，不自动连轴）已由 task-16 新建
``test_advance_team_stage.py`` 全量覆盖（execute→verify / verify+passed→archive /
verify 非 0 停 verify），本文件不再重复（task-17 精简）。

Mock 策略：``OrchestratorService.schedule_loop`` / ``SillySpecStageDispatchService
.sync_stage_status`` 按需 patch（不起 daemon RPC / 不读 sillyspec.db）。
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
        """schedule_loop 返 None（仍有 worker 在跑）→ 不调 complete_stage 桥（不推进）。"""
        from app.modules.change.service import ChangeService

        orchestrator_run, _mission, _change = await _seed_team(db_session)

        with (
            patch("app.modules.agent.orchestrator.OrchestratorService") as MockOrch,
            patch.object(
                ChangeService,
                "complete_stage",
                new_callable=AsyncMock,
            ) as mock_complete,
        ):
            MockOrch.return_value.schedule_loop = AsyncMock(return_value=None)
            svc = RunSyncService(db_session)
            await svc._trigger_stage_completion_callback(orchestrator_run.id)

            mock_complete.assert_not_awaited()


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
