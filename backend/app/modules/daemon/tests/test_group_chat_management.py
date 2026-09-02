"""task-02（2026-09-01-session-group-chat）群管理服务与权限分支测试。

覆盖（design §5.3/§6.1/§8/§11，任务卡 acceptance）：

- 权限矩阵：成员读 / 非成员 404（不泄露存在性）/ workspace admin 兜底 /
  群主专属操作（成员 403）；
- 建群：群会话 ``kind='group'`` 创建 + 聚合根 + 初始成员（建群者成员行）；
  上限（agent 8 / 用户 50 含建群者）与昵称重复（用户与 agent 共用命名空间）
  均 400；
- 成员 CRUD：加用户/agent 成员、重复邀请 400、移除后复活、改昵称冲突 400、
  agent 六要素改（落库 + config_snapshot 同步）、用户成员改六要素 400、
  移除群主 400；
- reset-memory：本卡无影子会话 → 幂等置位（pending + 指针置 NULL）；
- kind 过滤不泄漏：群会话 / group_member 影子会话不进普通会话列表
  （默认 'chat'），显式 session_kind 覆盖可查；
- 解散链：群会话 ended + 群行 ended_at + 影子 end（含影子队列 pending 行
  删除）+ shadow_status='ended' + 幂等；
- 权限分支继承：daemon 会话详情/日志/SSE 端点对群会话走参与者判定；
  file_artifacts ``_check_session_permission`` 群分支。

P1 修复回归（2026-09-01 群聊变更代码审查）：

- 已移除成员昵称占用：唯一约束 ``uq_agent_group_members_group_display_name``
  全量含已移除行——移除「小码」后同名新增 / 在群成员改名撞已移除行昵称
  均 400（非 INSERT/UPDATE 撞约束 500）；
- 建群入参一致性：重复 user_id（不同昵称绕过撞名检查）/ 邀请建群者本人
  （建群者自动入群）→ 400（非撞 (group_id, user_id) 部分唯一索引 500）；
- 解散群向群频道 ``agent_session:{群id}`` 广播 ``session_ended``（群 SSE
  生成器只认该事件收流）。

夹具范式镜像 ``test_sessions_list_filters.py`` / ``test_session_create_config.py``
（in-memory SQLite + httpx ASGI client + 手签 JWT + workspace 角色播种——
端点门 TASK_RUN_AGENT 需 workspace 角色，platform admin 短路免播）。
"""

from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from unittest.mock import patch as mock_patch

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.model import (
    AgentGroupChat,
    AgentGroupMember,
    AgentSession,
    AgentSessionQueuedMessage,
)
from app.modules.auth.model import Role, RolePermission, User, UserWorkspaceRole
from app.modules.auth.permissions import Permission
from app.modules.daemon.model import DaemonInstance, DaemonRuntime, DaemonTaskLease
from app.modules.ppm.project.model import PpmProjectMaintenance, PpmProjectMember
from app.modules.workspace.model import PpmProjectWorkspace, Workspace

# ── Helpers ──────────────────────────────────────────────────────────────────


async def _token_for(user: User) -> str:
    """为用户行手签 JWT（get_current_principal Bearer 路径）。"""
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
        email=f"group-{name}-{uuid.uuid4()}@example.com",
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
    """给用户授 workspace 角色（test_session_create_config._grant_workspace_role 先例）。"""
    role = Role(
        id=uuid.uuid4(),
        key=f"grp-{uuid.uuid4().hex[:8]}",
        name="group-test-role",
        description="task-02 seed",
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


async def _make_workspace(db_session: AsyncSession) -> Workspace:
    ws = Workspace(
        id=uuid.uuid4(),
        name="group-ws",
        slug=f"group-ws-{uuid.uuid4().hex[:8]}",
        root_path="C:/tmp/group-ws",
        status="active",
    )
    db_session.add(ws)
    await db_session.commit()
    await db_session.refresh(ws)
    return ws


async def _seed_runtime(
    db_session: AsyncSession, user_id: uuid.UUID, *, hostname: str = "group-host"
) -> tuple[DaemonInstance, DaemonRuntime]:
    instance = DaemonInstance(
        id=uuid.uuid4(),
        user_id=user_id,
        hostname=hostname,
        server_url="http://test.local",
        status="online",
        last_heartbeat_at=datetime.now(UTC),
    )
    db_session.add(instance)
    runtime = DaemonRuntime(
        id=uuid.uuid4(),
        daemon_instance_id=instance.id,
        user_id=user_id,
        name=hostname,
        provider="claude",
        status="online",
        last_heartbeat_at=datetime.now(UTC),
    )
    db_session.add(runtime)
    await db_session.commit()
    return instance, runtime


async def _make_project(db_session: AsyncSession) -> PpmProjectMaintenance:
    """PPM 项目行（quick 群 PPM 项目化：建群 project_id 口径）。"""
    project = PpmProjectMaintenance(
        id=uuid.uuid4(),
        project_code=f"GRP-{uuid.uuid4().hex[:12]}",
        project_name="群聊测试项目",
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


async def _make_env(db_session: AsyncSession, *, owner_name: str = "群主") -> SimpleNamespace:
    """每测试的群聊环境：workspace + 群主（TASK_RUN_AGENT 角色）+ 在线机器。"""
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
    await _add_project_member(db_session, ppm_project_id=project.id, user_id=owner.id)
    instance, runtime = await _seed_runtime(db_session, owner.id)
    return SimpleNamespace(
        ws=ws,
        project=project,
        owner=owner,
        owner_token=owner_token,
        instance=instance,
        runtime=runtime,
    )


async def _env_user(
    db_session: AsyncSession, env: SimpleNamespace, *, name: str, admin: bool = False
) -> tuple[User, str]:
    """在环境 workspace 内造用户（默认普通角色=端点门 TASK_RUN_AGENT）。"""
    user, token = await _create_user_with_token(db_session, name=name, admin=admin)
    await _grant_workspace_role(
        db_session,
        workspace_id=env.ws.id,
        user_id=user.id,
        permissions=[Permission.TASK_RUN_AGENT],
    )
    await _add_project_member(db_session, ppm_project_id=env.project.id, user_id=user.id)
    return user, token


async def _create_group(
    client: AsyncClient,
    owner_token: str,
    *,
    project_id: uuid.UUID,
    workspace_id: uuid.UUID | None = None,
    title: str = "测试群",
    user_members: list[dict] | None = None,
    agent_members: list[dict] | None = None,
) -> dict:
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


async def _seed_shadow_session(
    db_session: AsyncSession,
    *,
    member: AgentGroupMember,
    owner_user_id: uuid.UUID,
    runtime_id: uuid.UUID | None = None,
) -> tuple[AgentSession, DaemonTaskLease]:
    """直接落一行影子会话 + interactive lease + pending 排队消息（task-03 前的测试替身）。

    影子会话本卡无懒建链路——解散/移除的 end 影子逻辑用本替身驱动：合法
    interactive lease + active 状态 + pending 队列行，断言 end 链收口与队列清理。
    """
    lease = DaemonTaskLease(
        id=uuid.uuid4(),
        runtime_id=runtime_id,
        kind="interactive",
        status="active",
        created_at=datetime.now(UTC),
        updated_at=datetime.now(UTC),
    )
    db_session.add(lease)
    await db_session.flush()
    shadow = AgentSession(
        id=uuid.uuid4(),
        user_id=owner_user_id,  # 影子 user_id=群主（design §9.2）
        runtime_id=runtime_id,
        lease_id=lease.id,
        provider="claude",
        status="active",
        turn_count=1,
        created_at=datetime.now(UTC),
        session_kind="group_member",
    )
    db_session.add(shadow)
    await db_session.flush()
    db_session.add(
        AgentSessionQueuedMessage(
            id=uuid.uuid4(),
            agent_session_id=shadow.id,
            sender_user_id=owner_user_id,
            prompt="@小码 排队消息",
            status="pending",
            position=0,
        )
    )
    member.shadow_session_id = shadow.id
    member.shadow_status = "active"
    db_session.add(member)
    await db_session.commit()
    return shadow, lease


async def _get_member_row(
    db_session: AsyncSession, *, group_id: uuid.UUID, member_id: uuid.UUID
) -> AgentGroupMember | None:
    return (
        await db_session.execute(
            select(AgentGroupMember).where(
                AgentGroupMember.id == member_id,
                AgentGroupMember.group_id == group_id,
            )
        )
    ).scalar_one_or_none()


async def _list_queued(
    db_session: AsyncSession, session_id: uuid.UUID
) -> list[AgentSessionQueuedMessage]:
    return list(
        (
            await db_session.execute(
                select(AgentSessionQueuedMessage).where(
                    AgentSessionQueuedMessage.agent_session_id == session_id
                )
            )
        )
        .scalars()
        .all()
    )


@pytest.fixture()
def mocked_group_redis():
    """群频道 publish 替身（group service 侧 get_redis）——test_group_realtime 先例。"""
    redis = AsyncMock()
    redis.publish = AsyncMock()
    with mock_patch("app.modules.daemon.group.service.get_redis", return_value=redis):
        yield redis


def _channel_publishes(redis: AsyncMock, session_id: uuid.UUID) -> list[dict]:
    """从 fake redis publish 调用记录中筛出 ``agent_session:{id}`` 频道 payload。"""
    out = []
    for call in redis.publish.call_args_list:
        if call.args[0] == f"agent_session:{session_id}":
            out.append(json.loads(call.args[1]))
    return out


# ── 建群 ─────────────────────────────────────────────────────────────────────


class TestCreateGroupChat:
    async def test_create_group_full_shape(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        env = await _make_env(db_session)
        member_user, _ = await _env_user(db_session, env, name="小英")

        data = await _create_group(
            client,
            env.owner_token,
            project_id=env.project.id,
            user_members=[{"user_id": str(member_user.id)}],
            agent_members=[_agent_config(env.runtime.id)],
        )
        assert data["title"] == "测试群"
        assert data["workspace_id"] == str(env.ws.id)
        assert data["created_by"] == str(env.owner.id)
        assert data["agent_cross_mention"] is True
        assert data["cross_mention_depth"] == 4
        assert data["context_window"] == 20
        assert data["ended_at"] is None
        # 成员：建群者（自动成员行）+ 受邀用户 + agent 成员。
        by_name = {m["display_name"]: m for m in data["members"]}
        assert set(by_name) == {"群主", "小英", "小码"}
        assert by_name["群主"]["member_type"] == "user"
        assert by_name["群主"]["user_id"] == str(env.owner.id)
        agent_member = by_name["小码"]
        assert agent_member["member_type"] == "agent"
        assert agent_member["runtime_id"] == str(env.runtime.id)
        assert agent_member["workspace_id"] == str(env.ws.id)  # None=沿用群工作区
        assert agent_member["provider"] == "claude"
        assert agent_member["shadow_status"] == "none"
        assert agent_member["config_snapshot"]["machine_name"] == "group-host"

        # 群会话 kind='group'（design §8 group.created）+ 聚合根 id==session_id。
        group_session = await db_session.get(AgentSession, uuid.UUID(data["session_id"]))
        assert group_session is not None
        assert group_session.session_kind == "group"
        assert group_session.status == "active"
        assert group_session.workspace_id == env.ws.id
        group_row = await db_session.get(AgentGroupChat, uuid.UUID(data["id"]))
        assert group_row is not None
        assert group_row.id == group_row.session_id == group_session.id
        assert group_row.created_by == env.owner.id

    async def test_create_group_agent_limit_400(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        env = await _make_env(db_session, owner_name="limit-owner")
        agents = [
            _agent_config(env.runtime.id, name=f"agent{i}")
            for i in range(9)  # 上限 8
        ]
        resp = await client.post(
            "/api/daemon/group-chats",
            json={
                "title": "超限群",
                "project_id": str(env.project.id),
                "agent_members": agents,
            },
            headers=_headers(env.owner_token),
        )
        assert resp.status_code == 400, resp.text
        assert "agent 成员上限" in resp.json()["message"]

    async def test_create_group_user_limit_400(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        env = await _make_env(db_session, owner_name="ul-owner")
        extra = []
        for i in range(50):  # +建群者 = 51 > 50
            u, _ = await _create_user_with_token(db_session, name=f"ul-user{i}")
            extra.append({"user_id": str(u.id)})
        resp = await client.post(
            "/api/daemon/group-chats",
            json={"title": "超限群", "project_id": str(env.project.id), "user_members": extra},
            headers=_headers(env.owner_token),
        )
        assert resp.status_code == 400, resp.text
        assert "用户成员上限" in resp.json()["message"]

    async def test_create_group_duplicate_display_name_400(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        env = await _make_env(db_session, owner_name="dup-owner")
        member_user, _ = await _env_user(db_session, env, name="撞名")
        # agent 昵称与用户昵称（默认沿用用户显示名）撞名 → 400。
        resp = await client.post(
            "/api/daemon/group-chats",
            json={
                "title": "撞名群",
                "project_id": str(env.project.id),
                "user_members": [{"user_id": str(member_user.id)}],
                "agent_members": [_agent_config(env.runtime.id, name="撞名")],
            },
            headers=_headers(env.owner_token),
        )
        assert resp.status_code == 400, resp.text
        assert "已被使用" in resp.json()["message"]

    async def test_create_group_reserved_name_400(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        env = await _make_env(db_session, owner_name="res-owner")
        resp = await client.post(
            "/api/daemon/group-chats",
            json={
                "title": "保留词群",
                "project_id": str(env.project.id),
                "agent_members": [_agent_config(env.runtime.id, name="全体")],
            },
            headers=_headers(env.owner_token),
        )
        assert resp.status_code == 400, resp.text
        assert "保留词" in resp.json()["message"]

    async def test_create_group_workspace_not_in_project_400(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        """quick 群 PPM 项目化：显式传入的工作区不在项目关联集内 → 400。"""
        env = await _make_env(db_session, owner_name="ws-owner")
        resp = await client.post(
            "/api/daemon/group-chats",
            json={
                "title": "越界工作区",
                "project_id": str(env.project.id),
                "workspace_id": str(uuid.uuid4()),
            },
            headers=_headers(env.owner_token),
        )
        assert resp.status_code == 400, resp.text
        assert "不在项目关联范围内" in resp.json()["message"]

    async def test_create_group_duplicate_user_invite_400(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        """P1 回归：同一 user_id 邀请两次（不同昵称，绕过撞名检查）→ 400 非 500。

        直落库会撞 (group_id, user_id) 部分唯一索引 ``uq_agent_group_members_
        group_user``——入参去重前置拦截。
        """
        env = await _make_env(db_session, owner_name="du-owner")
        member_user, _ = await _env_user(db_session, env, name="du-member")
        resp = await client.post(
            "/api/daemon/group-chats",
            json={
                "title": "重复邀请群",
                "project_id": str(env.project.id),
                "user_members": [
                    {"user_id": str(member_user.id)},
                    {"user_id": str(member_user.id), "display_name": "du-member-别名"},
                ],
            },
            headers=_headers(env.owner_token),
        )
        assert resp.status_code == 400, resp.text
        assert "重复邀请同一用户" in resp.json()["message"]
        assert resp.json()["details"]["duplicate_user_ids"] == [str(member_user.id)]

    async def test_create_group_invite_owner_self_400(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        """P1 回归：邀请建群者本人（不同昵称绕过撞名检查）→ 400 非 500。

        建群者自动落成员行，再邀请 = 同一 user_id 双 INSERT 撞部分唯一索引。
        """
        env = await _make_env(db_session, owner_name="sf-owner")
        resp = await client.post(
            "/api/daemon/group-chats",
            json={
                "title": "自邀请群",
                "project_id": str(env.project.id),
                "user_members": [{"user_id": str(env.owner.id), "display_name": "分身"}],
            },
            headers=_headers(env.owner_token),
        )
        assert resp.status_code == 400, resp.text
        assert "无需邀请自己" in resp.json()["message"]


# ── 权限矩阵 ─────────────────────────────────────────────────────────────────


class TestGroupPermissionMatrix:
    async def test_member_and_non_member_and_admin(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        env = await _make_env(db_session, owner_name="pm-owner")
        member, member_token = await _env_user(db_session, env, name="pm-member")
        _outsider, outsider_token = await _env_user(db_session, env, name="pm-outsider")
        # workspace admin（非 platform admin）：TASK_RUN_AGENT + WORKSPACE_ADMIN。
        ws_admin, ws_admin_token = await _create_user_with_token(db_session, name="pm-wsadmin")
        await _grant_workspace_role(
            db_session,
            workspace_id=env.ws.id,
            user_id=ws_admin.id,
            permissions=[Permission.TASK_RUN_AGENT, Permission.WORKSPACE_ADMIN],
        )

        data = await _create_group(
            client,
            env.owner_token,
            project_id=env.project.id,
            user_members=[{"user_id": str(member.id)}],
        )
        group_id = data["id"]

        # 成员读：详情 200。
        resp = await client.get(
            f"/api/daemon/group-chats/{group_id}", headers=_headers(member_token)
        )
        assert resp.status_code == 200, resp.text
        # 成员读：列表含本群（非属主成员也可见——按成员表过滤）。
        resp = await client.get("/api/daemon/group-chats", headers=_headers(member_token))
        assert resp.status_code == 200
        assert [g["id"] for g in resp.json()] == [group_id]
        assert resp.json()[0]["online_member_ids"] == []  # task-06 占位

        # 非成员：详情 404（不泄露存在性）；列表不含。
        resp = await client.get(
            f"/api/daemon/group-chats/{group_id}", headers=_headers(outsider_token)
        )
        assert resp.status_code == 404
        assert resp.json()["code"] == "HTTP_404_GROUP_CHAT_NOT_FOUND"
        resp = await client.get("/api/daemon/group-chats", headers=_headers(outsider_token))
        assert resp.json() == []

        # workspace admin 兜底（非成员、非 platform admin）：详情 200。
        resp = await client.get(
            f"/api/daemon/group-chats/{group_id}", headers=_headers(ws_admin_token)
        )
        assert resp.status_code == 200, resp.text

        # platform admin 兜底（has_permission is_platform_admin 短路）。
        _padmin, padmin_token = await _create_user_with_token(
            db_session, name="pm-padmin", admin=True
        )
        resp = await client.get(
            f"/api/daemon/group-chats/{group_id}", headers=_headers(padmin_token)
        )
        assert resp.status_code == 200, resp.text

    async def test_owner_only_operations(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        env = await _make_env(db_session, owner_name="oo-owner")
        member, member_token = await _env_user(db_session, env, name="oo-member")

        data = await _create_group(
            client,
            env.owner_token,
            project_id=env.project.id,
            user_members=[{"user_id": str(member.id)}],
            agent_members=[_agent_config(env.runtime.id)],
        )
        group_id = data["id"]
        agent_member_id = next(m["id"] for m in data["members"] if m["member_type"] == "agent")

        # 非群主成员：改设置 / 加成员 / 删成员 / 解散 → 403（可见但无权）。
        resp = await client.patch(
            f"/api/daemon/group-chats/{group_id}",
            json={"title": "越权改名"},
            headers=_headers(member_token),
        )
        assert resp.status_code == 403, resp.text
        assert resp.json()["code"] == "HTTP_403_GROUP_CHAT_FORBIDDEN"

        resp = await client.post(
            f"/api/daemon/group-chats/{group_id}/members",
            json={"user": {"user_id": str(uuid.uuid4())}},
            headers=_headers(member_token),
        )
        assert resp.status_code == 403

        resp = await client.delete(
            f"/api/daemon/group-chats/{group_id}/members/{agent_member_id}",
            headers=_headers(member_token),
        )
        assert resp.status_code == 403

        resp = await client.post(
            f"/api/daemon/group-chats/{group_id}/end", headers=_headers(member_token)
        )
        assert resp.status_code == 403

        # 非成员的群主专属操作 → 404（先过成员门，不泄露存在性）。
        _outsider, outsider_token = await _env_user(db_session, env, name="oo-out")
        resp = await client.post(
            f"/api/daemon/group-chats/{group_id}/end", headers=_headers(outsider_token)
        )
        assert resp.status_code == 404

        # 群主本人：改设置 200。
        resp = await client.patch(
            f"/api/daemon/group-chats/{group_id}",
            json={"title": "新群名", "context_window": 30, "agent_cross_mention": False},
            headers=_headers(env.owner_token),
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["title"] == "新群名"
        assert body["context_window"] == 30
        assert body["agent_cross_mention"] is False


# ── 成员 CRUD ────────────────────────────────────────────────────────────────


class TestGroupMemberCrud:
    async def test_add_user_member_and_duplicate(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        env = await _make_env(db_session, owner_name="mc-owner")
        data = await _create_group(client, env.owner_token, project_id=env.project.id)
        group_id = data["id"]

        new_user, _ = await _env_user(db_session, env, name="新同学")
        resp = await client.post(
            f"/api/daemon/group-chats/{group_id}/members",
            json={"user": {"user_id": str(new_user.id)}},
            headers=_headers(env.owner_token),
        )
        assert resp.status_code == 201, resp.text
        body = resp.json()
        assert body["member_type"] == "user"
        assert body["display_name"] == "新同学"
        assert body["user_id"] == str(new_user.id)
        assert body["removed_at"] is None

        # 重复邀请 → 400。
        resp = await client.post(
            f"/api/daemon/group-chats/{group_id}/members",
            json={"user": {"user_id": str(new_user.id)}},
            headers=_headers(env.owner_token),
        )
        assert resp.status_code == 400
        assert "已是群成员" in resp.json()["message"]

        # 用户不存在 → 400。
        resp = await client.post(
            f"/api/daemon/group-chats/{group_id}/members",
            json={"user": {"user_id": str(uuid.uuid4())}},
            headers=_headers(env.owner_token),
        )
        assert resp.status_code == 400

    async def test_add_agent_member_and_missing_runtime(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        env = await _make_env(db_session, owner_name="ma-owner")
        data = await _create_group(client, env.owner_token, project_id=env.project.id)
        group_id = data["id"]

        resp = await client.post(
            f"/api/daemon/group-chats/{group_id}/members",
            json={"agent": _agent_config(env.runtime.id, name="新助手")},
            headers=_headers(env.owner_token),
        )
        assert resp.status_code == 201, resp.text
        assert resp.json()["shadow_status"] == "none"
        assert resp.json()["config_snapshot"]["machine_name"] == "group-host"

        # 机器不存在 → 400。
        resp = await client.post(
            f"/api/daemon/group-chats/{group_id}/members",
            json={"agent": _agent_config(uuid.uuid4(), name="幽灵")},
            headers=_headers(env.owner_token),
        )
        assert resp.status_code == 400
        assert "机器不存在" in resp.json()["message"]

    async def test_remove_user_member_and_revive(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        env = await _make_env(db_session, owner_name="rm-owner")
        target, _ = await _env_user(db_session, env, name="rm-target")
        data = await _create_group(
            client,
            env.owner_token,
            project_id=env.project.id,
            user_members=[{"user_id": str(target.id)}],
        )
        group_id = data["id"]
        member_id = next(m["id"] for m in data["members"] if m.get("user_id") == str(target.id))

        resp = await client.delete(
            f"/api/daemon/group-chats/{group_id}/members/{member_id}",
            headers=_headers(env.owner_token),
        )
        assert resp.status_code == 204, resp.text
        row = await _get_member_row(
            db_session, group_id=uuid.UUID(group_id), member_id=uuid.UUID(member_id)
        )
        assert row is not None and row.removed_at is not None

        # 移除后的成员失去访问（404）——target 本人 token。
        token = await _token_for(target)
        resp = await client.get(f"/api/daemon/group-chats/{group_id}", headers=_headers(token))
        assert resp.status_code == 404

        # 再次邀请 → 复活原行（removed_at 清空，不撞部分唯一索引）。
        resp = await client.post(
            f"/api/daemon/group-chats/{group_id}/members",
            json={"user": {"user_id": str(target.id)}},
            headers=_headers(env.owner_token),
        )
        assert resp.status_code == 201, resp.text
        assert resp.json()["id"] == member_id
        assert resp.json()["removed_at"] is None

    async def test_cannot_remove_group_owner(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        env = await _make_env(db_session, owner_name="no-owner")
        data = await _create_group(client, env.owner_token, project_id=env.project.id)
        owner_member_id = next(
            m["id"] for m in data["members"] if m.get("user_id") == str(env.owner.id)
        )
        resp = await client.delete(
            f"/api/daemon/group-chats/{data['id']}/members/{owner_member_id}",
            headers=_headers(env.owner_token),
        )
        assert resp.status_code == 400
        assert "群主" in resp.json()["message"]

    async def test_update_member_rename_and_six_elements(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        env = await _make_env(db_session, owner_name="up-owner")
        _i2, runtime2 = await _seed_runtime(db_session, env.owner.id, hostname="second-host")
        data = await _create_group(
            client,
            env.owner_token,
            project_id=env.project.id,
            agent_members=[_agent_config(env.runtime.id)],
        )
        group_id = data["id"]
        agent_member = next(m for m in data["members"] if m["member_type"] == "agent")

        # 改昵称 + 换机器（六要素热切换 task-04 执行；本卡落库+快照同步）。
        resp = await client.patch(
            f"/api/daemon/group-chats/{group_id}/members/{agent_member['id']}",
            json={"display_name": "小码二号", "runtime_id": str(runtime2.id)},
            headers=_headers(env.owner_token),
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["display_name"] == "小码二号"
        assert body["runtime_id"] == str(runtime2.id)
        assert body["config_snapshot"]["machine_name"] == "second-host"

        row = await _get_member_row(
            db_session,
            group_id=uuid.UUID(group_id),
            member_id=uuid.UUID(agent_member["id"]),
        )
        assert row is not None
        assert row.runtime_id == runtime2.id
        assert row.shadow_status == "none"  # 本卡不动影子状态

        # 昵称撞群主 → 400。
        resp = await client.patch(
            f"/api/daemon/group-chats/{group_id}/members/{agent_member['id']}",
            json={"display_name": "up-owner"},
            headers=_headers(env.owner_token),
        )
        assert resp.status_code == 400
        assert "已被使用" in resp.json()["message"]

        # 用户成员改六要素 → 400。
        owner_member_id = next(
            m["id"] for m in data["members"] if m.get("user_id") == str(env.owner.id)
        )
        resp = await client.patch(
            f"/api/daemon/group-chats/{group_id}/members/{owner_member_id}",
            json={"provider": "codex"},
            headers=_headers(env.owner_token),
        )
        assert resp.status_code == 400
        assert "六要素" in resp.json()["message"]

        # 不存在的成员 → 404。
        resp = await client.patch(
            f"/api/daemon/group-chats/{group_id}/members/{uuid.uuid4()}",
            json={"display_name": "不存在"},
            headers=_headers(env.owner_token),
        )
        assert resp.status_code == 404

    async def test_reuse_removed_member_name_400(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        """P1 回归：昵称唯一约束全量含已移除行——同名新增/改名 400 非 500。

        唯一约束 ``uq_agent_group_members_group_display_name`` 不带
        removed_at 条件：移除「小码」后新建同名 agent 成员（INSERT）或在群
        成员改名撞已移除行昵称（UPDATE）都直撞约束变 500——查重含已移除行
        后两处均 400。
        """
        env = await _make_env(db_session, owner_name="rn-owner")
        data = await _create_group(
            client,
            env.owner_token,
            project_id=env.project.id,
            agent_members=[_agent_config(env.runtime.id, name="小码")],
        )
        group_id = data["id"]
        xiao_id = next(m["id"] for m in data["members"] if m["display_name"] == "小码")

        resp = await client.delete(
            f"/api/daemon/group-chats/{group_id}/members/{xiao_id}",
            headers=_headers(env.owner_token),
        )
        assert resp.status_code == 204, resp.text

        # 移除后同名新增 agent 成员 → 400（撞含已移除行的全量唯一约束）。
        resp = await client.post(
            f"/api/daemon/group-chats/{group_id}/members",
            json={"agent": _agent_config(env.runtime.id, name="小码")},
            headers=_headers(env.owner_token),
        )
        assert resp.status_code == 400, resp.text
        assert "已移除成员昵称冲突" in resp.json()["message"]

        # 在群成员改成已移除行昵称 → 同样 400（UPDATE 也撞约束）。
        other, _ = await _env_user(db_session, env, name="rn-other")
        resp = await client.post(
            f"/api/daemon/group-chats/{group_id}/members",
            json={"user": {"user_id": str(other.id)}},
            headers=_headers(env.owner_token),
        )
        assert resp.status_code == 201, resp.text
        other_member_id = resp.json()["id"]
        resp = await client.patch(
            f"/api/daemon/group-chats/{group_id}/members/{other_member_id}",
            json={"display_name": "小码"},
            headers=_headers(env.owner_token),
        )
        assert resp.status_code == 400, resp.text
        assert "已移除成员昵称冲突" in resp.json()["message"]

        # 对照：与已移除行不撞名的正常新增/改名不受影响。
        resp = await client.post(
            f"/api/daemon/group-chats/{group_id}/members",
            json={"agent": _agent_config(env.runtime.id, name="小码二号")},
            headers=_headers(env.owner_token),
        )
        assert resp.status_code == 201, resp.text


# ── reset-memory ─────────────────────────────────────────────────────────────


class TestResetMemberMemory:
    async def test_reset_memory_idempotent_without_shadow(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        env = await _make_env(db_session, owner_name="rs-owner")
        data = await _create_group(
            client,
            env.owner_token,
            project_id=env.project.id,
            agent_members=[_agent_config(env.runtime.id)],
        )
        group_id = data["id"]
        agent_member = next(m for m in data["members"] if m["member_type"] == "agent")

        # 本卡影子还不存在（task-03 懒建）→ 幂等置位 pending + 指针 NULL。
        for _ in range(2):
            resp = await client.post(
                f"/api/daemon/group-chats/{group_id}/members/{agent_member['id']}/reset-memory",
                headers=_headers(env.owner_token),
            )
            assert resp.status_code == 200, resp.text
            assert resp.json()["shadow_status"] == "pending"
            assert resp.json()["shadow_session_id"] is None

        # 用户成员不支持 → 400。
        owner_member_id = next(
            m["id"] for m in data["members"] if m.get("user_id") == str(env.owner.id)
        )
        resp = await client.post(
            f"/api/daemon/group-chats/{group_id}/members/{owner_member_id}/reset-memory",
            headers=_headers(env.owner_token),
        )
        assert resp.status_code == 400

    async def test_reset_memory_ends_existing_shadow(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        env = await _make_env(db_session, owner_name="rs2-owner")
        data = await _create_group(
            client,
            env.owner_token,
            project_id=env.project.id,
            agent_members=[_agent_config(env.runtime.id)],
        )
        group_id = data["id"]
        agent_member = next(m for m in data["members"] if m["member_type"] == "agent")
        member_row = await _get_member_row(
            db_session,
            group_id=uuid.UUID(group_id),
            member_id=uuid.UUID(agent_member["id"]),
        )
        assert member_row is not None
        shadow, _lease = await _seed_shadow_session(
            db_session,
            member=member_row,
            owner_user_id=env.owner.id,
            runtime_id=env.runtime.id,
        )

        resp = await client.post(
            f"/api/daemon/group-chats/{group_id}/members/{agent_member['id']}/reset-memory",
            headers=_headers(env.owner_token),
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["shadow_status"] == "pending"
        assert resp.json()["shadow_session_id"] is None
        # 影子会话被 end 链收口 + pending 队列行已删。
        await db_session.reset()
        shadow_row = await db_session.get(AgentSession, shadow.id)
        assert shadow_row is not None and shadow_row.status == "ended"
        assert await _list_queued(db_session, shadow.id) == []


# ── kind 过滤不泄漏 ──────────────────────────────────────────────────────────


class TestSessionKindFilter:
    async def test_group_sessions_hidden_from_normal_list(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        env = await _make_env(db_session, owner_name="kf-owner")

        # 存量 chat 会话 + 群会话（API 建）+ 影子会话（直落替身）。
        chat = AgentSession(
            id=uuid.uuid4(),
            user_id=env.owner.id,
            provider="claude",
            status="ended",
        )
        db_session.add(chat)
        await db_session.commit()
        data = await _create_group(
            client,
            env.owner_token,
            project_id=env.project.id,
            agent_members=[_agent_config(env.runtime.id)],
        )
        group_session_id = data["session_id"]
        shadow = AgentSession(
            id=uuid.uuid4(),
            user_id=env.owner.id,
            provider="claude",
            status="active",
            session_kind="group_member",
        )
        db_session.add(shadow)
        await db_session.commit()

        # 默认（session_kind='chat' 存量口径）：只见 chat，群/影子不泄漏。
        resp = await client.get("/api/daemon/sessions", headers=_headers(env.owner_token))
        assert resp.status_code == 200
        ids = [s["id"] for s in resp.json()["items"]]
        assert str(chat.id) in ids
        assert group_session_id not in ids
        assert str(shadow.id) not in ids

        # 显式覆盖：group / group_member 可查（admin debug 口径）。
        resp = await client.get(
            "/api/daemon/sessions?session_kind=group", headers=_headers(env.owner_token)
        )
        assert [s["id"] for s in resp.json()["items"]] == [group_session_id]
        resp = await client.get(
            "/api/daemon/sessions?session_kind=group_member",
            headers=_headers(env.owner_token),
        )
        assert [s["id"] for s in resp.json()["items"]] == [str(shadow.id)]

        # 非法值 → 422（Literal 校验）。
        resp = await client.get(
            "/api/daemon/sessions?session_kind=bogus", headers=_headers(env.owner_token)
        )
        assert resp.status_code == 422


# ── 解散链 ───────────────────────────────────────────────────────────────────


class TestEndGroupChain:
    async def test_end_group_full_chain(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        env = await _make_env(db_session, owner_name="eg-owner")
        member, member_token = await _env_user(db_session, env, name="eg-member")

        data = await _create_group(
            client,
            env.owner_token,
            project_id=env.project.id,
            user_members=[{"user_id": str(member.id)}],
            agent_members=[
                _agent_config(env.runtime.id, name="小码"),
                _agent_config(env.runtime.id, name="小助"),
            ],
        )
        group_id = uuid.UUID(data["id"])
        agent_members = [m for m in data["members"] if m["member_type"] == "agent"]

        # 给「小码」挂影子会话 + pending 队列（「小助」保持无影子——跳过路径）。
        xiao_row = await _get_member_row(
            db_session, group_id=group_id, member_id=uuid.UUID(agent_members[0]["id"])
        )
        assert xiao_row is not None
        shadow, _lease = await _seed_shadow_session(
            db_session,
            member=xiao_row,
            owner_user_id=env.owner.id,
            runtime_id=env.runtime.id,
        )

        resp = await client.post(
            f"/api/daemon/group-chats/{data['id']}/end", headers=_headers(env.owner_token)
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["ended_at"] is not None

        await db_session.reset()
        # 群会话 ended；群行 ended_at 置位。
        group_session = await db_session.get(AgentSession, group_id)
        assert group_session is not None and group_session.status == "ended"
        group_row = await db_session.get(AgentGroupChat, group_id)
        assert group_row is not None and group_row.ended_at is not None
        # 有影子的成员：影子 ended + shadow_status='ended' + 队列 pending 行删除。
        shadow_row = await db_session.get(AgentSession, shadow.id)
        assert shadow_row is not None and shadow_row.status == "ended"
        xiao_after = await _get_member_row(db_session, group_id=group_id, member_id=xiao_row.id)
        assert xiao_after is not None and xiao_after.shadow_status == "ended"
        assert await _list_queued(db_session, shadow.id) == []
        # 无影子成员：shadow_status 保持 none（跳过）。
        zhu_after = await _get_member_row(
            db_session, group_id=group_id, member_id=uuid.UUID(agent_members[1]["id"])
        )
        assert zhu_after is not None and zhu_after.shadow_status == "none"

        # 解散后：成员读详情仍 200（历史可见）、群主专属操作 400。
        resp = await client.get(
            f"/api/daemon/group-chats/{data['id']}", headers=_headers(member_token)
        )
        assert resp.status_code == 200
        resp = await client.patch(
            f"/api/daemon/group-chats/{data['id']}",
            json={"title": "改名"},
            headers=_headers(env.owner_token),
        )
        assert resp.status_code == 400

        # 幂等：再次解散 200 且状态不变。
        resp = await client.post(
            f"/api/daemon/group-chats/{data['id']}/end", headers=_headers(env.owner_token)
        )
        assert resp.status_code == 200
        await db_session.reset()
        group_session2 = await db_session.get(AgentSession, group_id)
        assert group_session2 is not None and group_session2.status == "ended"

    async def test_end_group_publishes_session_ended(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        mocked_group_redis,
    ) -> None:
        """P1 回归：解散群向群频道广播 session_ended（群 SSE 只认该事件收流）。

        不发则已连的 ``/sessions/{id}/stream`` 永远 keepalive（前端解散收口
        死路径 + presence 死群恒在线）；幂等重解散不重发。
        """
        env = await _make_env(db_session, owner_name="pe-owner")
        data = await _create_group(client, env.owner_token, project_id=env.project.id)
        session_id = uuid.UUID(data["session_id"])

        resp = await client.post(
            f"/api/daemon/group-chats/{data['id']}/end", headers=_headers(env.owner_token)
        )
        assert resp.status_code == 200, resp.text

        ended = [
            e
            for e in _channel_publishes(mocked_group_redis, session_id)
            if e.get("event") == "session_ended"
        ]
        assert len(ended) == 1
        assert ended[0]["session_id"] == str(session_id)
        assert ended[0]["status"] == "ended"

        # 幂等重解散 → 不重发（首末已发，SSE 已收口）。
        resp = await client.post(
            f"/api/daemon/group-chats/{data['id']}/end", headers=_headers(env.owner_token)
        )
        assert resp.status_code == 200
        ended_again = [
            e
            for e in _channel_publishes(mocked_group_redis, session_id)
            if e.get("event") == "session_ended"
        ]
        assert len(ended_again) == 1

    async def test_remove_agent_member_ends_shadow(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        env = await _make_env(db_session, owner_name="re-owner")
        data = await _create_group(
            client,
            env.owner_token,
            project_id=env.project.id,
            agent_members=[_agent_config(env.runtime.id)],
        )
        group_id = uuid.UUID(data["id"])
        agent_member = next(m for m in data["members"] if m["member_type"] == "agent")
        member_row = await _get_member_row(
            db_session, group_id=group_id, member_id=uuid.UUID(agent_member["id"])
        )
        assert member_row is not None
        shadow, _lease = await _seed_shadow_session(
            db_session,
            member=member_row,
            owner_user_id=env.owner.id,
            runtime_id=env.runtime.id,
        )

        resp = await client.delete(
            f"/api/daemon/group-chats/{data['id']}/members/{agent_member['id']}",
            headers=_headers(env.owner_token),
        )
        assert resp.status_code == 204, resp.text
        await db_session.reset()
        shadow_row = await db_session.get(AgentSession, shadow.id)
        assert shadow_row is not None and shadow_row.status == "ended"
        row = await _get_member_row(
            db_session, group_id=group_id, member_id=uuid.UUID(agent_member["id"])
        )
        assert row is not None
        assert row.removed_at is not None
        assert row.shadow_status == "none"  # design §8 group.member.removed
        assert await _list_queued(db_session, shadow.id) == []


# ── 权限分支继承（daemon 会话端点 + file_artifacts）──────────────────────────


class TestPermissionBranchInheritance:
    async def test_session_detail_logs_and_sse_for_group(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        env = await _make_env(db_session, owner_name="pb-owner")
        member, member_token = await _env_user(db_session, env, name="pb-member")
        _outsider, outsider_token = await _env_user(db_session, env, name="pb-out")

        data = await _create_group(
            client,
            env.owner_token,
            project_id=env.project.id,
            user_members=[{"user_id": str(member.id)}],
        )
        sid = data["session_id"]

        # 成员（非属主）读会话详情 → 200（get_agent_session 群分支）。
        resp = await client.get(f"/api/daemon/sessions/{sid}", headers=_headers(member_token))
        assert resp.status_code == 200, resp.text
        assert resp.json()["id"] == sid

        # 非成员 → 404。
        resp = await client.get(f"/api/daemon/sessions/{sid}", headers=_headers(outsider_token))
        assert resp.status_code == 404

        # 成员读日志 → 200（get_agent_session_logs 群分支；空时间线）。
        resp = await client.get(f"/api/daemon/sessions/{sid}/logs", headers=_headers(member_token))
        assert resp.status_code == 200, resp.text
        assert resp.json() == []

        # 非成员读日志 → 404。
        resp = await client.get(
            f"/api/daemon/sessions/{sid}/logs", headers=_headers(outsider_token)
        )
        assert resp.status_code == 404

        # SSE：成员 200（stream_session_logs 内联群分支）；非成员 404。
        # 群会话置终态 + mock Redis → 生成器 race-guard 快速收流（SSE 测试先例）。
        group_session = await db_session.get(AgentSession, uuid.UUID(sid))
        assert group_session is not None
        group_session.status = "ended"
        group_session.ended_at = datetime.now(UTC)
        db_session.add(group_session)
        await db_session.commit()

        mock_redis = MagicMock()
        mock_redis.pubsub.return_value = MagicMock(
            subscribe=AsyncMock(),
            unsubscribe=AsyncMock(),
            aclose=AsyncMock(),
            get_message=AsyncMock(return_value=None),
        )
        with mock_patch("app.modules.agent.service.get_redis", return_value=mock_redis):
            resp = await client.get(
                f"/api/daemon/sessions/{sid}/stream", headers=_headers(member_token)
            )
        assert resp.status_code == 200, resp.text
        assert resp.headers["content-type"].startswith("text/event-stream")

        resp = await client.get(
            f"/api/daemon/sessions/{sid}/stream", headers=_headers(outsider_token)
        )
        assert resp.status_code == 404

    async def test_shadow_session_access_owner_or_admin_only(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        env = await _make_env(db_session, owner_name="sh-owner")
        member, member_token = await _env_user(db_session, env, name="sh-member")

        data = await _create_group(
            client,
            env.owner_token,
            project_id=env.project.id,
            user_members=[{"user_id": str(member.id)}],
            agent_members=[_agent_config(env.runtime.id)],
        )
        agent_member = next(m for m in data["members"] if m["member_type"] == "agent")
        member_row = await _get_member_row(
            db_session,
            group_id=uuid.UUID(data["id"]),
            member_id=uuid.UUID(agent_member["id"]),
        )
        assert member_row is not None
        shadow, _lease = await _seed_shadow_session(
            db_session,
            member=member_row,
            owner_user_id=env.owner.id,
            runtime_id=env.runtime.id,
        )

        # 群主（影子属主）可读；群成员（非属主）不可读（影子不对外暴露）。
        resp = await client.get(
            f"/api/daemon/sessions/{shadow.id}", headers=_headers(env.owner_token)
        )
        assert resp.status_code == 200, resp.text
        resp = await client.get(f"/api/daemon/sessions/{shadow.id}", headers=_headers(member_token))
        assert resp.status_code == 404

    async def test_file_artifacts_group_branch(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        import pytest
        from fastapi import HTTPException

        from app.modules.agent.file_artifacts import _check_session_permission
        from app.modules.auth.permissions import Permission as Perm

        env = await _make_env(db_session, owner_name="fa-owner")
        member, _ = await _env_user(db_session, env, name="fa-member")
        outsider, _ = await _env_user(db_session, env, name="fa-out")
        data = await _create_group(
            client,
            env.owner_token,
            project_id=env.project.id,
            user_members=[{"user_id": str(member.id)}],
        )
        group_session = await db_session.get(AgentSession, uuid.UUID(data["session_id"]))
        assert group_session is not None

        # 群成员（含群主）放行。
        await _check_session_permission(
            db_session,
            member,
            permission=Perm.WORKSPACE_READ,
            agent_session=group_session,
        )
        await _check_session_permission(
            db_session,
            env.owner,
            permission=Perm.WORKSPACE_READ,
            agent_session=group_session,
        )
        # 非成员 → 回退 workspace 锚复核 → 403（锚=群工作区，outsider 无 admin）。
        with pytest.raises(HTTPException) as exc_info:
            await _check_session_permission(
                db_session,
                outsider,
                permission=Perm.WORKSPACE_READ,
                agent_session=group_session,
            )
        assert exc_info.value.status_code == 403
