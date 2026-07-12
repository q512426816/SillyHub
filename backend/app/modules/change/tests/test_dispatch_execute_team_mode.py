"""Execute team-mode dispatch tests (Wave 2 task-09, 2026-07-12-team-mode-platform-wide).

Covers the ``execute`` stage team-mode 分流 in ``dispatch._dispatch_execute_team``
(dispatch.py:904-995) and the team_mode write-back in
``ChangeService.transition_with_dispatch`` (task-07). Three cases:

1. **team_mode 触发**：``change.stages["team_mode"] == True`` + target_stage=execute
   → ``_dispatch_execute_team`` 被调（mock GLM non-None + CoordinatorPlanner +
   MissionService.start_mission 返回 ``(mission, [run1, run2])``），返回
   ``dispatched=True, mode="team", workers=2``。
2. **single 零回归**：``team_mode`` 未设/False（默认）→ 不进入 team 分流，走 single
   AgentRun 路径（``AgentService.start_stage_dispatch`` 被调，``_dispatch_execute_team``
   不被调）。
3. **GLM 未配置兜底**：``team_mode=True`` 但 ``GLMConfig.from_env`` 返回 None →
   ``dispatched=False``，reason 含 ``glm_not_configured``（dispatch.py:928-930 兜底）。

约束：
- GLM 端点不真调（mock ``CoordinatorPlanner.plan`` 用 ``AsyncMock`` 返回空 delegations，
  Wave 1 task-05 踩过 MagicMock 不可 await 的坑）。
- ``MissionService.start_mission`` / ``MissionExecutionService.dispatch_worker`` /
  ``MissionControlService.can_dispatch_worker`` 全 mock，不触 daemon。
- ``dispatch._dispatch_execute_team`` 内 lazy import（dispatch.py:919-926，
  ``from app.modules.agent.X import Y``）→ patch 源模块属性
  ``app.modules.agent.delegation.GLMConfig`` / ``app.modules.agent.mission.MissionService``
  等即可（lazy import 每次执行重读源模块属性，patch 源生效）。
"""

from __future__ import annotations

import uuid
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.model import AgentMission, AgentRun
from app.modules.change.dispatch import _dispatch_execute_team, dispatch
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


def _glm_sentinel() -> MagicMock:
    """A non-None ``GLMConfig``-like sentinel (``from_env`` 不会短路）。"""
    return MagicMock(base_url="https://glm.example", token="tok", model="glm-5.2")


def _planner_stub() -> MagicMock:
    """``CoordinatorPlanner`` stub — ``plan`` 用 AsyncMock 返回空 delegations。

    空 delegations → ``MissionService.start_mission`` 不真去后台 dispatch，配合
    MissionService 整体 mock 后 planner 不被实际调用，但保留 AsyncMock 以防
    被测代码路径意外 await 到它（Wave 1 task-05 踩坑）。
    """
    planner = MagicMock()
    planner.plan = AsyncMock(return_value=("", []))
    return planner


# ── Case 1: team_mode 触发 _dispatch_execute_team ─────────────────────────


class TestExecuteTeamModeDispatched:
    """team_mode=True + target_stage=execute → _dispatch_execute_team 被调。"""

    async def test_team_mode_triggers_team_dispatch(
        self, db_session: AsyncSession, tmp_path: Path
    ) -> None:
        ws = await _create_test_workspace(db_session, root_path=str(tmp_path))
        # task-07 写入：stages["team_mode"] = True
        change = await _create_test_change(
            db_session,
            workspace_id=ws.id,
            current_stage="plan",
            path=str(tmp_path / ".sillyspec" / "changes" / "change" / "test-team"),
            stages={"team_mode": True},
        )
        user_id = uuid.uuid4()

        # AgentMission 不存 status（2026-06-19-multi-agent-orchestration：状态从
        # 子 AgentRun 派生，model.py:506-509 注释明确 status 不持久化）。
        fake_mission = AgentMission(
            id=uuid.uuid4(),
            workspace_id=ws.id,
            objective="objective",
        )
        fake_runs = [
            AgentRun(
                id=uuid.uuid4(),
                change_id=change.id,
                agent_type="claude_code",
                status="pending",
            ),
            AgentRun(
                id=uuid.uuid4(),
                change_id=change.id,
                agent_type="claude_code",
                status="pending",
            ),
        ]

        # patch 源模块（lazy import 在函数体内 from app.modules.agent.X import Y，
        # 每次调用重读源模块属性 → patch 源即生效，而非 app.modules.change.dispatch.X）。
        with (
            patch("app.modules.agent.delegation.GLMConfig") as glm_cls,
            patch("app.modules.agent.delegation.CoordinatorPlanner") as planner_cls,
            patch("app.modules.agent.mission.MissionService") as mission_svc_cls,
            patch("app.modules.agent.control.MissionControlService") as ctrl_cls,
            patch("app.modules.agent.execution.MissionExecutionService") as exec_svc_cls,
        ):
            glm_cls.from_env.return_value = _glm_sentinel()
            planner_cls.return_value = _planner_stub()

            mission_svc = MagicMock()
            mission_svc.start_mission = AsyncMock(return_value=(fake_mission, fake_runs))
            mission_svc_cls.return_value = mission_svc

            # can_dispatch_worker → (True, "")，worker 进入 dispatch_worker
            ctrl = MagicMock()
            ctrl.can_dispatch_worker = AsyncMock(return_value=(True, ""))
            ctrl_cls.return_value = ctrl

            exec_svc = MagicMock()
            exec_svc.dispatch_worker = AsyncMock(return_value=None)
            exec_svc_cls.return_value = exec_svc

            result = await dispatch(
                session=db_session,
                workspace_id=ws.id,
                change_id=change.id,
                target_stage="execute",
                user_id=user_id,
            )

        # 断言：team 分流结果
        assert result["dispatched"] is True
        assert result["mode"] == "team"
        assert result["stage"] == "execute"
        assert result["mission_id"] == str(fake_mission.id)
        assert result["workers"] == 2

        # GLM non-None + MissionService.start_mission 被调一次
        glm_cls.from_env.assert_called_once()
        mission_svc.start_mission.assert_awaited_once()
        # 每个 worker 进 dispatch_worker（can_dispatch_worker 放行）
        assert ctrl.can_dispatch_worker.await_count == 2
        assert exec_svc.dispatch_worker.await_count == 2


# ── Case 2: single 零回归（team_mode 默认 False）─────────────────────────


class TestSingleZeroRegression:
    """team_mode 未设/False → 走 single AgentRun 路径，_dispatch_execute_team 不被调。"""

    async def test_default_no_team_mode_goes_single(
        self, db_session: AsyncSession, tmp_path: Path
    ) -> None:
        ws = await _create_test_workspace(db_session, root_path=str(tmp_path))
        # stages 无 team_mode 键（task-07 默认 team_mode=False 不写入）
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

        防止把 False 误当 truthy 处理：dispatch.py:814 用 ``is True`` 精确判断。
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


# ── Case 3: GLM 未配置兜底 ─────────────────────────────────────────────────


class TestGLMNotConfiguredFallback:
    """team_mode=True 但 GLMConfig.from_env → None → dispatched=False，glm_not_configured。"""

    async def test_glm_not_configured_returns_not_dispatched(
        self, db_session: AsyncSession, tmp_path: Path
    ) -> None:
        ws = await _create_test_workspace(db_session, root_path=str(tmp_path))
        change = await _create_test_change(
            db_session,
            workspace_id=ws.id,
            current_stage="plan",
            path=str(tmp_path / ".sillyspec" / "changes" / "change" / "test-no-glm"),
            stages={"team_mode": True},
        )
        user_id = uuid.uuid4()

        # GLMConfig.from_env → None（dispatch.py:928-930 兜底，应在调 MissionService
        # / CoordinatorPlanner / daemon 之前就 return）。
        with (
            patch("app.modules.agent.delegation.GLMConfig") as glm_cls,
            patch("app.modules.agent.delegation.CoordinatorPlanner") as planner_cls,
            patch("app.modules.agent.mission.MissionService") as mission_svc_cls,
        ):
            glm_cls.from_env.return_value = None  # 关键：未配置
            mission_svc = MagicMock()
            mission_svc.start_mission = AsyncMock()
            mission_svc_cls.return_value = mission_svc

            result = await dispatch(
                session=db_session,
                workspace_id=ws.id,
                change_id=change.id,
                target_stage="execute",
                user_id=user_id,
            )

        assert result["dispatched"] is False
        assert "glm_not_configured" in result["reason"]
        # 兜底应短路：planner / MissionService 都未被实例化调用
        planner_cls.assert_not_called()
        mission_svc.start_mission.assert_not_awaited()


# ── 直测 _dispatch_execute_team（绕过 dispatch() 的分支判定，锁单元行为）─────


class TestDispatchExecuteTeamUnit:
    """直接覆盖 ``_dispatch_execute_team`` 的 happy-path + GLM-None 短路。"""

    async def test_unit_glm_none_short_circuits(self, db_session: AsyncSession) -> None:
        ws = await _create_test_workspace(db_session)
        change = await _create_test_change(
            db_session,
            workspace_id=ws.id,
            stages={"team_mode": True},
        )

        with patch("app.modules.agent.delegation.GLMConfig") as glm_cls:
            glm_cls.from_env.return_value = None
            result = await _dispatch_execute_team(db_session, ws.id, change.id, uuid.uuid4())

        assert result["dispatched"] is False
        assert "glm_not_configured" in result["reason"]

    async def test_unit_happy_path_returns_team(self, db_session: AsyncSession) -> None:
        ws = await _create_test_workspace(db_session)
        change = await _create_test_change(
            db_session,
            workspace_id=ws.id,
            stages={"team_mode": True},
        )

        fake_mission = AgentMission(
            id=uuid.uuid4(),
            workspace_id=ws.id,
            objective="obj",
        )
        fake_runs = [
            AgentRun(
                id=uuid.uuid4(),
                change_id=change.id,
                agent_type="claude_code",
                status="pending",
            )
        ]

        with (
            patch("app.modules.agent.delegation.GLMConfig") as glm_cls,
            patch("app.modules.agent.delegation.CoordinatorPlanner") as planner_cls,
            patch("app.modules.agent.mission.MissionService") as mission_svc_cls,
            patch("app.modules.agent.control.MissionControlService") as ctrl_cls,
            patch("app.modules.agent.execution.MissionExecutionService") as exec_svc_cls,
        ):
            glm_cls.from_env.return_value = _glm_sentinel()
            planner_cls.return_value = _planner_stub()

            mission_svc = MagicMock()
            mission_svc.start_mission = AsyncMock(return_value=(fake_mission, fake_runs))
            mission_svc_cls.return_value = mission_svc

            ctrl = MagicMock()
            ctrl.can_dispatch_worker = AsyncMock(return_value=(True, ""))
            ctrl_cls.return_value = ctrl

            exec_svc = MagicMock()
            exec_svc.dispatch_worker = AsyncMock(return_value=None)
            exec_svc_cls.return_value = exec_svc

            result = await _dispatch_execute_team(db_session, ws.id, change.id, uuid.uuid4())

        assert result["dispatched"] is True
        assert result["mode"] == "team"
        assert result["mission_id"] == str(fake_mission.id)
        assert result["workers"] == 1
