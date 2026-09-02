"""quick 群聊 PPM 项目化 + 成员头像测试（2026-09-02，后端部分）。

覆盖（任务卡口径）：

- 建群 ``project_id`` 必填新口径：项目不存在 400 / 项目无关联工作区 400 /
  未传 workspace_id 自动取首个关联工作区 / 显式 workspace 不在项目关联集 400 /
  Read 透出 project_id；
- 邀请人员范围=项目成员（PpmProjectMember）：邀请非项目成员 400 / 项目成员
  201 / 建群者非项目成员 400；
- agent 成员 cwd 工作区（六要素②）须在项目关联工作区集内：建群与加成员、
  PATCH 热切换越界均 400；
- 存量群（project_id NULL，含项目删除 SET NULL 语义）add_member 回退
  workspace 成员范围（有 workspace 角色 201 / 无角色 400）；
- 成员 avatar 读写往返：建群携带（用户+agent 成员）/ 加成员携带 / PATCH
  改（None=不改）/ Read 透出。

夹具范式镜像 ``test_group_chat_management.py``（quick 后同步的 project_id 口径
fixture：``_make_env`` 落 PPM 项目 + 关联工作区 + 群主项目成员）。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from types import SimpleNamespace
from typing import Any

from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.model import AgentGroupChat, AgentGroupMember
from app.modules.auth.model import Role, RolePermission, User, UserWorkspaceRole
from app.modules.auth.permissions import Permission
from app.modules.daemon.model import DaemonInstance, DaemonRuntime
from app.modules.ppm.project.model import PpmProjectMaintenance, PpmProjectMember
from app.modules.workspace.model import PpmProjectWorkspace, Workspace

# ── Helpers（镜像 test_group_chat_management.py，quick 口径）──────────────────


async def _token_for(user: User) -> str:
    from app.core.config import get_settings
    from app.core.security import create_access_token

    token, _ = create_access_token(
        user_id=user.id,
        email=user.email or "",
        is_admin=bool(user.is_platform_admin),
        settings=get_settings(),
    )
    return token


async def _create_user_with_token(
    db_session: AsyncSession, *, name: str, admin: bool = False
) -> tuple[User, str]:
    user = User(
        id=uuid.uuid4(),
        email=f"grpj-{name}-{uuid.uuid4()}@example.com",
        password_hash="irrelevant",
        display_name=name,
        status="active",
        is_platform_admin=admin,
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return user, await _token_for(user)


def _headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _grant_workspace_role(
    db_session: AsyncSession,
    *,
    workspace_id: uuid.UUID,
    user_id: uuid.UUID,
    permissions: list[Permission],
) -> None:
    role = Role(
        id=uuid.uuid4(),
        key=f"grpj-{uuid.uuid4().hex[:8]}",
        name="group-project-test-role",
        description="quick seed",
        is_system=False,
    )
    db_session.add(role)
    await db_session.flush()
    for p in permissions:
        db_session.add(RolePermission(role_id=role.id, permission=p))
    db_session.add(
        UserWorkspaceRole(
            user_id=user_id,
            workspace_id=workspace_id,
            role_id=role.id,
            granted_by=None,
            granted_at=datetime.now(UTC),
        )
    )
    await db_session.commit()


async def _make_workspace(db_session: AsyncSession, *, name: str = "grpj-ws") -> Workspace:
    slug = f"{name}-{uuid.uuid4().hex[:8]}"
    ws = Workspace(
        id=uuid.uuid4(),
        name=name,
        slug=slug,
        root_path=f"C:/tmp/{slug}",  # root_path 唯一约束：按 slug 唯一化
        status="active",
    )
    db_session.add(ws)
    await db_session.commit()
    await db_session.refresh(ws)
    return ws


async def _make_project(db_session: AsyncSession) -> PpmProjectMaintenance:
    project = PpmProjectMaintenance(
        id=uuid.uuid4(),
        project_code=f"GRPJ-{uuid.uuid4().hex[:12]}",
        project_name="群项目化测试项目",
    )
    db_session.add(project)
    await db_session.commit()
    await db_session.refresh(project)
    return project


async def _link_project_workspace(
    db_session: AsyncSession, *, ppm_project_id: uuid.UUID, workspace_id: uuid.UUID
) -> None:
    db_session.add(PpmProjectWorkspace(ppm_project_id=ppm_project_id, workspace_id=workspace_id))
    await db_session.commit()


async def _add_project_member(
    db_session: AsyncSession, *, ppm_project_id: uuid.UUID, user_id: uuid.UUID
) -> None:
    db_session.add(PpmProjectMember(id=uuid.uuid4(), pm_project_id=ppm_project_id, user_id=user_id))
    await db_session.commit()


async def _make_env(
    db_session: AsyncSession, *, owner_name: str = "群主", with_project: bool = True
) -> SimpleNamespace:
    """群聊环境：workspace + PPM 项目（关联）+ 群主（TASK_RUN_AGENT + 项目成员）+ 机器。

    ``with_project=False``：只关联不落群主项目成员行（建群者非项目成员分支用）。
    """
    ws = await _make_workspace(db_session)
    project = await _make_project(db_session)
    await _link_project_workspace(db_session, ppm_project_id=project.id, workspace_id=ws.id)
    owner, owner_token = await _create_user_with_token(db_session, name=owner_name)
    await _grant_workspace_role(
        db_session,
        workspace_id=ws.id,
        user_id=owner.id,
        permissions=[Permission.TASK_RUN_AGENT],
    )
    if with_project:
        await _add_project_member(db_session, ppm_project_id=project.id, user_id=owner.id)
    instance = DaemonInstance(
        id=uuid.uuid4(),
        user_id=owner.id,
        hostname="grpj-host",
        server_url="http://test.local",
        status="online",
        last_heartbeat_at=datetime.now(UTC),
    )
    db_session.add(instance)
    runtime = DaemonRuntime(
        id=uuid.uuid4(),
        daemon_instance_id=instance.id,
        user_id=owner.id,
        name="grpj-host",
        provider="claude",
        status="online",
        last_heartbeat_at=datetime.now(UTC),
    )
    db_session.add(runtime)
    await db_session.commit()
    return SimpleNamespace(
        ws=ws,
        project=project,
        owner=owner,
        owner_token=owner_token,
        instance=instance,
        runtime=runtime,
    )


async def _env_user(
    db_session: AsyncSession, env: SimpleNamespace, *, name: str, project_member: bool = True
) -> tuple[User, str]:
    """环境内造用户：默认授 workspace 角色 + 项目成员（project_member=False 拆两者，
    供「有 workspace 角色但非项目成员」的负向分支用）。"""
    user, token = await _create_user_with_token(db_session, name=name)
    await _grant_workspace_role(
        db_session,
        workspace_id=env.ws.id,
        user_id=user.id,
        permissions=[Permission.TASK_RUN_AGENT],
    )
    if project_member:
        await _add_project_member(db_session, ppm_project_id=env.project.id, user_id=user.id)
    return user, token


async def _create_group(
    client: AsyncClient,
    owner_token: str,
    *,
    project_id: uuid.UUID,
    workspace_id: uuid.UUID | None = None,
    title: str = "项目群",
    user_members: list[dict[str, Any]] | None = None,
    agent_members: list[dict[str, Any]] | None = None,
) -> Any:
    payload: dict = {"title": title, "project_id": str(project_id)}
    if workspace_id is not None:
        payload["workspace_id"] = str(workspace_id)
    if user_members:
        payload["user_members"] = user_members
    if agent_members:
        payload["agent_members"] = agent_members
    resp = await client.post("/api/daemon/group-chats", json=payload, headers=_headers(owner_token))
    assert resp.status_code == 201, resp.text
    return resp.json()


def _agent_config(runtime_id: uuid.UUID, name: str = "小码") -> dict:
    return {"display_name": name, "runtime_id": str(runtime_id), "provider": "claude"}


# ── 建群 project_id 口径 ──────────────────────────────────────────────────────


class TestCreateGroupProjectScope:
    async def test_project_not_found_400(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        env = await _make_env(db_session, owner_name="pn-owner")
        resp = await client.post(
            "/api/daemon/group-chats",
            json={"title": "幽灵项目群", "project_id": str(uuid.uuid4())},
            headers=_headers(env.owner_token),
        )
        assert resp.status_code == 400, resp.text
        assert "目标项目不存在" in resp.json()["message"]

    async def test_project_without_linked_workspace_400(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        project = await _make_project(db_session)
        owner, owner_token = await _create_user_with_token(db_session, name="nl-owner")
        ws = await _make_workspace(db_session, name="nl-ws")
        await _grant_workspace_role(
            db_session,
            workspace_id=ws.id,
            user_id=owner.id,
            permissions=[Permission.TASK_RUN_AGENT],
        )
        await _add_project_member(db_session, ppm_project_id=project.id, user_id=owner.id)
        resp = await client.post(
            "/api/daemon/group-chats",
            json={"title": "无关联群", "project_id": str(project.id)},
            headers=_headers(owner_token),
        )
        assert resp.status_code == 400, resp.text
        assert "未关联工作区" in resp.json()["message"]

    async def test_workspace_derived_from_project_link(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        """未传 workspace_id：自动取项目首个（唯一）关联工作区；Read 透出 project_id。"""
        env = await _make_env(db_session, owner_name="au-owner")
        data = await _create_group(client, env.owner_token, project_id=env.project.id)
        assert data["workspace_id"] == str(env.ws.id)
        assert data["project_id"] == str(env.project.id)

        group_row = await db_session.get(AgentGroupChat, uuid.UUID(data["id"]))
        assert group_row is not None
        assert group_row.project_id == env.project.id

    async def test_explicit_workspace_outside_project_400(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        env = await _make_env(db_session, owner_name="ow-owner")
        other_ws = await _make_workspace(db_session, name="ow-other-ws")
        resp = await client.post(
            "/api/daemon/group-chats",
            json={
                "title": "越界工作区群",
                "project_id": str(env.project.id),
                "workspace_id": str(other_ws.id),
            },
            headers=_headers(env.owner_token),
        )
        assert resp.status_code == 400, resp.text
        assert "不在项目关联范围内" in resp.json()["message"]

    async def test_explicit_workspace_inside_project_ok(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        """项目关联两个工作区：显式传第二个 → 群落在该工作区。"""
        env = await _make_env(db_session, owner_name="mw-owner")
        ws2 = await _make_workspace(db_session, name="mw-ws2")
        await _link_project_workspace(
            db_session, ppm_project_id=env.project.id, workspace_id=ws2.id
        )
        data = await _create_group(
            client, env.owner_token, project_id=env.project.id, workspace_id=ws2.id
        )
        assert data["workspace_id"] == str(ws2.id)

    async def test_agent_member_workspace_outside_project_400(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        """agent 成员 cwd 工作区（六要素②）不在项目关联集内 → 400（建群口径）。"""
        env = await _make_env(db_session, owner_name="aw-owner")
        other_ws = await _make_workspace(db_session, name="aw-other-ws")
        cfg = _agent_config(env.runtime.id)
        cfg["workspace_id"] = str(other_ws.id)
        resp = await client.post(
            "/api/daemon/group-chats",
            json={
                "title": "越界 cwd 群",
                "project_id": str(env.project.id),
                "agent_members": [cfg],
            },
            headers=_headers(env.owner_token),
        )
        assert resp.status_code == 400, resp.text
        assert "agent 成员的工作区不在项目关联范围内" in resp.json()["message"]


# ── 邀请人员范围=项目成员 ─────────────────────────────────────────────────────


class TestInviteProjectMemberScope:
    async def test_creator_not_project_member_400(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        env = await _make_env(db_session, owner_name="nc-owner", with_project=False)
        resp = await client.post(
            "/api/daemon/group-chats",
            json={"title": "圈外群主群", "project_id": str(env.project.id)},
            headers=_headers(env.owner_token),
        )
        assert resp.status_code == 400, resp.text
        assert "建群者需为项目成员" in resp.json()["message"]

    async def test_invite_non_project_member_400(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        """有 workspace 角色但非项目成员 → 400（范围口径已换轨到项目）。"""
        env = await _make_env(db_session, owner_name="iv-owner")
        outsider, _ = await _env_user(db_session, env, name="iv-outsider", project_member=False)
        resp = await client.post(
            "/api/daemon/group-chats",
            json={
                "title": "越界邀请群",
                "project_id": str(env.project.id),
                "user_members": [{"user_id": str(outsider.id)}],
            },
            headers=_headers(env.owner_token),
        )
        assert resp.status_code == 400, resp.text
        assert "不是项目成员" in resp.json()["message"]

    async def test_invite_project_member_ok(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        env = await _make_env(db_session, owner_name="ok-owner")
        member, _ = await _env_user(db_session, env, name="ok-member")
        data = await _create_group(
            client,
            env.owner_token,
            project_id=env.project.id,
            user_members=[{"user_id": str(member.id)}],
        )
        assert any(m.get("user_id") == str(member.id) for m in data["members"])

    async def test_add_member_project_scope(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        """加成员（建群后）：项目成员 201 / 非项目成员 400。"""
        env = await _make_env(db_session, owner_name="am-owner")
        data = await _create_group(client, env.owner_token, project_id=env.project.id)
        group_id = data["id"]

        member, _ = await _env_user(db_session, env, name="am-member")
        resp = await client.post(
            f"/api/daemon/group-chats/{group_id}/members",
            json={"user": {"user_id": str(member.id)}},
            headers=_headers(env.owner_token),
        )
        assert resp.status_code == 201, resp.text

        outsider, _ = await _env_user(db_session, env, name="am-out", project_member=False)
        resp = await client.post(
            f"/api/daemon/group-chats/{group_id}/members",
            json={"user": {"user_id": str(outsider.id)}},
            headers=_headers(env.owner_token),
        )
        assert resp.status_code == 400, resp.text
        assert "不是项目成员" in resp.json()["message"]

    async def test_update_member_workspace_outside_project_400(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        """PATCH agent 成员 cwd 工作区越界 → 400；集内（补关联后）→ 200。"""
        env = await _make_env(db_session, owner_name="uw-owner")
        data = await _create_group(
            client,
            env.owner_token,
            project_id=env.project.id,
            agent_members=[_agent_config(env.runtime.id)],
        )
        group_id = data["id"]
        agent_member_id = next(m["id"] for m in data["members"] if m["member_type"] == "agent")

        other_ws = await _make_workspace(db_session, name="uw-other-ws")
        resp = await client.patch(
            f"/api/daemon/group-chats/{group_id}/members/{agent_member_id}",
            json={"workspace_id": str(other_ws.id)},
            headers=_headers(env.owner_token),
        )
        assert resp.status_code == 400, resp.text
        assert "不在项目关联范围内" in resp.json()["message"]

        await _link_project_workspace(
            db_session, ppm_project_id=env.project.id, workspace_id=other_ws.id
        )
        resp = await client.patch(
            f"/api/daemon/group-chats/{group_id}/members/{agent_member_id}",
            json={"workspace_id": str(other_ws.id)},
            headers=_headers(env.owner_token),
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["workspace_id"] == str(other_ws.id)


# ── 存量群（project_id NULL）回退 workspace 范围 ─────────────────────────────


class TestLegacyGroupFallback:
    async def test_add_member_falls_back_to_workspace_scope(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        """存量群（project_id NULL）加成员：有 workspace 角色 201 / 无角色 400。"""
        env = await _make_env(db_session, owner_name="fb-owner")
        data = await _create_group(
            client,
            env.owner_token,
            project_id=env.project.id,
            agent_members=[_agent_config(env.runtime.id)],
        )
        group_id = uuid.UUID(data["id"])

        # 模拟存量群：project_id 置 NULL（项目删除 SET NULL 同语义）。
        group_row = await db_session.get(AgentGroupChat, group_id)
        assert group_row is not None
        group_row.project_id = None
        db_session.add(group_row)
        await db_session.commit()

        # 有 workspace 角色（任意）→ 放行。
        ws_user, _ = await _env_user(db_session, env, name="fb-ws-user", project_member=False)
        resp = await client.post(
            f"/api/daemon/group-chats/{data['id']}/members",
            json={"user": {"user_id": str(ws_user.id)}},
            headers=_headers(env.owner_token),
        )
        assert resp.status_code == 201, resp.text

        # 无 workspace 角色、非 platform admin → 400（回退 workspace 成员范围）。
        bare_user, _ = await _create_user_with_token(db_session, name="fb-bare")
        resp = await client.post(
            f"/api/daemon/group-chats/{data['id']}/members",
            json={"user": {"user_id": str(bare_user.id)}},
            headers=_headers(env.owner_token),
        )
        assert resp.status_code == 400, resp.text
        assert "不是该工作区成员" in resp.json()["message"]

        # 存量群 agent 成员 PATCH workspace_id 回退原逻辑（不校验项目集）→ 200。
        agent_rows = (
            (
                await db_session.execute(
                    select(AgentGroupMember).where(
                        AgentGroupMember.group_id == group_id,
                        AgentGroupMember.member_type == "agent",
                    )
                )
            )
            .scalars()
            .all()
        )
        assert agent_rows, "测试前置：群内应有 agent 成员"
        other_ws = await _make_workspace(db_session, name="fb-other-ws")
        resp = await client.patch(
            f"/api/daemon/group-chats/{data['id']}/members/{agent_rows[0].id}",
            json={"workspace_id": str(other_ws.id)},
            headers=_headers(env.owner_token),
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["workspace_id"] == str(other_ws.id)


# ── 成员头像（avatar）读写往返 ───────────────────────────────────────────────


class TestMemberAvatar:
    async def test_create_group_with_avatars(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        env = await _make_env(db_session, owner_name="av-owner")
        member, _ = await _env_user(db_session, env, name="av-member")
        user_avatar = "https://files.example.com/u/avatar.png"
        agent_avatar = "https://files.example.com/a/avatar.png"
        agent_cfg = _agent_config(env.runtime.id)
        agent_cfg["avatar"] = agent_avatar
        data = await _create_group(
            client,
            env.owner_token,
            project_id=env.project.id,
            user_members=[{"user_id": str(member.id), "avatar": user_avatar}],
            agent_members=[agent_cfg],
        )
        by_name = {m["display_name"]: m for m in data["members"]}
        assert by_name["av-member"]["avatar"] == user_avatar
        assert by_name["小码"]["avatar"] == agent_avatar
        # 建群者未自定义 → None。
        assert by_name["av-owner"]["avatar"] is None

    async def test_patch_avatar_roundtrip(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        env = await _make_env(db_session, owner_name="pa-owner")
        member, _ = await _env_user(db_session, env, name="pa-member")
        data = await _create_group(
            client,
            env.owner_token,
            project_id=env.project.id,
            user_members=[{"user_id": str(member.id)}],
        )
        group_id = data["id"]
        member_row_id = next(m["id"] for m in data["members"] if m.get("user_id") == str(member.id))
        assert next(m for m in data["members"] if m["id"] == member_row_id)["avatar"] is None

        avatar = "https://files.example.com/pa/avatar.png"
        resp = await client.patch(
            f"/api/daemon/group-chats/{group_id}/members/{member_row_id}",
            json={"avatar": avatar},
            headers=_headers(env.owner_token),
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["avatar"] == avatar

        # PATCH 不带 avatar（None=不改）→ 头像保持。
        resp = await client.patch(
            f"/api/daemon/group-chats/{group_id}/members/{member_row_id}",
            json={"display_name": "pa-member-改名"},
            headers=_headers(env.owner_token),
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["avatar"] == avatar
        assert resp.json()["display_name"] == "pa-member-改名"

        # 详情 Read 透出。
        resp = await client.get(
            f"/api/daemon/group-chats/{group_id}", headers=_headers(env.owner_token)
        )
        assert resp.status_code == 200, resp.text
        by_id = {m["id"]: m for m in resp.json()["members"]}
        assert by_id[member_row_id]["avatar"] == avatar

    async def test_add_member_with_avatar(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        env = await _make_env(db_session, owner_name="aa-owner")
        data = await _create_group(client, env.owner_token, project_id=env.project.id)
        group_id = data["id"]

        member, _ = await _env_user(db_session, env, name="aa-member")
        avatar = "https://files.example.com/aa/avatar.png"
        resp = await client.post(
            f"/api/daemon/group-chats/{group_id}/members",
            json={"user": {"user_id": str(member.id), "avatar": avatar}},
            headers=_headers(env.owner_token),
        )
        assert resp.status_code == 201, resp.text
        assert resp.json()["avatar"] == avatar

        agent_avatar = "https://files.example.com/aa/agent.png"
        agent_cfg = _agent_config(env.runtime.id, name="aa-助手")
        agent_cfg["avatar"] = agent_avatar
        resp = await client.post(
            f"/api/daemon/group-chats/{group_id}/members",
            json={"agent": agent_cfg},
            headers=_headers(env.owner_token),
        )
        assert resp.status_code == 201, resp.text
        assert resp.json()["avatar"] == agent_avatar
