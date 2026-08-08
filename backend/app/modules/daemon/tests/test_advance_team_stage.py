"""team 推进重写测试（2026-08-08-change-center-on-demand task-16，R-04/FR-05）。

覆盖重写后的 ``RunSyncService._advance_team_stage``（run_sync/service.py，task-03）：
team mission 收敛后**唯一桥** = ``merge_gate_results``（verify 合并 worker gate）+
``ChangeService.complete_stage``（推进 current_stage + 落 last_stage_completion /
pending_review 契约）。**删掉**了旧 ``StageSyncResult`` 伪造 + ``auto_dispatch_next_step``
自动建下一 stage mission——下一 stage（execute→verify / verify→archive）交
``advance_change_stage`` tool 显式触发 ``_dispatch_execute_team``。

用例：
1. **execute 收敛 → complete_stage 推进 verify**：桥被调（``complete_stage`` awaited，
   stage=execute/result=None），``change.current_stage`` execute→verify（推进后由
   projection.compute_pending_review 据 current_stage + sillyspec.db 投影 pending_review）。
   **不**自动建下一 stage mission（``_dispatch_execute_team`` / ``dispatch`` 零调用）。
2. **verify 收敛 + 全 exit 0 → complete_stage(result="passed") 推进 archive**：
   worker gate_results 经 ``merge_gate_results`` 合并落主 run（gate_status=decided），
   complete_stage 收 result="passed"，current_stage verify→archive。
3. **verify 收敛 + 非 0 exit → 不推进**：complete_stage 收 result=None（
   _resolve_stage_completion(verify, None)=(verify, None)），change 停 verify，
   交 advance_change_stage / review 显式决策（不自动 kickback）。
4. **team 桥必留（task-03 契约）**：上述均断言 ``complete_stage`` 被调一次。

Mock 策略：``OrchestratorService.schedule_loop`` 直接返 "done"（收敛）；
``MissionControlService.worker_runs`` 走真 DB（seed 真 AgentRun）；``get_redis``
patch 掉（不验证 SSE 发布）。``complete_stage`` 走真实现（落真 DB 推进），仅断言
调用 + 结果，证明桥仍在且生效。区别于旧 test_team_change_lifecycle.py（已随
auto_dispatch_next_step 删除而过期）——本文件锁的是**重写后**契约。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.model import AgentMission, AgentRun, AgentSession
from app.modules.daemon.model import DaemonRuntime
from app.modules.daemon.run_sync.service import RunSyncService

# ── Fixtures（对齐 daemon/tests/test_team_change_lifecycle.py 模式）─────────


async def _create_user(session: AsyncSession) -> uuid.UUID:
    from app.modules.auth.model import User

    uid = uuid.uuid4()
    session.add(
        User(
            id=uid,
            email=f"adv-team-{uid}@example.com",
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
    worker_gate_results: list[dict | None] | None = None,
    worker_count: int = 1,
):
    """建 user/runtime/workspace/change(team_mode)/mission/orchestrator+worker runs。

    返回 (orchestrator_run, mission, change)。``change.current_stage == team_stage``
    （幂等护栏要求）。worker_gate_results[i] 写入第 i 个 worker run 的 gate_result。
    """
    from app.modules.change.model import Change
    from app.modules.workspace.model import Workspace

    uid = await _create_user(db_session)
    rt = await _create_runtime(db_session, uid)

    workspace = Workspace(
        id=uuid.uuid4(),
        name="ws-adv-team",
        slug=f"ws-adv-team-{uuid.uuid4().hex[:6]}",
        root_path="/host-projects/demo",
        status="active",
    )
    change = Change(
        id=uuid.uuid4(),
        workspace_id=workspace.id,
        change_key=f"adv-team-{uuid.uuid4().hex[:6]}",
        title="team advance test",
        status="in-progress",
        location="active",
        path=".sillyspec/changes/adv-team",
        current_stage=team_stage,
        stages={"team_mode": True},
        owner_id=uid,
    )
    agent_session = AgentSession(
        id=uuid.uuid4(),
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
        workspace_id=workspace.id,
        change_id=change.id,
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
        agent_session_id=agent_session.id,
        change_id=change.id,
        mission_id=mission.id,
        role="orchestrator",
    )
    rows = [workspace, change, agent_session, mission, orchestrator_run]
    gate_list = worker_gate_results or [None] * worker_count
    for i in range(worker_count):
        w = AgentRun(
            id=uuid.uuid4(),
            agent_type="claude_code",
            provider="claude",
            status="completed",
            change_id=change.id,
            mission_id=mission.id,
            role="impl" if team_stage == "execute" else "verify",
        )
        if i < len(gate_list) and gate_list[i] is not None:
            w.gate_result = gate_list[i]
        rows.append(w)
    db_session.add_all(rows)
    await db_session.commit()
    return orchestrator_run, mission, change


@pytest.fixture()
def _no_redis_publish():
    """patch get_redis 避免 publish 噪音（本测试不验证 SSE 载荷）。"""
    with patch("app.modules.daemon.run_sync.service.get_redis", return_value=AsyncMock()):
        yield


@pytest.fixture()
def _converged():
    """schedule_loop 返 "done"（mission 收敛），直入 _advance_team_stage。"""
    with patch("app.modules.agent.orchestrator.OrchestratorService") as MockOrch:
        MockOrch.return_value.schedule_loop = AsyncMock(return_value="done")
        yield


# ── execute 收敛 → 桥推进 verify，不自动建下一 stage mission ─────────────────


class TestExecuteConvergedAdvance:
    async def test_execute_converged_complete_stage_to_verify(
        self, db_session, _no_redis_publish, _converged
    ):
        """execute mission 收敛 → complete_stage 桥推进 current_stage execute→verify。

        验证三件事：
        - team 桥（``ChangeService.complete_stage``）被调一次，stage=execute/result=None；
        - change.current_stage 真推进到 verify（pending_review 投影据此 + sillyspec.db
          推进，complete_stage 是唯一桥）；
        - **不**自动建下一 stage mission（_dispatch_execute_team / dispatch 零调用）。
        """
        orchestrator_run, _mission, change = await _seed_team(db_session, team_stage="execute")

        real_complete = None
        from app.modules.change.service import ChangeService

        real_complete = ChangeService.complete_stage

        with (
            patch.object(
                ChangeService,
                "complete_stage",
                autospec=True,
                side_effect=real_complete,
            ) as mock_complete,
            patch(
                "app.modules.change.dispatch._dispatch_execute_team",
                new_callable=AsyncMock,
            ) as mock_team_dispatch,
            patch(
                "app.modules.change.dispatch.dispatch",
                new_callable=AsyncMock,
            ) as mock_dispatch,
        ):
            svc = RunSyncService(db_session)
            await svc._trigger_stage_completion_callback(orchestrator_run.id)

            # 桥（complete_stage）必留且被调一次（task-03 契约）：stage=execute。
            mock_complete.assert_awaited_once()
            call_kwargs = mock_complete.await_args.kwargs
            assert call_kwargs["stage"] == "execute"
            assert call_kwargs["result"] is None  # execute 无 gate → result None

            # 无自动连轴：_dispatch_execute_team / dispatch 均不被调。
            mock_team_dispatch.assert_not_called()
            mock_dispatch.assert_not_called()

        # current_stage 真推进 execute→verify（complete_stage 唯一桥生效）。
        await db_session.refresh(change)
        assert change.current_stage == "verify"


# ── verify 收敛 → merge_gate_results + complete_stage(passed) → archive ──────


class TestVerifyConvergedAdvance:
    async def test_verify_all_pass_complete_stage_passed_to_archive(
        self, db_session, _no_redis_publish, _converged
    ):
        """verify 收敛 + 全 worker exit 0 → 合并落主 run + complete_stage(passed)→archive。

        - worker gate_results 经 merge_gate_results 合并落 orchestrator run
          （gate_status=decided）——advance_change_stage / review 的 gate 决策数据源；
        - complete_stage 收 result="passed"（exit 0 视为 passed）；
        - current_stage verify→archive；不自动建 archive mission。
        """
        orchestrator_run, _mission, change = await _seed_team(
            db_session,
            team_stage="verify",
            worker_count=2,
            worker_gate_results=[
                {"exit_code": 0, "errors": []},
                {"exit_code": 0, "errors": []},
            ],
        )

        from app.modules.change.service import ChangeService

        real_complete = ChangeService.complete_stage

        with (
            patch.object(
                ChangeService,
                "complete_stage",
                autospec=True,
                side_effect=real_complete,
            ) as mock_complete,
            patch(
                "app.modules.change.dispatch._dispatch_execute_team",
                new_callable=AsyncMock,
            ) as mock_team_dispatch,
        ):
            svc = RunSyncService(db_session)
            await svc._trigger_stage_completion_callback(orchestrator_run.id)

            # verify+passed → complete_stage 收 result="passed"，stage=verify。
            mock_complete.assert_awaited_once()
            call_kwargs = mock_complete.await_args.kwargs
            assert call_kwargs["stage"] == "verify"
            assert call_kwargs["result"] == "passed"

            # 不自动建 archive team mission。
            mock_team_dispatch.assert_not_called()

        # worker gate 合并落主 run（exit 0）+ gate_status=decided。
        await db_session.refresh(orchestrator_run)
        assert orchestrator_run.gate_result is not None
        assert orchestrator_run.gate_result["exit_code"] == 0
        assert orchestrator_run.gate_status == "decided"

        # current_stage verify→archive。
        await db_session.refresh(change)
        assert change.current_stage == "archive"

    async def test_verify_non_zero_exit_stays_verify(
        self, db_session, _no_redis_publish, _converged
    ):
        """verify 收敛 + 任一 worker 非 0 exit → complete_stage(None) 停 verify。

        非 0 exit 不视为 passed → stage_result=None →
        _resolve_stage_completion(verify, None)=(verify, None)：change 停 verify，
        交 advance_change_stage tool / review 显式决策（形态A：不自动 kickback/block）。
        """
        orchestrator_run, _mission, change = await _seed_team(
            db_session,
            team_stage="verify",
            worker_count=2,
            worker_gate_results=[
                {"exit_code": 0, "errors": []},
                {"exit_code": 1, "errors": ["bug-x"]},
            ],
        )

        from app.modules.change.service import ChangeService

        real_complete = ChangeService.complete_stage

        with (
            patch.object(
                ChangeService,
                "complete_stage",
                autospec=True,
                side_effect=real_complete,
            ) as mock_complete,
            patch(
                "app.modules.change.dispatch._dispatch_execute_team",
                new_callable=AsyncMock,
            ) as mock_team_dispatch,
        ):
            svc = RunSyncService(db_session)
            await svc._trigger_stage_completion_callback(orchestrator_run.id)

            # 非 0 exit → result=None（非 passed）。
            mock_complete.assert_awaited_once()
            assert mock_complete.await_args.kwargs["result"] is None
            mock_team_dispatch.assert_not_called()

        # 合并落主 run 取最严重 exit 1 + gate_status=decided。
        await db_session.refresh(orchestrator_run)
        assert orchestrator_run.gate_result["exit_code"] == 1
        assert orchestrator_run.gate_status == "decided"

        # change 停 verify（未推进 archive），待显式 advance 决策。
        await db_session.refresh(change)
        assert change.current_stage == "verify"
