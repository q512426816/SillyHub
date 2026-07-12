"""Tests for OrchestratorService（2026-07-12-team-main-agent-orchestration task-03 / D-001@v2）。

覆盖：
- ``team_mission_entry``：建 mission（worker_preset/main_agent_config 落库）+ 主 agent
  run（role=orchestrator, mission_id 非空, agent_type/provider/model 从 main_agent_config）。
- daemon 离线 / workspace 未绑定时捕获 NoOnlineDaemonError，run 标 pending +
  error_code=no_online_daemon，mission 仍建。
- ``schedule_loop`` 骨架不抛错（完整逻辑 task-11）。
- 主 agent run 必须写 mission_id（否则 converge_mission_for_completed_run 在
  finalizer.py:206 run.mission_id is None 直接 return，mission 永不收敛）。
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.model import AgentRun
from app.modules.agent.orchestrator import (
    OrchestratorService,
    _resolve_main_agent_config,
)


async def _make_workspace(session: AsyncSession) -> uuid.UUID:
    """建一个真实 workspace 行（外键完整，避免依赖 SQLite 不强制 FK）。"""
    from app.modules.workspace.model import Workspace

    ws_id = uuid.uuid4()
    ws = Workspace(
        id=ws_id,
        name=f"ws-{ws_id.hex[:8]}",
        slug=f"ws-{ws_id.hex[:8]}",
        root_path=f"/tmp/{ws_id.hex}",
    )
    session.add(ws)
    await session.commit()
    return ws_id


class TestTeamMissionEntry:
    @pytest.mark.asyncio
    async def test_builds_mission_and_orchestrator_run(self, db_session: AsyncSession) -> None:
        """mode=team 入口：建 mission（含 preset/config 落库）+ 主 agent run（role=orchestrator, mission_id 非空）。"""
        ws_id = await _make_workspace(db_session)
        user_id = uuid.uuid4()
        preset = [
            {
                "agent_type": "claude_code",
                "model": "gpt-4o",
                "objective": "扫描架构",
                "role": "arch",
            },
            {"agent_type": "claude_code", "model": "gpt-4o", "objective": "写实现", "role": "impl"},
        ]
        main_cfg = {"agent_type": "claude_code", "provider": "claude", "model": "opus"}

        svc = OrchestratorService(db_session)
        mission, main_run = await svc.team_mission_entry(
            workspace_id=ws_id,
            objective="团队目标",
            created_by=user_id,
            change_id=None,
            constraints={"mode": "team"},
            budget_usd=10.0,
            worker_preset=preset,
            main_agent_config=main_cfg,
        )

        # mission 落库
        assert mission.id is not None
        assert mission.workspace_id == ws_id
        assert mission.objective == "团队目标"
        assert mission.worker_preset == preset
        assert mission.main_agent_config == main_cfg
        assert (mission.constraints or {}).get("mode") == "team"

        # 主 agent run：role=orchestrator + mission_id 非空 + 配置从 main_agent_config
        assert main_run.mission_id == mission.id
        assert main_run.role == "orchestrator"
        assert main_run.agent_type == "claude_code"
        assert main_run.provider == "claude"
        assert main_run.model == "opus"
        assert main_run.status == "pending"

    @pytest.mark.asyncio
    async def test_daemon_offline_marks_run_pending_with_error_code(
        self, db_session: AsyncSession
    ) -> None:
        """workspace 未绑定 daemon → dispatch_to_daemon 抛 NoOnlineDaemonError →
        捕获并标 run.error_code=no_online_daemon，mission 仍建。"""
        ws_id = await _make_workspace(db_session)
        svc = OrchestratorService(db_session)
        mission, main_run = await svc.team_mission_entry(
            workspace_id=ws_id,
            objective="团队目标",
            created_by=uuid.uuid4(),
            change_id=None,
            constraints={"mode": "team"},
            budget_usd=None,
            worker_preset=None,
            main_agent_config=None,
        )

        assert mission.id is not None
        # 无 binding → NoOnlineDaemonError 被捕获
        assert main_run.error_code == "no_online_daemon"
        assert main_run.output_redacted is not None
        assert main_run.mission_id == mission.id
        # 默认配置兜底（main_agent_config=None）
        assert main_run.agent_type == "claude_code"
        assert main_run.provider == "claude"

    @pytest.mark.asyncio
    async def test_main_agent_config_defaults_when_none(self, db_session: AsyncSession) -> None:
        """main_agent_config=None → 默认 agent_type=claude_code / provider=claude / model 空串。"""
        cfg = _resolve_main_agent_config(None)
        assert cfg["agent_type"] == "claude_code"
        assert cfg["provider"] == "claude"
        assert cfg["model"] == ""

    @pytest.mark.asyncio
    async def test_main_agent_config_partial_uses_defaults(self, db_session: AsyncSession) -> None:
        """main_agent_config 只给 model → agent_type/provider 走默认。"""
        cfg = _resolve_main_agent_config({"model": "opus-4"})
        assert cfg["agent_type"] == "claude_code"
        assert cfg["provider"] == "claude"
        assert cfg["model"] == "opus-4"

    @pytest.mark.asyncio
    async def test_orchestrator_run_writes_mission_id_for_converge(
        self, db_session: AsyncSession
    ) -> None:
        """主 agent run 必须写 mission_id（converge_mission_for_completed_run 在
        finalizer.py:206 run.mission_id is None 直接 return，mission 永不收敛）。"""
        ws_id = await _make_workspace(db_session)
        svc = OrchestratorService(db_session)
        mission, main_run = await svc.team_mission_entry(
            workspace_id=ws_id,
            objective="团队目标",
            created_by=uuid.uuid4(),
            change_id=None,
            constraints={"mode": "team"},
            budget_usd=None,
            worker_preset=None,
            main_agent_config=None,
        )
        # 从 DB 重查确认 mission_id 持久化（非仅内存对象）
        persisted = (
            (
                await db_session.execute(
                    select(AgentRun).where(
                        AgentRun.id == main_run.id, AgentRun.mission_id == mission.id
                    )
                )
            )
            .scalars()
            .first()
        )
        assert persisted is not None
        assert persisted.role == "orchestrator"


class TestScheduleLoopSkeleton:
    @pytest.mark.asyncio
    async def test_schedule_loop_returns_none(self, db_session: AsyncSession) -> None:
        """schedule_loop 骨架不抛错（完整三重收敛逻辑 task-11 填充）。"""
        ws_id = await _make_workspace(db_session)
        svc = OrchestratorService(db_session)
        mission, _ = await svc.team_mission_entry(
            workspace_id=ws_id,
            objective="团队目标",
            created_by=uuid.uuid4(),
            change_id=None,
            constraints={"mode": "team"},
            budget_usd=None,
            worker_preset=None,
            main_agent_config=None,
        )
        # 骨架只记日志返回 None，不抛
        await svc.schedule_loop(mission.id)
