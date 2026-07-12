"""Execute team-mode dispatch tests（2026-07-12-team-main-agent-orchestration task-09）。

覆盖 ``dispatch._dispatch_execute_team``（dispatch.py，D-004@v2 mode=team → v2
主 agent OrchestratorService）和 ``ChangeService.transition_with_dispatch`` 的
team_mode + worker_preset 写回。三组用例：

1. **team_mode 触发 OrchestratorService**：``change.stages["team_mode"] == True``
   + target_stage=execute/verify → ``_dispatch_execute_team`` 被调，调
   ``OrchestratorService.team_mission_entry``（非 GLM start_mission），返回
   ``dispatched=True, mode="team", mission_id=..., agent_run_id=...``。
2. **single 零回归**：``team_mode`` 未设/False（默认）→ 不进入 team 分流，走 single
   AgentRun 路径（``AgentService.start_stage_dispatch`` 被调，
   ``_dispatch_execute_team`` 不被调）。
3. **worker_preset 透传**：``stages.team_worker_preset`` / ``team_main_agent_config``
   存在时，``_dispatch_execute_team`` 把它们传给 ``team_mission_entry``。

约束（task-09 设计 D-004@v2）：
- mode=team 走 OrchestratorService（D-001@v2），**不再走 GLM CoordinatorPlanner /
  MissionService.start_mission**（GLM fallback 留 task-10）。
- ``OrchestratorService.team_mission_entry`` 整体 mock，不触 daemon lease。
- ``_dispatch_execute_team`` 内 lazy import → patch 源模块属性
  ``app.modules.agent.orchestrator.OrchestratorService`` 即可生效。
- merge_gate_results 策略 A 独立纯函数测试（test 见 TestMergeGateResults）。
"""

from __future__ import annotations

import uuid
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.model import AgentMission, AgentRun
from app.modules.change.dispatch import (
    _dispatch_execute_team,
    dispatch,
    merge_gate_results,
)
from app.modules.change.model import Change
from app.modules.workspace.model import Workspace

# ── Helpers ────────────────────────────────────────────────────────────────


async def _create_test_workspace(
    session: AsyncSession,
    *,
    root_path: str = "/tmp/test-workspace-team",
) -> Workspace:
    ws = Workspace(
        id=uuid.uuid4(),
        name="test-workspace-team",
        root_path=root_path,
        slug="test-workspace-team",
    )
    session.add(ws)
    await session.commit()
    await session.refresh(ws)
    return ws


async def _create_test_change(
    session: AsyncSession,
    *,
    workspace_id: uuid.UUID,
    current_stage: str = "plan",
    path: str = "/tmp/test-change-team",
    stages: dict | None = None,
) -> Change:
    """Create a Change row. ``stages`` defaults to ``{}`` (no team_mode)."""
    change = Change(
        id=uuid.uuid4(),
        workspace_id=workspace_id,
        change_key="2026-07-12-test-team-dispatch",
        title="Test Team Dispatch Change",
        status="in_progress",
        location="active",
        path=path,
        affected_components=["backend"],
        change_type="feature",
        current_stage=current_stage,
        stages=stages if stages is not None else {},
    )
    session.add(change)
    await session.commit()
    await session.refresh(change)
    return change


# ── Case 1: team_mode 触发 OrchestratorService ────────────────────────────


class TestExecuteTeamModeDispatched:
    """team_mode=True + target_stage=execute → _dispatch_execute_team 调 OrchestratorService。"""

    async def test_team_mode_triggers_orchestrator(
        self, db_session: AsyncSession, tmp_path: Path
    ) -> None:
        ws = await _create_test_workspace(db_session, root_path=str(tmp_path))
        change = await _create_test_change(
            db_session,
            workspace_id=ws.id,
            current_stage="plan",
            path=str(tmp_path / ".sillyspec" / "changes" / "change" / "test-team"),
            stages={
                "team_mode": True,
                "team_worker_preset": [
                    {"agent_type": "claude_code", "model": "", "objective": "x", "role": "impl"}
                ],
                "team_main_agent_config": {"agent_type": "claude_code", "provider": "claude"},
            },
        )
        user_id = uuid.uuid4()

        fake_mission = AgentMission(
            id=uuid.uuid4(),
            workspace_id=ws.id,
            objective="objective",
        )
        fake_main_run = AgentRun(
            id=uuid.uuid4(),
            change_id=change.id,
            agent_type="claude_code",
            status="pending",
            role="orchestrator",
        )

        with patch("app.modules.agent.orchestrator.OrchestratorService") as orch_cls:
            orch = MagicMock()
            orch.team_mission_entry = AsyncMock(return_value=(fake_mission, fake_main_run))
            orch_cls.return_value = orch

            result = await dispatch(
                session=db_session,
                workspace_id=ws.id,
                change_id=change.id,
                target_stage="execute",
                user_id=user_id,
            )

        # 断言：team 分流结果（OrchestratorService 链路）
        assert result["dispatched"] is True
        assert result["mode"] == "team"
        assert result["stage"] == "execute"
        assert result["mission_id"] == str(fake_mission.id)
        assert result["agent_run_id"] == str(fake_main_run.id)

        # OrchestratorService.team_mission_entry 被调一次，且透传 worker_preset
        orch.team_mission_entry.assert_awaited_once()
        call_kwargs = orch.team_mission_entry.await_args.kwargs
        assert call_kwargs["workspace_id"] == ws.id
        assert call_kwargs["change_id"] == change.id
        assert call_kwargs["worker_preset"] == [
            {"agent_type": "claude_code", "model": "", "objective": "x", "role": "impl"}
        ]
        assert call_kwargs["main_agent_config"] == {
            "agent_type": "claude_code",
            "provider": "claude",
        }

    async def test_team_mode_verify_stage_routes_team(
        self, db_session: AsyncSession, tmp_path: Path
    ) -> None:
        """target_stage=verify + team_mode=True → 也走 team 分流（task-09 扩展）。"""
        ws = await _create_test_workspace(db_session, root_path=str(tmp_path))
        change = await _create_test_change(
            db_session,
            workspace_id=ws.id,
            current_stage="execute",
            stages={"team_mode": True},
        )

        fake_mission = AgentMission(id=uuid.uuid4(), workspace_id=ws.id, objective="v")
        fake_main_run = AgentRun(
            id=uuid.uuid4(),
            change_id=change.id,
            agent_type="claude_code",
            status="pending",
            role="orchestrator",
        )

        with patch("app.modules.agent.orchestrator.OrchestratorService") as orch_cls:
            orch = MagicMock()
            orch.team_mission_entry = AsyncMock(return_value=(fake_mission, fake_main_run))
            orch_cls.return_value = orch

            result = await dispatch(
                session=db_session,
                workspace_id=ws.id,
                change_id=change.id,
                target_stage="verify",
                user_id=uuid.uuid4(),
            )

        assert result["dispatched"] is True
        assert result["mode"] == "team"
        assert result["stage"] == "verify"
        orch.team_mission_entry.assert_awaited_once()


# ── Case 2: single 零回归（team_mode 默认 False）─────────────────────────


class TestSingleZeroRegression:
    """team_mode 未设/False → 走 single AgentRun 路径，_dispatch_execute_team 不被调。"""

    async def test_default_no_team_mode_goes_single(
        self, db_session: AsyncSession, tmp_path: Path
    ) -> None:
        ws = await _create_test_workspace(db_session, root_path=str(tmp_path))
        # stages 无 team_mode 键（默认 team_mode=False 不写入）
        change = await _create_test_change(
            db_session,
            workspace_id=ws.id,
            current_stage="plan",
            path=str(tmp_path / ".sillyspec" / "changes" / "change" / "test-single"),
            stages={},
        )
        user_id = uuid.uuid4()

        mock_run = AgentRun(
            id=uuid.uuid4(),
            change_id=change.id,
            agent_type="claude_code",
            status="pending",
        )

        with (
            patch(
                "app.modules.agent.service.AgentService.start_stage_dispatch",
                new_callable=AsyncMock,
                return_value=mock_run,
            ) as mock_start,
            patch(
                "app.modules.change.dispatch._dispatch_execute_team",
                new_callable=AsyncMock,
            ) as mock_team,
        ):
            result = await dispatch(
                session=db_session,
                workspace_id=ws.id,
                change_id=change.id,
                target_stage="execute",
                user_id=user_id,
            )

        # 走 single：返回标准 single 字段，无 mode="team"
        assert result["dispatched"] is True
        assert result["agent_run_id"] == str(mock_run.id)
        assert result["stage"] == "execute"
        assert "mode" not in result or result.get("mode") != "team"

        # single AgentService.start_stage_dispatch 被调；team 分流函数零调用
        mock_start.assert_awaited_once()
        mock_team.assert_not_awaited()

    async def test_team_mode_false_explicit_goes_single(
        self, db_session: AsyncSession, tmp_path: Path
    ) -> None:
        """``stages["team_mode"]=False``（显式 single）也走 single 分支。

        防止把 False 误当 truthy 处理：dispatch.py 用 ``is True`` 精确判断。
        """
        ws = await _create_test_workspace(db_session, root_path=str(tmp_path))
        change = await _create_test_change(
            db_session,
            workspace_id=ws.id,
            current_stage="plan",
            path=str(tmp_path / ".sillyspec" / "changes" / "change" / "test-false"),
            stages={"team_mode": False},
        )
        user_id = uuid.uuid4()

        mock_run = AgentRun(
            id=uuid.uuid4(),
            change_id=change.id,
            agent_type="claude_code",
            status="pending",
        )

        with (
            patch(
                "app.modules.agent.service.AgentService.start_stage_dispatch",
                new_callable=AsyncMock,
                return_value=mock_run,
            ),
            patch(
                "app.modules.change.dispatch._dispatch_execute_team",
                new_callable=AsyncMock,
            ) as mock_team,
        ):
            result = await dispatch(
                session=db_session,
                workspace_id=ws.id,
                change_id=change.id,
                target_stage="execute",
                user_id=user_id,
            )

        assert result["dispatched"] is True
        assert result.get("mode") != "team"
        mock_team.assert_not_awaited()


# ── Case 3: 直测 _dispatch_execute_team（锁单元行为）──────────────────────


class TestDispatchExecuteTeamUnit:
    """直接覆盖 ``_dispatch_execute_team`` 的 OrchestratorService 调用 + 异常短路。"""

    async def test_unit_happy_path_returns_team(self, db_session: AsyncSession) -> None:
        ws = await _create_test_workspace(db_session)
        change = await _create_test_change(
            db_session,
            workspace_id=ws.id,
            current_stage="execute",
            stages={"team_mode": True},
        )

        fake_mission = AgentMission(id=uuid.uuid4(), workspace_id=ws.id, objective="obj")
        fake_main_run = AgentRun(
            id=uuid.uuid4(),
            change_id=change.id,
            agent_type="claude_code",
            status="pending",
            role="orchestrator",
        )

        with patch("app.modules.agent.orchestrator.OrchestratorService") as orch_cls:
            orch = MagicMock()
            orch.team_mission_entry = AsyncMock(return_value=(fake_mission, fake_main_run))
            orch_cls.return_value = orch

            result = await _dispatch_execute_team(db_session, ws.id, change.id, uuid.uuid4())

        assert result["dispatched"] is True
        assert result["mode"] == "team"
        assert result["mission_id"] == str(fake_mission.id)
        assert result["agent_run_id"] == str(fake_main_run.id)
        orch.team_mission_entry.assert_awaited_once()

    async def test_unit_orchestrator_exception_returns_not_dispatched(
        self, db_session: AsyncSession
    ) -> None:
        """OrchestratorService.team_mission_entry 抛异常 → dispatched=False。"""
        ws = await _create_test_workspace(db_session)
        change = await _create_test_change(
            db_session,
            workspace_id=ws.id,
            stages={"team_mode": True},
        )

        with patch("app.modules.agent.orchestrator.OrchestratorService") as orch_cls:
            orch = MagicMock()
            orch.team_mission_entry = AsyncMock(side_effect=RuntimeError("boom"))
            orch_cls.return_value = orch

            result = await _dispatch_execute_team(db_session, ws.id, change.id, uuid.uuid4())

        assert result["dispatched"] is False
        assert "execute_team_orchestrator_failed" in result["reason"]


# ── Case 4: merge_gate_results 策略 A 纯函数 ──────────────────────────────


class TestMergeGateResults:
    """verify team gate 合并（策略 A：全 exit=0 才过，任一非 0 取最严重，exit 2 优先）。"""

    def test_empty_list_returns_exit_0(self) -> None:
        result = merge_gate_results([])
        assert result["exit_code"] == 0
        assert result["errors"] == []
        assert result["worker_count"] == 0

    def test_all_exit_0_returns_exit_0(self) -> None:
        result = merge_gate_results(
            [
                {"exit_code": 0, "errors": []},
                {"exit_code": 0, "errors": []},
            ]
        )
        assert result["exit_code"] == 0
        assert result["errors"] == []
        assert result["worker_count"] == 2

    def test_any_exit_1_returns_exit_1(self) -> None:
        result = merge_gate_results(
            [
                {"exit_code": 0, "errors": []},
                {"exit_code": 1, "errors": ["bug"]},
            ]
        )
        assert result["exit_code"] == 1
        assert "[worker 2] bug" in result["errors"]

    def test_exit_2_takes_priority_over_exit_1(self) -> None:
        """exit 2（卡住报警）优先于 exit 1（打回返工）——取最严重。"""
        result = merge_gate_results(
            [
                {"exit_code": 1, "errors": ["minor"]},
                {"exit_code": 2, "errors": ["fatal"]},
                {"exit_code": 0, "errors": []},
            ]
        )
        assert result["exit_code"] == 2
        # errors 汇总所有非 0 worker（exit 1 + exit 2）
        assert len(result["errors"]) == 2
        assert result["worker_count"] == 3

    def test_errors_aggregated_with_worker_prefix(self) -> None:
        result = merge_gate_results(
            [
                {"exit_code": 1, "errors": ["a", "b"]},
                {"exit_code": 1, "errors": ["c"]},
            ]
        )
        assert result["exit_code"] == 1
        assert "[worker 1] a" in result["errors"]
        assert "[worker 1] b" in result["errors"]
        assert "[worker 2] c" in result["errors"]

    def test_non_dict_entry_skipped(self) -> None:
        """非 dict 条目跳过不崩（防御）。"""
        result = merge_gate_results([{"exit_code": 0}, "junk", None])  # type: ignore[list-item]
        assert result["exit_code"] == 0
        assert result["worker_count"] == 3
