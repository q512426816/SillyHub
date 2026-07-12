"""GLM fallback tests（2026-07-12-team-main-agent-orchestration task-10 / D-004@v2）。

覆盖 ``_dispatch_execute_team`` 的 GLM 退化分支（dispatch.py）。两组核心场景 + 一组
直接单元覆盖：

1. **用户显式选 GLM 模型**（``main_agent_config.provider == "glm"``）→ 直接走 v1
   ``MissionService.start_mission`` + ``CoordinatorPlanner``，不建主 agent run。
   reason=``glm_selected``。
2. **主 agent 派 lease 失败 + GLM 可用**（``main_run.error_code=="no_online_daemon"``）
   → 退化走 v1 GLM（reason=``main_agent_unavailable``）；主 agent run 已建留 DB，
   GLM mission 并行兜底执行。
3. **主 agent 可用 / GLM 不可用** → 走主 agent 链路，无 fallback（零回归 task-09 行为）。

约束（task-10 D-004@v2）：
- v1 GLM 链路（``MissionService.start_mission`` / ``CoordinatorPlanner`` / ``Finalizer``）
  保留不删，本测试直接调 v1 链路确认仍可用。
- GLM 兜底只在该可用时退化（``GLMConfig.from_env() is None`` 时不再二次降级）。
- 大小写不敏感识别 GLM provider（"glm"/"GLM"/"Glm"）。
- fallback 路径明确日志标注（reason / fallback 字段）。
"""

from __future__ import annotations

import uuid
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.delegation import CoordinatorPlanner, Delegation, GLMConfig
from app.modules.agent.model import AgentMission, AgentRun
from app.modules.change.dispatch import (
    _dispatch_execute_team,
    _is_glm_selected,
)
from app.modules.change.model import Change
from app.modules.workspace.model import Workspace

# ── Helpers ────────────────────────────────────────────────────────────────


async def _create_test_workspace(
    session: AsyncSession,
    *,
    root_path: str = "/tmp/test-glm-fallback",
) -> Workspace:
    ws = Workspace(
        id=uuid.uuid4(),
        name="test-glm-fallback",
        root_path=root_path,
        slug="test-glm-fallback",
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
    stages: dict | None = None,
) -> Change:
    change = Change(
        id=uuid.uuid4(),
        workspace_id=workspace_id,
        change_key="2026-07-12-test-glm-fallback",
        title="Test GLM Fallback",
        status="in_progress",
        location="active",
        path="/tmp/test-glm-fallback-change",
        affected_components=["backend"],
        change_type="feature",
        current_stage=current_stage,
        stages=stages if stages is not None else {"team_mode": True},
    )
    session.add(change)
    await session.commit()
    await session.refresh(change)
    return change


def _glm_sentinel() -> GLMConfig:
    """非 None GLMConfig（``from_env`` mock 返回值，标记 GLM 可用）。"""
    return GLMConfig(base_url="https://glm.test", token="tok", model="glm-5.2")


def _stub_planner() -> CoordinatorPlanner:
    """返回固定 delegations 的 CoordinatorPlanner stub（不打真实 HTTP）。"""
    planner = MagicMock(spec=CoordinatorPlanner)
    planner.plan = AsyncMock(
        return_value=(
            "summary",
            [
                Delegation(
                    worker_id="impl_1",
                    role="impl",
                    objective="实现 task-1",
                    expected_artifact="task-1.md",
                    read_only=False,
                ),
            ],
        )
    )
    return planner


# ── Case 1: _is_glm_selected 纯函数 ──────────────────────────────────────


class TestIsGlmSelected:
    """provider 匹配 GLM marker（大小写不敏感）→ True；其他 → False。"""

    def test_provider_glm_lowercase(self) -> None:
        assert _is_glm_selected({"provider": "glm"}) is True

    def test_provider_glm_uppercase(self) -> None:
        assert _is_glm_selected({"provider": "GLM"}) is True

    def test_provider_glm_mixed_case(self) -> None:
        assert _is_glm_selected({"provider": "Glm"}) is True

    def test_provider_claude_not_glm(self) -> None:
        assert _is_glm_selected({"provider": "claude"}) is False

    def test_provider_missing_returns_false(self) -> None:
        """无 provider 字段 → False（默认 provider=claude，走主 agent）。"""
        assert _is_glm_selected({"model": "opus"}) is False

    def test_none_config_returns_false(self) -> None:
        assert _is_glm_selected(None) is False

    def test_empty_provider_returns_false(self) -> None:
        assert _is_glm_selected({"provider": ""}) is False


# ── Case 2: 用户显式选 GLM → 直接走 v1 链路 ─────────────────────────────


class TestGlmExplicitlySelected:
    """main_agent_config.provider == "glm" → 调 MissionService.start_mission（v1），
    不调 OrchestratorService.team_mission_entry。"""

    async def test_glm_selected_calls_v1_start_mission(
        self, db_session: AsyncSession, tmp_path: Path
    ) -> None:
        ws = await _create_test_workspace(db_session, root_path=str(tmp_path))
        change = await _create_test_change(
            db_session,
            workspace_id=ws.id,
            current_stage="plan",
            stages={
                "team_mode": True,
                "team_main_agent_config": {
                    "agent_type": "claude_code",
                    "provider": "glm",
                    "model": "glm-5.2",
                },
            },
        )

        fake_mission = AgentMission(id=uuid.uuid4(), workspace_id=ws.id, objective="obj")

        with (
            patch(
                "app.modules.agent.delegation.GLMConfig.from_env",
                return_value=_glm_sentinel(),
            ),
            patch(
                "app.modules.agent.delegation.CoordinatorPlanner",
                return_value=_stub_planner(),
            ) as planner_cls,
            patch(
                "app.modules.agent.mission.MissionService.start_mission",
                new_callable=AsyncMock,
                return_value=(fake_mission, []),
            ) as mock_start,
            patch("app.modules.agent.orchestrator.OrchestratorService") as orch_cls,
        ):
            result = await _dispatch_execute_team(
                db_session, ws.id, change.id, uuid.uuid4(), "execute"
            )

        # 走 v1 GLM 链路：start_mission 被调，OrchestratorService 零实例化
        assert result["dispatched"] is True
        assert result["mode"] == "team"
        assert result["fallback"] == "glm"
        assert result["fallback_reason"] == "glm_selected"
        assert result["mission_id"] == str(fake_mission.id)
        mock_start.assert_awaited_once()
        orch_cls.assert_not_called()
        # CoordinatorPlanner 被 MissionService 构造（传 planner=...），实际是 stub
        planner_cls.assert_called_once()

    async def test_glm_selected_case_insensitive(self, db_session: AsyncSession) -> None:
        """provider="GLM"（大写）也应识别 → 走 v1 链路。"""
        ws = await _create_test_workspace(db_session)
        change = await _create_test_change(
            db_session,
            workspace_id=ws.id,
            stages={
                "team_mode": True,
                "team_main_agent_config": {"provider": "GLM"},
            },
        )

        fake_mission = AgentMission(id=uuid.uuid4(), workspace_id=ws.id, objective="x")

        with (
            patch(
                "app.modules.agent.delegation.GLMConfig.from_env",
                return_value=_glm_sentinel(),
            ),
            patch(
                "app.modules.agent.delegation.CoordinatorPlanner",
                return_value=_stub_planner(),
            ),
            patch(
                "app.modules.agent.mission.MissionService.start_mission",
                new_callable=AsyncMock,
                return_value=(fake_mission, []),
            ) as mock_start,
            patch("app.modules.agent.orchestrator.OrchestratorService") as orch_cls,
        ):
            result = await _dispatch_execute_team(db_session, ws.id, change.id, uuid.uuid4())

        assert result["dispatched"] is True
        assert result["fallback"] == "glm"
        mock_start.assert_awaited_once()
        orch_cls.assert_not_called()

    async def test_glm_selected_but_glm_unavailable_returns_not_dispatched(
        self, db_session: AsyncSession
    ) -> None:
        """provider="glm" 但 GLM env 未配置（from_env=None）→ dispatched=False，
        reason=glm_unavailable。不再二次降级到主 agent（用户已显式选 GLM）。"""
        ws = await _create_test_workspace(db_session)
        change = await _create_test_change(
            db_session,
            workspace_id=ws.id,
            stages={
                "team_mode": True,
                "team_main_agent_config": {"provider": "glm"},
            },
        )

        with (
            patch(
                "app.modules.agent.delegation.GLMConfig.from_env",
                return_value=None,
            ),
            patch(
                "app.modules.agent.mission.MissionService.start_mission",
                new_callable=AsyncMock,
            ) as mock_start,
            patch("app.modules.agent.orchestrator.OrchestratorService") as orch_cls,
        ):
            result = await _dispatch_execute_team(db_session, ws.id, change.id, uuid.uuid4())

        assert result["dispatched"] is False
        assert result["reason"] == "glm_unavailable"
        assert result["fallback"] == "glm_selected"
        # 不调 start_mission，不实例化 OrchestratorService
        mock_start.assert_not_awaited()
        orch_cls.assert_not_called()


# ── Case 3: 主 agent 不可用 + GLM 可用 → 退化 v1 ──────────────────────────


class TestMainAgentUnavailableFallback:
    """主 agent run error_code=no_online_daemon（无在线 daemon）+ GLM 可用 →
    退化走 v1 GLM（reason=main_agent_unavailable）。"""

    async def test_main_unavailable_glm_available_falls_back(
        self, db_session: AsyncSession
    ) -> None:
        ws = await _create_test_workspace(db_session)
        change = await _create_test_change(
            db_session,
            workspace_id=ws.id,
            stages={
                "team_mode": True,
                # 默认 provider=claude（非 GLM）→ 先走主 agent 链路
                "team_main_agent_config": {"provider": "claude"},
            },
        )

        fake_mission = AgentMission(id=uuid.uuid4(), workspace_id=ws.id, objective="x")
        # 主 agent run 派 lease 失败：error_code=no_online_daemon
        failed_main_run = AgentRun(
            id=uuid.uuid4(),
            change_id=change.id,
            agent_type="claude_code",
            status="pending",
            role="orchestrator",
            error_code="no_online_daemon",
            output_redacted="未检测到在线 daemon",
        )
        glm_mission = AgentMission(id=uuid.uuid4(), workspace_id=ws.id, objective="fallback")

        with (
            patch("app.modules.agent.orchestrator.OrchestratorService") as orch_cls,
            patch("app.modules.change.dispatch._glm_available", return_value=True) as mock_avail,
            patch(
                "app.modules.agent.delegation.GLMConfig.from_env",
                return_value=_glm_sentinel(),
            ),
            patch(
                "app.modules.agent.delegation.CoordinatorPlanner",
                return_value=_stub_planner(),
            ),
            patch(
                "app.modules.agent.mission.MissionService.start_mission",
                new_callable=AsyncMock,
                return_value=(glm_mission, []),
            ) as mock_start,
        ):
            orch = MagicMock()
            orch.team_mission_entry = AsyncMock(return_value=(fake_mission, failed_main_run))
            orch_cls.return_value = orch

            result = await _dispatch_execute_team(db_session, ws.id, change.id, uuid.uuid4())

        # 退化 v1 GLM：fallback=glm, reason=main_agent_unavailable
        assert result["dispatched"] is True
        assert result["mode"] == "team"
        assert result["fallback"] == "glm"
        assert result["fallback_reason"] == "main_agent_unavailable"
        assert result["mission_id"] == str(glm_mission.id)
        # 主 agent 链路先调，GLM 兜底再调
        orch.team_mission_entry.assert_awaited_once()
        mock_start.assert_awaited_once()
        mock_avail.assert_called()

    async def test_main_unavailable_glm_not_available_no_fallback(
        self, db_session: AsyncSession
    ) -> None:
        """主 agent 不可用 + GLM 不可用 → 不退化，返回主 agent 链路结果（reconcile
        后续重派）。零二次降级保护（避免退化也跑不通的链路）。"""
        ws = await _create_test_workspace(db_session)
        change = await _create_test_change(
            db_session,
            workspace_id=ws.id,
            stages={"team_mode": True},  # main_agent_config=None → provider=claude
        )

        fake_mission = AgentMission(id=uuid.uuid4(), workspace_id=ws.id, objective="x")
        failed_main_run = AgentRun(
            id=uuid.uuid4(),
            change_id=change.id,
            agent_type="claude_code",
            status="pending",
            role="orchestrator",
            error_code="no_online_daemon",
        )

        with (
            patch("app.modules.agent.orchestrator.OrchestratorService") as orch_cls,
            patch("app.modules.change.dispatch._glm_available", return_value=False),
            patch(
                "app.modules.agent.mission.MissionService.start_mission",
                new_callable=AsyncMock,
            ) as mock_start,
        ):
            orch = MagicMock()
            orch.team_mission_entry = AsyncMock(return_value=(fake_mission, failed_main_run))
            orch_cls.return_value = orch

            result = await _dispatch_execute_team(db_session, ws.id, change.id, uuid.uuid4())

        # 无 GLM 兜底：返回主 agent 链路结果，标 dispatched=True（pending run 留 DB）
        assert result["dispatched"] is True
        assert result["mode"] == "team"
        assert result["agent_run_id"] == str(failed_main_run.id)
        assert "fallback" not in result
        # v1 GLM 链路零调用
        mock_start.assert_not_awaited()


# ── Case 4: 主 agent 可用 → 不退化（task-09 零回归）─────────────────────


class TestMainAgentAvailableNoFallback:
    """主 agent run 正常（无 error_code）→ 走主 agent 链路，GLM fallback 零调用。"""

    async def test_main_agent_ok_no_glm_call(self, db_session: AsyncSession) -> None:
        ws = await _create_test_workspace(db_session)
        change = await _create_test_change(
            db_session,
            workspace_id=ws.id,
            stages={"team_mode": True, "team_main_agent_config": {"provider": "claude"}},
        )

        fake_mission = AgentMission(id=uuid.uuid4(), workspace_id=ws.id, objective="x")
        healthy_main_run = AgentRun(
            id=uuid.uuid4(),
            change_id=change.id,
            agent_type="claude_code",
            status="pending",
            role="orchestrator",
            error_code=None,
        )

        with (
            patch("app.modules.agent.orchestrator.OrchestratorService") as orch_cls,
            patch(
                "app.modules.agent.mission.MissionService.start_mission",
                new_callable=AsyncMock,
            ) as mock_start,
            patch("app.modules.change.dispatch._glm_available", return_value=True),
        ):
            orch = MagicMock()
            orch.team_mission_entry = AsyncMock(return_value=(fake_mission, healthy_main_run))
            orch_cls.return_value = orch

            result = await _dispatch_execute_team(db_session, ws.id, change.id, uuid.uuid4())

        # 主 agent 链路无 fallback
        assert result["dispatched"] is True
        assert result["mode"] == "team"
        assert result["agent_run_id"] == str(healthy_main_run.id)
        assert "fallback" not in result
        mock_start.assert_not_awaited()


# ── Case 5: v1 GLM 链路保留可用（D-004@v2，回归保护）────────────────────


class TestV1GlmLinkPreserved:
    """v1 ``MissionService.start_mission`` + ``CoordinatorPlanner`` 链路保留可用
    （D-004@v2：fallback 调它，不删不重写）。

    直接调 v1 链路确认 fallback 路径下游可执行（不依赖 dispatch 包装层）。
    """

    @pytest.mark.asyncio
    async def test_v1_start_mission_with_planner_works(self, db_session: AsyncSession) -> None:
        """``MissionService(session, planner=...).start_mission`` 仍可建 mission +
        落 Worker Runs（v1 链路保留）。"""
        from app.modules.agent.mission import MissionService

        ws = await _create_test_workspace(db_session)
        planner = _stub_planner()

        svc = MissionService(db_session, planner=planner)
        mission, runs = await svc.start_mission(
            workspace_id=ws.id,
            objective="v1 link test",
            created_by=uuid.uuid4(),
            change_id=None,
            constraints={"mode": "team"},
        )

        assert mission.id is not None
        # stub planner 返回 1 个 delegation → 1 个 Worker Run
        assert len(runs) == 1
        assert runs[0].role == "impl"
        assert runs[0].status == "pending"
        assert runs[0].mission_id == mission.id
