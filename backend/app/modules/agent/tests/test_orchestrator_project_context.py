"""Tests for project context injection in orchestrator prompt（task-06）。

覆盖：
- team_mission_entry 接收 scope_workspace_ids 列表参数
- AgentMission.scope_workspace_ids 正确写入 JSON（uuid 转字符串）
- render_orchestrator_prompt 注入项目名（project_id 非空时）
- render_orchestrator_prompt 注入 scope 清单（id/name/type/description/在线状态）
- render_orchestrator_prompt 补充 dispatch_worker target_workspace_id 用法说明
- project_id=None 时跳过项目查询（零回归）
- scope_workspace_ids=None 时 prompt 结构与现状一致
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.model import AgentMission, AgentRun
from app.modules.agent.orchestrator import OrchestratorService, render_orchestrator_prompt
from app.modules.daemon.model import DaemonInstance
from app.modules.ppm.project.model import PpmProjectMaintenance
from app.modules.workspace.member_runtimes.model import WorkspaceMemberRuntime
from app.modules.workspace.model import Workspace


@pytest.fixture(autouse=True)
def _mock_converge(monkeypatch: pytest.MonkeyPatch) -> None:
    """module 级 autouse：所有用例不真跑 finalizer converge（RPC/httpx 等待）。"""
    import app.modules.agent.finalizer as _finalizer_mod

    async def _fake_converge(session, run_id, glm_config=None):
        return "done"

    monkeypatch.setattr(_finalizer_mod, "converge_mission_for_completed_run", _fake_converge)


async def _make_workspace(
    session: AsyncSession,
    name: str | None = None,
    ws_type: str | None = None,
    description: str | None = None,
) -> uuid.UUID:
    """建一个真实 workspace 行（外键完整，避免依赖 SQLite 不强制 FK）。"""
    ws_id = uuid.uuid4()
    ws = Workspace(
        id=ws_id,
        name=name or f"ws-{ws_id.hex[:8]}",
        slug=f"ws-{ws_id.hex[:8]}",
        root_path=f"/tmp/{ws_id.hex}",
        type=ws_type,
        description=description,
    )
    session.add(ws)
    await session.commit()
    await session.refresh(ws)
    return ws_id


async def _make_project(
    session: AsyncSession,
    project_name: str,
) -> uuid.UUID:
    """建一个真实 PpmProjectMaintenance 行。"""
    project_id = uuid.uuid4()
    project = PpmProjectMaintenance(
        id=project_id,
        project_name=project_name,
        project_code=f"PROJ-{project_id.hex[:8].upper()}",
        project_status="active",
    )
    session.add(project)
    await session.commit()
    await session.refresh(project)
    return project_id


async def _make_daemon_binding(
    session: AsyncSession,
    workspace_id: uuid.UUID,
    user_id: uuid.UUID,
    online: bool = True,
) -> uuid.UUID | None:
    """建一个 workspace binding 行（可选在线 daemon）。"""
    daemon_id = uuid.uuid4()
    binding = WorkspaceMemberRuntime(
        workspace_id=workspace_id,
        user_id=user_id,
        daemon_id=daemon_id,
        shared=False,
        root_path=f"/tmp/ws-{workspace_id.hex[:8]}",
        path_source="member",
    )
    session.add(binding)

    if online:
        daemon = DaemonInstance(
            id=daemon_id,
            user_id=user_id,
            hostname=f"host-{daemon_id.hex[:6]}",
            server_url="http://localhost:8001",
            status="online",
            last_heartbeat_at=datetime.now(UTC),
        )
        session.add(daemon)

    await session.commit()
    await session.refresh(binding)
    return daemon_id if online else None


class TestTeamMissionEntryScope:
    """测试 team_mission_entry 接收 scope_workspace_ids 参数并落库。"""

    @pytest.mark.asyncio
    async def test_accepts_scope_workspace_ids(self, db_session: AsyncSession) -> None:
        """team_mission_entry 可接收 scope 列表参数。"""
        ws_id = await _make_workspace(db_session)
        user_id = uuid.uuid4()
        scope_ids = [uuid.uuid4(), uuid.uuid4()]

        svc = OrchestratorService(db_session)
        mission, _main_run = await svc.team_mission_entry(
            workspace_id=ws_id,
            objective="团队目标",
            created_by=user_id,
            change_id=None,
            constraints=None,
            budget_usd=None,
            worker_preset=None,
            main_agent_config=None,
            scope_workspace_ids=scope_ids,
        )

        assert mission is not None
        assert _main_run is not None
        # scope_workspace_ids 应写入 JSON 列（uuid 转字符串）
        assert mission.scope_workspace_ids is not None
        assert len(mission.scope_workspace_ids) == 2
        assert all(isinstance(sid, str) for sid in mission.scope_workspace_ids)
        assert str(scope_ids[0]) in mission.scope_workspace_ids
        assert str(scope_ids[1]) in mission.scope_workspace_ids

    @pytest.mark.asyncio
    async def test_scope_workspace_ids_defaults_to_none(self, db_session: AsyncSession) -> None:
        """scope_workspace_ids 缺省为 None（零回归）。"""
        ws_id = await _make_workspace(db_session)
        user_id = uuid.uuid4()

        svc = OrchestratorService(db_session)
        mission, _main_run = await svc.team_mission_entry(
            workspace_id=ws_id,
            objective="团队目标",
            created_by=user_id,
            change_id=None,
            constraints=None,
            budget_usd=None,
            worker_preset=None,
            main_agent_config=None,
        )

        assert mission is not None
        assert mission.scope_workspace_ids is None

    @pytest.mark.asyncio
    async def test_scope_workspace_ids_persists_json(self, db_session: AsyncSession) -> None:
        """scope_workspace_ids 正确写入 JSON 列（uuid 转字符串）。"""
        ws_id = await _make_workspace(db_session)
        user_id = uuid.uuid4()
        scope_ids = [uuid.uuid4(), uuid.uuid4(), uuid.uuid4()]

        svc = OrchestratorService(db_session)
        mission, _ = await svc.team_mission_entry(
            workspace_id=ws_id,
            objective="团队目标",
            created_by=user_id,
            change_id=None,
            constraints=None,
            budget_usd=None,
            worker_preset=None,
            main_agent_config=None,
            scope_workspace_ids=scope_ids,
        )

        # 从数据库重新读取，验证 JSON 持久化
        await db_session.commit()
        await db_session.refresh(mission)

        assert mission.scope_workspace_ids is not None
        assert len(mission.scope_workspace_ids) == 3
        # 验证是字符串列表（不是 uuid 对象）
        assert all(isinstance(sid, str) for sid in mission.scope_workspace_ids)
        # 验证内容正确
        expected_strs = {str(sid) for sid in scope_ids}
        actual_strs = set(mission.scope_workspace_ids)
        assert expected_strs == actual_strs


class TestRenderOrchestratorPromptProjectContext:
    """测试 render_orchestrator_prompt 注入项目上下文。"""

    @pytest.mark.asyncio
    async def test_injects_project_name_when_project_id_set(self, db_session: AsyncSession) -> None:
        """project_id 非空时，prompt 注入项目名字段。"""
        ws_id = await _make_workspace(db_session)
        project_id = await _make_project(db_session, "测试项目A")
        user_id = uuid.uuid4()

        mission = AgentMission(
            id=uuid.uuid4(),
            workspace_id=ws_id,
            project_id=project_id,
            objective="团队目标",
            created_by=user_id,
        )
        db_session.add(mission)
        await db_session.commit()
        await db_session.refresh(mission)

        orchestrator_run = AgentRun(
            id=uuid.uuid4(),
            mission_id=mission.id,
            agent_type="claude_code",
            status="pending",
            role="orchestrator",
            objective="团队目标",
        )
        db_session.add(orchestrator_run)
        await db_session.commit()
        await db_session.refresh(orchestrator_run)

        prompt = await render_orchestrator_prompt(mission, orchestrator_run, db_session)

        # prompt 应包含项目名
        assert "测试项目A" in prompt
        assert "项目名" in prompt

    @pytest.mark.asyncio
    async def test_skips_project_query_when_project_id_none(self, db_session: AsyncSession) -> None:
        """project_id=None 时跳过项目查询（零回归）。"""
        ws_id = await _make_workspace(db_session)
        user_id = uuid.uuid4()

        mission = AgentMission(
            id=uuid.uuid4(),
            workspace_id=ws_id,
            project_id=None,
            objective="团队目标",
            created_by=user_id,
        )
        db_session.add(mission)
        await db_session.commit()
        await db_session.refresh(mission)

        orchestrator_run = AgentRun(
            id=uuid.uuid4(),
            mission_id=mission.id,
            agent_type="claude_code",
            status="pending",
            role="orchestrator",
            objective="团队目标",
        )
        db_session.add(orchestrator_run)
        await db_session.commit()
        await db_session.refresh(orchestrator_run)

        prompt = await render_orchestrator_prompt(mission, orchestrator_run, db_session)

        # prompt 不应包含项目名（project_id=None）
        assert "项目名" not in prompt
        # 但应包含其他既有内容（workspace_id/mission_id）
        assert f"workspace_id：`{ws_id}`" in prompt
        assert f"mission_id：`{mission.id}`" in prompt

    @pytest.mark.asyncio
    async def test_injects_scope_list_with_type(self, db_session: AsyncSession) -> None:
        """prompt 注入 scope 清单（含 type 徽标语义）。"""
        ws1_id = await _make_workspace(db_session, name="前端工作区", ws_type="frontend")
        ws2_id = await _make_workspace(db_session, name="后端工作区", ws_type="backend")
        user_id = uuid.uuid4()

        mission = AgentMission(
            id=uuid.uuid4(),
            workspace_id=ws1_id,
            objective="团队目标",
            created_by=user_id,
            scope_workspace_ids=[str(ws1_id), str(ws2_id)],
        )
        db_session.add(mission)
        await db_session.commit()
        await db_session.refresh(mission)

        orchestrator_run = AgentRun(
            id=uuid.uuid4(),
            mission_id=mission.id,
            agent_type="claude_code",
            status="pending",
            role="orchestrator",
            objective="团队目标",
        )
        db_session.add(orchestrator_run)
        await db_session.commit()
        await db_session.refresh(orchestrator_run)

        prompt = await render_orchestrator_prompt(mission, orchestrator_run, db_session)

        # prompt 应包含 scope 清单（含工作区 id/name/type）
        assert "前端工作区" in prompt
        assert "后端工作区" in prompt
        assert "frontend" in prompt
        assert "backend" in prompt
        # 应包含 scope 清单标题
        assert "派发范围" in prompt or "scope" in prompt.lower()

    @pytest.mark.asyncio
    async def test_injects_scope_list_with_online_status(self, db_session: AsyncSession) -> None:
        """prompt 注入 scope 清单（含 daemon 在线状态）。"""
        ws1_id = await _make_workspace(db_session, name="在线工作区")
        ws2_id = await _make_workspace(db_session, name="离线工作区")
        user_id = uuid.uuid4()

        # ws1 有在线 daemon
        await _make_daemon_binding(db_session, ws1_id, user_id, online=True)
        # ws2 无在线 daemon
        await _make_daemon_binding(db_session, ws2_id, user_id, online=False)

        mission = AgentMission(
            id=uuid.uuid4(),
            workspace_id=ws1_id,
            objective="团队目标",
            created_by=user_id,
            scope_workspace_ids=[str(ws1_id), str(ws2_id)],
        )
        db_session.add(mission)
        await db_session.commit()
        await db_session.refresh(mission)

        orchestrator_run = AgentRun(
            id=uuid.uuid4(),
            mission_id=mission.id,
            agent_type="claude_code",
            status="pending",
            role="orchestrator",
            objective="团队目标",
        )
        db_session.add(orchestrator_run)
        await db_session.commit()
        await db_session.refresh(orchestrator_run)

        prompt = await render_orchestrator_prompt(mission, orchestrator_run, db_session)

        # prompt 应包含在线状态信息
        assert "在线" in prompt or "online" in prompt.lower()

    @pytest.mark.asyncio
    async def test_injects_dispatch_worker_target_usage(self, db_session: AsyncSession) -> None:
        """prompt 补充 dispatch_worker 的 target_workspace_id 参数用法说明。"""
        ws_id = await _make_workspace(db_session)
        user_id = uuid.uuid4()

        mission = AgentMission(
            id=uuid.uuid4(),
            workspace_id=ws_id,
            objective="团队目标",
            created_by=user_id,
            scope_workspace_ids=[str(ws_id)],
        )
        db_session.add(mission)
        await db_session.commit()
        await db_session.refresh(mission)

        orchestrator_run = AgentRun(
            id=uuid.uuid4(),
            mission_id=mission.id,
            agent_type="claude_code",
            status="pending",
            role="orchestrator",
            objective="团队目标",
        )
        db_session.add(orchestrator_run)
        await db_session.commit()
        await db_session.refresh(orchestrator_run)

        prompt = await render_orchestrator_prompt(mission, orchestrator_run, db_session)

        # prompt 应包含 target_workspace_id 用法说明
        assert "target_workspace_id" in prompt
        assert "前端任务" in prompt or "后端任务" in prompt or "按任务性质选工作区" in prompt

    @pytest.mark.asyncio
    async def test_prompt_consistent_when_scope_none(self, db_session: AsyncSession) -> None:
        """scope_workspace_ids=None 时 prompt 结构与现状一致（零回归）。"""
        ws_id = await _make_workspace(db_session)
        user_id = uuid.uuid4()

        mission = AgentMission(
            id=uuid.uuid4(),
            workspace_id=ws_id,
            objective="团队目标",
            created_by=user_id,
            scope_workspace_ids=None,  # None 单 workspace 模式
        )
        db_session.add(mission)
        await db_session.commit()
        await db_session.refresh(mission)

        orchestrator_run = AgentRun(
            id=uuid.uuid4(),
            mission_id=mission.id,
            agent_type="claude_code",
            status="pending",
            role="orchestrator",
            objective="团队目标",
        )
        db_session.add(orchestrator_run)
        await db_session.commit()
        await db_session.refresh(orchestrator_run)

        prompt = await render_orchestrator_prompt(mission, orchestrator_run, db_session)

        # prompt 应包含基本内容（workspace_id/mission_id/主 agent run_id）
        assert f"workspace_id：`{ws_id}`" in prompt
        assert f"mission_id：`{mission.id}`" in prompt
        assert f"run_id（report_progress 的 run_id 参数）：`{orchestrator_run.id}`" in prompt
        # scope=None 时不注入 scope 清单（避免误导）
        # 但 injection 是增量追加，核心内容仍在
        assert "你是多 Agent 团队的主 agent（项目经理，role=orchestrator）" in prompt
