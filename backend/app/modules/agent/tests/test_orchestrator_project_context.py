"""Tests for project context injection in orchestrator prompt（task-06）。

覆盖：
- team_mission_entry 接收 scope_workspace_ids 列表参数
- AgentMission.scope_workspace_ids 正确写入 JSON（uuid 转字符串）
- render_orchestrator_prompt 注入项目名（project_id 非空时）
- render_orchestrator_prompt 注入 scope 清单（id/name/type/description/在线状态）
- render_orchestrator_prompt 补充 dispatch_worker target_workspace_id 用法说明
- project_id=None 时跳过项目查询（零回归）
- scope_workspace_ids=None 时 prompt 结构与现状一致

2026-08-24-session-team-mission-context task-01 追加：
- collect_scope_workspace_statuses 结构化字段（daemon_name=display_alias||hostname 口径、
  git_mode 仅当传入探测回调时存在、无效 uuid 跳过）
- render_scope_brief 机器/模式字段（未绑机器、git_probe 未传时模式字段整体省略）
- render_session_orchestrator_briefing 关键段（mission_id/锚点工作区/目标/派发范围/
  dispatch_worker 用法/mission_status 提示/禁越权约束）
- render_orchestrator_prompt 零回归+新增机器名字段（patrol 路径无模式字段）
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.model import AgentMission, AgentRun
from app.modules.agent.orchestrator import (
    OrchestratorService,
    collect_scope_workspace_statuses,
    render_orchestrator_prompt,
    render_scope_brief,
    render_session_orchestrator_briefing,
)
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


async def _make_binding_with_named_daemon(
    session: AsyncSession,
    workspace_id: uuid.UUID,
    user_id: uuid.UUID,
    *,
    display_alias: str | None = None,
    daemon_status: str = "online",
) -> uuid.UUID:
    """建 binding + daemon 实例行（机器名/在线状态可控，task-01）。

    与 ``_make_daemon_binding`` 的差别：daemon 行总是创建（含 display_alias），
    在线状态由 ``daemon_status`` 控制——离线机器也能取到机器名。
    """
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
    daemon = DaemonInstance(
        id=daemon_id,
        user_id=user_id,
        hostname=f"host-{daemon_id.hex[:6]}",
        display_alias=display_alias,
        server_url="http://localhost:8001",
        status=daemon_status,
        last_heartbeat_at=datetime.now(UTC),
    )
    session.add(daemon)

    await session.commit()
    await session.refresh(binding)
    return daemon_id


async def _make_mission(
    session: AsyncSession,
    *,
    workspace_id: uuid.UUID,
    user_id: uuid.UUID,
    scope_workspace_ids: list[str] | None,
    objective: str = "团队目标",
) -> AgentMission:
    """建一个已落库的 mission（task-01 共享函数测试用，无 orchestrator run）。"""
    mission = AgentMission(
        id=uuid.uuid4(),
        workspace_id=workspace_id,
        objective=objective,
        created_by=user_id,
        scope_workspace_ids=scope_workspace_ids,
    )
    session.add(mission)
    await session.commit()
    await session.refresh(mission)
    return mission


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


class TestCollectScopeWorkspaceStatuses:
    """collect_scope_workspace_statuses 结构化字段断言（task-01）。"""

    @pytest.mark.asyncio
    async def test_structured_fields_with_display_alias(self, db_session: AsyncSession) -> None:
        """条目字段齐全，daemon_name 取 display_alias（优先于 hostname）。"""
        ws_id = await _make_workspace(
            db_session, name="前端工作区", ws_type="frontend", description="前端代码仓"
        )
        user_id = uuid.uuid4()
        await _make_binding_with_named_daemon(
            db_session, ws_id, user_id, display_alias="我的主力机", daemon_status="online"
        )
        mission = await _make_mission(
            db_session, workspace_id=ws_id, user_id=user_id, scope_workspace_ids=[str(ws_id)]
        )

        entries = await collect_scope_workspace_statuses(mission, db_session)

        assert len(entries) == 1
        entry = entries[0]
        assert entry["id"] == str(ws_id)
        assert entry["name"] == "前端工作区"
        assert entry["type"] == "frontend"
        assert entry["description"] == "前端代码仓"
        assert entry["daemon_online"] is True
        # daemon_name 口径 = display_alias || hostname（display_alias 优先）
        assert entry["daemon_name"] == "我的主力机"

    @pytest.mark.asyncio
    async def test_daemon_name_falls_back_to_hostname_when_offline(
        self, db_session: AsyncSession
    ) -> None:
        """无 display_alias 回退 hostname；daemon 离线时机器名仍可解析。"""
        ws_id = await _make_workspace(db_session, name="后端工作区")
        user_id = uuid.uuid4()
        daemon_id = await _make_binding_with_named_daemon(
            db_session, ws_id, user_id, daemon_status="offline"
        )
        mission = await _make_mission(
            db_session, workspace_id=ws_id, user_id=user_id, scope_workspace_ids=[str(ws_id)]
        )

        entries = await collect_scope_workspace_statuses(mission, db_session)

        assert entries[0]["daemon_online"] is False
        assert entries[0]["daemon_name"] == f"host-{daemon_id.hex[:6]}"

    @pytest.mark.asyncio
    async def test_daemon_name_none_when_no_binding(self, db_session: AsyncSession) -> None:
        """无任何成员 binding → 未绑机器（daemon_name=None + 离线）。"""
        ws_id = await _make_workspace(db_session, name="裸工作区")
        user_id = uuid.uuid4()
        mission = await _make_mission(
            db_session, workspace_id=ws_id, user_id=user_id, scope_workspace_ids=[str(ws_id)]
        )

        entries = await collect_scope_workspace_statuses(mission, db_session)

        assert entries[0]["daemon_name"] is None
        assert entries[0]["daemon_online"] is False

    @pytest.mark.asyncio
    async def test_git_mode_present_only_with_probe(self, db_session: AsyncSession) -> None:
        """git_mode 仅当传入 git_probe 时存在（缺省省略，不写「未知」）。"""
        ws_id = await _make_workspace(db_session, name="探测工作区")
        user_id = uuid.uuid4()
        mission = await _make_mission(
            db_session, workspace_id=ws_id, user_id=user_id, scope_workspace_ids=[str(ws_id)]
        )

        async def _probe(ws: object) -> str:
            return "direct"

        without_probe = await collect_scope_workspace_statuses(mission, db_session)
        assert "git_mode" not in without_probe[0]

        with_probe = await collect_scope_workspace_statuses(mission, db_session, git_probe=_probe)
        assert with_probe[0]["git_mode"] == "direct"

    @pytest.mark.asyncio
    async def test_invalid_scope_ids_skipped(self, db_session: AsyncSession) -> None:
        """无效 uuid 跳过（沿用 render_orchestrator_prompt 原语义）。"""
        ws_id = await _make_workspace(db_session, name="有效工作区")
        user_id = uuid.uuid4()
        mission = await _make_mission(
            db_session,
            workspace_id=ws_id,
            user_id=user_id,
            scope_workspace_ids=["not-a-uuid", str(ws_id)],
        )

        entries = await collect_scope_workspace_statuses(mission, db_session)

        assert len(entries) == 1
        assert entries[0]["id"] == str(ws_id)


class TestRenderScopeBrief:
    """render_scope_brief 机器/模式字段断言（task-01）。"""

    @pytest.mark.asyncio
    async def test_machine_and_online_fields(self, db_session: AsyncSession) -> None:
        """每工作区一行含 机器= 与 daemon=在线|离线；未绑机器显示「未绑机器」。"""
        ws1_id = await _make_workspace(db_session, name="在线工作区")
        ws2_id = await _make_workspace(db_session, name="未绑工作区")
        user_id = uuid.uuid4()
        await _make_binding_with_named_daemon(
            db_session, ws1_id, user_id, display_alias="牛逼的电脑", daemon_status="online"
        )
        mission = await _make_mission(
            db_session,
            workspace_id=ws1_id,
            user_id=user_id,
            scope_workspace_ids=[str(ws1_id), str(ws2_id)],
        )

        brief = await render_scope_brief(mission, db_session)

        lines = brief.splitlines()
        assert len(lines) == 2
        assert lines[0].startswith("- 在线工作区（id=")
        assert "机器=牛逼的电脑" in lines[0]
        assert "daemon=在线" in lines[0]
        assert "机器=未绑机器" in lines[1]
        assert "daemon=离线" in lines[1]

    @pytest.mark.asyncio
    async def test_mode_field_omitted_without_probe(self, db_session: AsyncSession) -> None:
        """git_probe 未传时模式字段整体省略（不渲染 模式=未知）。"""
        ws_id = await _make_workspace(db_session, name="无探测工作区")
        user_id = uuid.uuid4()
        mission = await _make_mission(
            db_session, workspace_id=ws_id, user_id=user_id, scope_workspace_ids=[str(ws_id)]
        )

        brief = await render_scope_brief(mission, db_session)

        assert "模式=" not in brief

    @pytest.mark.asyncio
    async def test_mode_field_rendered_with_probe_three_states(
        self, db_session: AsyncSession
    ) -> None:
        """传入探测回调时追加 模式=git隔离|直通|未知（三态映射）。"""
        ws_git = await _make_workspace(db_session, name="git仓")
        ws_direct = await _make_workspace(db_session, name="共享盘")
        ws_unknown = await _make_workspace(db_session, name="失联机")
        user_id = uuid.uuid4()
        mode_by_name = {"git仓": "git", "共享盘": "direct", "失联机": "unknown"}
        mission = await _make_mission(
            db_session,
            workspace_id=ws_git,
            user_id=user_id,
            scope_workspace_ids=[str(ws_git), str(ws_direct), str(ws_unknown)],
        )

        async def _probe(ws: object) -> str:
            return mode_by_name[ws.name]

        brief = await render_scope_brief(mission, db_session, git_probe=_probe)

        assert "模式=git隔离" in brief
        assert "模式=直通" in brief
        assert "模式=未知" in brief


class TestRenderSessionOrchestratorBriefing:
    """render_session_orchestrator_briefing 关键段断言（task-01 / design §7）。"""

    @pytest.mark.asyncio
    async def test_briefing_key_sections(self, db_session: AsyncSession) -> None:
        """简报含角色说明/mission_id/目标/锚点工作区/派发范围/工具用法/禁越权约束。"""
        anchor_id = await _make_workspace(db_session, name="锚点工作区")
        scope_id = await _make_workspace(db_session, name="范围工作区A", ws_type="frontend")
        user_id = uuid.uuid4()
        await _make_binding_with_named_daemon(
            db_session, scope_id, user_id, display_alias="主力机", daemon_status="online"
        )
        mission = await _make_mission(
            db_session,
            workspace_id=anchor_id,
            user_id=user_id,
            scope_workspace_ids=[str(anchor_id), str(scope_id)],
        )

        briefing = await render_session_orchestrator_briefing(mission, db_session)

        # 角色说明 + 关键 id + 目标 + 锚点工作区
        assert "【团队任务简报（系统注入，仅此一次）】" in briefing
        assert "你是本会话团队任务的主控（orchestrator/项目经理）" in briefing
        assert f"mission_id: {mission.id}" in briefing
        assert "目标: 团队目标" in briefing
        assert f"锚点工作区: 锚点工作区（{anchor_id}）" in briefing
        # 派发范围（调 render_scope_brief，含机器/在线字段）
        assert "- 派发范围:" in briefing
        assert "范围工作区A" in briefing
        assert "机器=主力机" in briefing
        assert "daemon=在线" in briefing
        # dispatch_worker 用法 + mission_status 提示
        assert "dispatch_worker" in briefing
        assert "target_workspace_id" in briefing
        assert "mission_status" in briefing
        # 禁越权约束（复用 render_orchestrator_prompt 既有文案段）
        assert "【硬性约束 — 禁止越权下场（必须遵守，违反即任务失败）】" in briefing
        assert "严禁自己用 Edit/Write/Bash 修改任何实现源码" in briefing

    @pytest.mark.asyncio
    async def test_briefing_mode_field_with_probe(self, db_session: AsyncSession) -> None:
        """简报透传 git_probe：scope 行带 模式= 字段；缺省不带。"""
        ws_id = await _make_workspace(db_session, name="探测简报区")
        user_id = uuid.uuid4()
        mission = await _make_mission(
            db_session, workspace_id=ws_id, user_id=user_id, scope_workspace_ids=[str(ws_id)]
        )

        async def _probe(ws: object) -> str:
            return "git"

        without_probe = await render_session_orchestrator_briefing(mission, db_session)
        assert "模式=" not in without_probe

        with_probe = await render_session_orchestrator_briefing(
            mission, db_session, git_probe=_probe
        )
        assert "模式=git隔离" in with_probe


class TestRenderOrchestratorPromptMachineName:
    """render_orchestrator_prompt 零回归+新增机器名字段断言（task-01 / CC-08）。"""

    @pytest.mark.asyncio
    async def test_prompt_includes_machine_name(self, db_session: AsyncSession) -> None:
        """scope 行新增 机器= 字段（alias/未绑机器），既有段结构不动。"""
        ws1_id = await _make_workspace(db_session, name="在线工作区")
        ws2_id = await _make_workspace(db_session, name="未绑工作区")
        user_id = uuid.uuid4()
        await _make_binding_with_named_daemon(
            db_session, ws1_id, user_id, display_alias="我的主力机", daemon_status="online"
        )
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

        # 新增机器名字段：alias 优先；未绑显示「未绑机器」
        assert "机器=我的主力机" in prompt
        assert "机器=未绑机器" in prompt
        # 既有段零回归（scope 标题/在线状态/用法说明/禁越权）
        assert "派发范围（可落地的工作区）" in prompt
        assert "daemon=在线" in prompt
        assert "按任务性质选工作区" in prompt
        assert "【硬性约束 — 禁止越权下场（必须遵守，违反即任务失败）】" in prompt

    @pytest.mark.asyncio
    async def test_prompt_no_mode_field_without_probe(self, db_session: AsyncSession) -> None:
        """patrol 路径（不传探测回调）模式字段不出现。"""
        ws_id = await _make_workspace(db_session, name="单一工作区")
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

        assert "模式=" not in prompt
