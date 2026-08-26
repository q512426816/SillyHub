"""GET /missions/status 端点测试（2026-08-24-session-team-mission-context task-03 / FR-02）。

覆盖任务卡 acceptance：
- 无 X-Session-Id → 400（header-only 单段路由无任何路径锚）。
- 会话缺失 → 404。
- 无活跃 mission → 200 active=false + hint（D-012：不走 _resolve_session_mission
  的 404 语义；响应不泄露 scope/binding 信息）。
- 有活跃 mission → 200 全字段组装（status=derive_status 派生 / scope 经
  collect_scope_workspace_statuses+probe_workspace_git_mode 实时探测三态 /
  anchor=条目中 id==mission.workspace_id / workers 与 _list_workers_core 同源 /
  objective/budget_usd 直取 mission 列）。
- 越权（对锚工作区无 WORKSPACE_WRITE）→ 403（require_permission_any 通过后
  _check_workspace_write 按锚工作区复核拦截）。
- 单段路由可达性：GET /api/missions/status 返回 200 而非 422（agent router 把
  mcp_tools include（router.py:940）在 GET /missions/{mission_id}（:946）之前，
  单段 GET 先注册先匹配，未被 uuid 校验截走）。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.model import AgentMission, AgentRun, AgentSession
from app.modules.auth.model import Role, RolePermission, User, UserWorkspaceRole
from app.modules.daemon.host_fs.delegate import HostFsDelegate
from app.modules.daemon.model import DaemonInstance
from app.modules.workspace.member_runtimes.model import WorkspaceMemberRuntime
from app.modules.workspace.model import Workspace


async def _make_workspace(
    session: AsyncSession,
    name: str | None = None,
    ws_type: str | None = None,
) -> uuid.UUID:
    """建一个 workspace 行（含可选 type，供 scope 条目 type 字段断言）。"""
    ws_id = uuid.uuid4()
    session.add(
        Workspace(
            id=ws_id,
            name=name or f"ws-{ws_id.hex[:8]}",
            slug=f"ws-{ws_id.hex[:8]}",
            root_path=f"/tmp/{ws_id.hex}",
            type=ws_type,
        )
    )
    await session.commit()
    return ws_id


async def _seed_agent_session(
    session: AsyncSession,
    *,
    workspace_id: uuid.UUID | None = None,
) -> AgentSession:
    """建 AgentSession（可选绑定 workspace），返回会话行。"""
    agent_session = AgentSession(
        id=uuid.uuid4(),
        user_id=uuid.uuid4(),
        provider="claude",
        status="active",
        workspace_id=workspace_id,
    )
    session.add(agent_session)
    await session.commit()
    await session.refresh(agent_session)
    return agent_session


async def _seed_active_mission(
    session: AsyncSession,
    agent_session: AgentSession,
    *,
    scope_workspace_ids: list[str] | None = None,
    objective: str = "会话团队任务",
    budget_usd: float | None = None,
) -> AgentMission:
    """建会话活跃 mission（session_id 落列，converged/cancelled 均 NULL）。"""
    mission = AgentMission(
        workspace_id=agent_session.workspace_id,
        objective=objective,
        session_id=agent_session.id,
        scope_workspace_ids=scope_workspace_ids,
        budget_usd=budget_usd,
    )
    session.add(mission)
    await session.commit()
    await session.refresh(mission)
    return mission


async def _make_binding_with_named_daemon(
    session: AsyncSession,
    workspace_id: uuid.UUID,
    *,
    display_alias: str | None = None,
    daemon_status: str = "online",
) -> None:
    """建 workspace binding + 在线可控的 daemon 实例行（机器名/在线断言用）。

    与 test_orchestrator_project_context 同款 ORM 播种：binding 属主 user_id 与
    daemon_instances.user_id 一致，满足 query_daemon_online_by_id 的属主校验。
    """
    user_id = uuid.uuid4()
    daemon_id = uuid.uuid4()
    session.add(
        WorkspaceMemberRuntime(
            workspace_id=workspace_id,
            user_id=user_id,
            daemon_id=daemon_id,
            shared=False,
            root_path=f"/tmp/ws-{workspace_id.hex[:8]}",
            path_source="member",
        )
    )
    session.add(
        DaemonInstance(
            id=daemon_id,
            user_id=user_id,
            hostname=f"host-{daemon_id.hex[:6]}",
            display_alias=display_alias,
            server_url="http://localhost:8001",
            status=daemon_status,
            last_heartbeat_at=datetime.now(UTC),
        )
    )
    await session.commit()


async def _make_granted_user(
    session: AsyncSession,
    *,
    workspace_id: uuid.UUID,
    permission: str,
) -> User:
    """建非管理员用户并只在指定 workspace 授一个含 permission 的角色。"""
    user = User(
        id=uuid.uuid4(),
        email=f"user-{uuid.uuid4().hex[:8]}@example.com",
        password_hash="not-a-real-hash",
        display_name="普通用户",
        status="active",
        is_platform_admin=False,
    )
    role_id = uuid.uuid4()
    session.add(
        Role(
            id=role_id,
            key=f"role-{role_id.hex[:8]}",
            name=f"Role {role_id.hex[:8]}",
            description="test role",
        )
    )
    session.add(RolePermission(role_id=role_id, permission=permission))
    session.add(
        UserWorkspaceRole(
            user_id=user.id,
            workspace_id=workspace_id,
            role_id=role_id,
            granted_by=None,
            granted_at=datetime.now(UTC),
        )
    )
    session.add(user)
    await session.commit()
    await session.refresh(user)
    return user


def _token_for(user: User) -> str:
    from app.core.config import get_settings
    from app.core.security import create_access_token

    token, _ = create_access_token(
        user_id=user.id,
        email=user.email,
        is_admin=bool(user.is_platform_admin),
        settings=get_settings(),
    )
    return token


class TestMissionsStatusRoute:
    """header-only GET /missions/status（X-Session-Id 定位，D-005/D-012）。"""

    @pytest.mark.asyncio
    async def test_missing_header_400(self, client, db_session, auth_headers) -> None:
        """无 X-Session-Id（本路由无任何路径锚）→ 400 提示缺会话头。"""
        resp = await client.get("/api/missions/status", headers=auth_headers)
        assert resp.status_code == 400, resp.text
        assert "X-Session-Id" in resp.text

    @pytest.mark.asyncio
    async def test_session_not_found_404(self, client, db_session, auth_headers) -> None:
        """X-Session-Id 指向不存在的会话 → 404 session not found。"""
        resp = await client.get(
            "/api/missions/status",
            headers={**auth_headers, "X-Session-Id": str(uuid.uuid4())},
        )
        assert resp.status_code == 404, resp.text

    @pytest.mark.asyncio
    async def test_no_active_mission_returns_active_false_200(
        self, client, db_session, auth_headers
    ) -> None:
        """会话存在但无活跃 mission → 200 active=false + hint，不 404（D-012 单测
        锚点：不走 _resolve_session_mission）；响应不泄露 scope/binding 信息。"""
        agent_session = await _seed_agent_session(db_session, workspace_id=uuid.uuid4())

        resp = await client.get(
            "/api/missions/status",
            headers={**auth_headers, "X-Session-Id": str(agent_session.id)},
        )
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert data["active"] is False
        assert data["hint"]
        # 不泄露 scope/binding/mission 概要（默认值原样）
        assert data["mission_id"] is None
        assert data["status"] is None
        assert data["anchor_workspace"] is None
        assert data["scope_workspaces"] == []
        assert data["workers"] == []

    @pytest.mark.asyncio
    async def test_active_mission_full_fields_200(
        self, client, db_session, auth_headers, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """有活跃 mission → 200 全字段组装（派生状态/实时探测/anchor/workers 同源）。

        同时充当单段路由可达性锚点：200 非 422（未被 GET /missions/{mission_id}
        的 uuid 校验截走）。
        """
        anchor_ws_id = await _make_workspace(db_session, name="锚点工作区")
        second_ws_id = await _make_workspace(db_session, name="第二工作区", ws_type="frontend")
        agent_session = await _seed_agent_session(db_session, workspace_id=anchor_ws_id)
        mission = await _seed_active_mission(
            db_session,
            agent_session,
            scope_workspace_ids=[str(anchor_ws_id), str(second_ws_id)],
            objective="分析这个项目是干什么的",
            budget_usd=12.5,
        )
        # 锚点无 binding（未绑机器/离线）；第二工作区有在线 binding（机器名口径
        # display_alias||hostname）。
        await _make_binding_with_named_daemon(
            db_session, second_ws_id, display_alias="牛逼的电脑", daemon_status="online"
        )
        # 主控轮终态 + 分身 pending → derive_status = running（派生口径，不落库）。
        db_session.add(
            AgentRun(
                mission_id=mission.id,
                agent_type="claude_code",
                provider="claude",
                status="completed",
                role="orchestrator",
            )
        )
        db_session.add(
            AgentRun(
                mission_id=mission.id,
                agent_type="claude_code",
                status="pending",
                role="arch",
                objective="扫描架构",
            )
        )
        await db_session.commit()

        # git 三态探测回调接线（task-02 helper 注入 task-01 收集器）：patch 方法层，
        # 断言每次调用实时探测且按工作区返回。
        probed: list[str] = []

        async def _fake_probe(self: HostFsDelegate, workspace: Workspace) -> str:
            probed.append(str(workspace.id))
            return "direct" if str(workspace.id) == str(second_ws_id) else "git"

        monkeypatch.setattr(HostFsDelegate, "probe_workspace_git_mode", _fake_probe)

        resp = await client.get(
            "/api/missions/status",
            headers={**auth_headers, "X-Session-Id": str(agent_session.id)},
        )
        # 单段 GET /missions/status 可达（include 顺序保证），非 422
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert data["active"] is True
        assert data["mission_id"] == str(mission.id)
        assert data["status"] == "running"
        assert data["objective"] == "分析这个项目是干什么的"
        assert data["budget_usd"] == 12.5

        # scope 条目：每工作区一条，实时探测 git_mode 三态
        assert len(data["scope_workspaces"]) == 2
        by_id = {item["id"]: item for item in data["scope_workspaces"]}
        anchor_item = by_id[str(anchor_ws_id)]
        assert anchor_item["name"] == "锚点工作区"
        assert anchor_item["daemon_online"] is False  # 无 binding
        assert anchor_item["daemon_name"] is None
        assert anchor_item["git_mode"] == "git"
        assert anchor_item["root_path"] == f"/tmp/{anchor_ws_id.hex}"
        second_item = by_id[str(second_ws_id)]
        assert second_item["type"] == "frontend"
        assert second_item["daemon_online"] is True
        assert second_item["daemon_name"] == "牛逼的电脑"  # display_alias 优先
        assert second_item["git_mode"] == "direct"
        # 探测回调对两个 scope 工作区各调用一次（实时探测，不缓存）
        assert sorted(probed) == sorted([str(anchor_ws_id), str(second_ws_id)])

        # anchor_workspace = 条目中 id == mission.workspace_id 者
        assert data["anchor_workspace"] == anchor_item

        # workers 与 _list_workers_core 同源（FR-09 补漏后主控轮不混入——分身
        # 行化口径对齐 _team_mission_summary / non_orchestrator_runs）
        assert {w["role"] for w in data["workers"]} == {"arch"}
        assert len(data["workers"]) == 1

    @pytest.mark.asyncio
    async def test_forbidden_without_anchor_workspace_write_403(self, client, db_session) -> None:
        """越权 403：用户在其它工作区有 WORKSPACE_WRITE（过 require_permission_any），
        但对 mission 锚工作区无权限 → _check_workspace_write 复核拦截。"""
        other_ws_id = await _make_workspace(db_session, name="用户自己的工作区")
        user = await _make_granted_user(
            db_session,
            workspace_id=other_ws_id,
            permission="workspace:write",
        )

        anchor_ws_id = await _make_workspace(db_session, name="别人的锚点工作区")
        agent_session = await _seed_agent_session(db_session, workspace_id=anchor_ws_id)
        await _seed_active_mission(
            db_session, agent_session, scope_workspace_ids=[str(anchor_ws_id)]
        )

        resp = await client.get(
            "/api/missions/status",
            headers={
                "Authorization": f"Bearer {_token_for(user)}",
                "X-Session-Id": str(agent_session.id),
            },
        )
        assert resp.status_code == 403, resp.text


class TestMissionsStatusSessionVariant:
    """会话维度同构路由 GET /sessions/{session_id}/missions/status（三族同构）。"""

    @pytest.mark.asyncio
    async def test_path_session_id_locates_without_header(
        self, client, db_session, auth_headers
    ) -> None:
        """路径 session_id 定位（header 缺席回落路径锚）→ 无活跃 mission 同样
        active=false 200（与 header-only 族同一 core 同一语义）。"""
        agent_session = await _seed_agent_session(db_session, workspace_id=uuid.uuid4())

        resp = await client.get(
            f"/api/sessions/{agent_session.id}/missions/status",
            headers=auth_headers,
        )
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert data["active"] is False
        assert data["hint"]

    @pytest.mark.asyncio
    async def test_header_path_mismatch_400(self, client, db_session, auth_headers) -> None:
        """X-Session-Id 与路径 session_id 不一致 → 400（防歧义，_request_session_id）。"""
        agent_session = await _seed_agent_session(db_session, workspace_id=uuid.uuid4())
        resp = await client.get(
            f"/api/sessions/{agent_session.id}/missions/status",
            headers={**auth_headers, "X-Session-Id": str(uuid.uuid4())},
        )
        assert resp.status_code == 400, resp.text


# ── ql-20260826-012：scope 收集批量化（原每 ws 4 条查询 → 3 条固定查询）────────


@pytest.mark.asyncio
async def test_collect_scope_batched_matches_single(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """批量收集与逐 ws collect_single_workspace_status 结果一致 + 查询数恒定。

    3 个工作区三种形态：在线 daemon / 离线 daemon / 未绑。原实现每 ws 4 条
    查询（Workspace get + binding select + online 查询 + daemon get），批量化后
    整个 scope 收集固定 3 条（workspaces IN + bindings IN + daemons IN）。
    """
    from app.modules.agent.orchestrator import (
        collect_scope_workspace_statuses,
        collect_single_workspace_status,
    )

    ws_online = await _make_workspace(db_session, name="ws-online")
    ws_offline = await _make_workspace(db_session, name="ws-offline")
    ws_unbound = await _make_workspace(db_session, name="ws-unbound")
    await _make_binding_with_named_daemon(db_session, ws_online, display_alias="主机A")
    await _make_binding_with_named_daemon(db_session, ws_offline, daemon_status="offline")

    mission = AgentMission(
        workspace_id=ws_online,
        objective="batch equivalence",
        scope_workspace_ids=[
            str(ws_online),
            str(ws_offline),
            str(ws_unbound),
            "not-a-uuid",  # 无效 id 跳过（沿用原语义）
        ],
    )
    db_session.add(mission)
    await db_session.commit()

    counter = {"n": 0}
    orig_execute = db_session.execute

    async def counting_execute(*args: object, **kwargs: object):
        counter["n"] += 1
        return await orig_execute(*args, **kwargs)

    monkeypatch.setattr(db_session, "execute", counting_execute)
    try:
        entries = await collect_scope_workspace_statuses(mission, db_session)
    finally:
        monkeypatch.setattr(db_session, "execute", orig_execute)

    assert len(entries) == 3
    # 顺序契约：条目跟随 scope_workspace_ids 声明序（IN 查询不保证返回顺序，
    # 简报渲染依赖声明序；无效 uuid 跳过不占位）。
    assert [e["name"] for e in entries] == ["ws-online", "ws-offline", "ws-unbound"]
    by_name = {e["name"]: e for e in entries}
    assert by_name["ws-online"]["daemon_online"] is True
    assert by_name["ws-online"]["daemon_name"] == "主机A"
    assert by_name["ws-offline"]["daemon_online"] is False
    assert by_name["ws-offline"]["daemon_name"] is not None  # 离线但机器名仍返回
    assert by_name["ws-unbound"]["daemon_online"] is False
    assert by_name["ws-unbound"]["daemon_name"] is None

    # 口径一致性：与单 ws 收集逐字段相等（含 id/type/description/root_path）。
    for ws_id in (ws_online, ws_offline, ws_unbound):
        ws_row = await db_session.get(Workspace, ws_id)
        assert ws_row is not None
        single = await collect_single_workspace_status(db_session, ws_row)
        assert single == by_name[single["name"]], f"批量与单查口径漂移：{single['name']}"

    # 查询数恒定：workspaces IN + bindings IN + daemons IN = 3。
    assert counter["n"] == 3, f"批量收集应为 3 条固定查询，实际 {counter['n']}"
