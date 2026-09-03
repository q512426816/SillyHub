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

task-04（2026-09-03-group-chat-archive-delete）归档/删除全链（design §4/§5）：

- 归档/取消归档：置位 → 默认列表消失 → ``?archived=true`` 视图出现 → 取消
  归档恢复；重复调用幂等（第二次 204 且 ``archived_at`` 不变——哨兵锚定防
  同微秒假绿）；已解散群可归档（``ended_at`` ⊥ ``archived_at`` ⊥ ``deleted_at``）；
- 权限：普通成员 archive/unarchive/DELETE 三端点 → 403（中文文案）；非成员
  → 404（不泄露存在性）+ DB 零副作用；workspace admin 正向对照；
- 删除：活跃群（含 agent 影子）——影子会话 status=ended（影子不软删——双置位
  仅群行+时间线，design §5.2）、群时间线 ended+``deleted_at``、群行 ``deleted_at``
  双非空、影子队列 pending 清理、群列表三态全滤、``GET /group-chats/{id}``
  404、影子日志解析分支 404（旁路封堵回归——删除前 200 对照）、群主
  ``GET /sessions/{时间线id}`` 404（属主旁路封堵）；已解散群删除跳过收口
  （``ended_at`` 哨兵保留证明不重跑 end 链）直接双置位；重复删除 404（design
  §7 天然幂等边界）；
- 三态过滤：无参（HTTP 默认 False）不含已归档群（防泄漏锚点）、``true``/
  ``false`` 显式口径、HTTP 显式 null 不可达（FastAPI bool 解析 422——传输层
  边界锁定，None 态照会话侧 ``test_session_review_fixes.TestListArchiveTriState``
  先例落 service 层）；
- SSE 信号：archive/unarchive → sessions 频道 ``status_changed``（audience=
  全部用户成员；幂等重归档不重发）、delete → ``deleted``（末位，前置
  ``status_changed`` 来自 end 收口链）+ 群频道 ``session_ended``。

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


@pytest.fixture()
def mocked_sessions_events_redis():
    """agent_sessions:changed publish 替身（session_events 模块侧 get_redis）——
    test_group_realtime.mocked_sessions_events_redis 先例。

    群列表变更信号（归档/取消归档/删除，design §5.4）经
    ``publish_sessions_changed`` 用本模块自己的 ``get_redis``，与群频道替身
    （group service 侧）分属两处，各自独立打桩。
    """
    redis = AsyncMock()
    redis.publish = AsyncMock()
    with mock_patch("app.modules.daemon.session_events.get_redis", return_value=redis):
        yield redis


def _sessions_changed_publishes(redis: AsyncMock) -> list[dict]:
    """从 fake redis publish 记录中筛出 ``agent_sessions:changed`` 频道 payload。"""
    from app.modules.daemon.session_events import SESSIONS_CHANGED_CHANNEL

    return [
        json.loads(call.args[1])
        for call in redis.publish.call_args_list
        if call.args[0] == SESSIONS_CHANGED_CHANNEL
    ]


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

    async def test_end_group_shadow_unexpected_error_no_half_dead(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """ql-20260903-020：影子 end 意外异常（非 AppError）不再 500 留半死群。

        群终态照常落库；end 失败的成员不伪造 shadow_status='ended'（影子实际
        未终止，留 sweep 收敛）；其余成员影子照常终止。
        """
        import app.modules.daemon.group.service as group_service_module

        orig_end = group_service_module.SessionService.end_session
        calls = {"n": 0}

        async def flaky_end(self: object, *args: object, **kwargs: object):
            calls["n"] += 1
            if calls["n"] == 1:
                raise RuntimeError("db glitch")
            return await orig_end(self, *args, **kwargs)  # type: ignore[arg-type]

        monkeypatch.setattr(group_service_module.SessionService, "end_session", flaky_end)

        env = await _make_env(db_session, owner_name="eg2-owner")
        data = await _create_group(
            client,
            env.owner_token,
            project_id=env.project.id,
            agent_members=[
                _agent_config(env.runtime.id, name="小码"),
                _agent_config(env.runtime.id, name="小助"),
            ],
        )
        group_id = uuid.UUID(data["id"])
        agent_members = [m for m in data["members"] if m["member_type"] == "agent"]
        shadow_ids: dict[str, uuid.UUID] = {}
        for m in agent_members:
            row = await _get_member_row(db_session, group_id=group_id, member_id=uuid.UUID(m["id"]))
            assert row is not None
            shadow, _lease = await _seed_shadow_session(
                db_session,
                member=row,
                owner_user_id=env.owner.id,
                runtime_id=env.runtime.id,
            )
            shadow_ids[m["id"]] = shadow.id
        await db_session.reset()

        resp = await client.post(
            f"/api/daemon/group-chats/{data['id']}/end", headers=_headers(env.owner_token)
        )
        assert resp.status_code == 200, resp.text
        assert calls["n"] == 2  # 第一个成员失败后第二个照常 end

        await db_session.reset()
        # 群终态照常落库（不再半死）。
        group_session = await db_session.get(AgentSession, group_id)
        assert group_session is not None and group_session.status == "ended"
        group_row = await db_session.get(AgentGroupChat, group_id)
        assert group_row is not None and group_row.ended_at is not None
        # 恰好一个成员 end 失败：影子未终止 + shadow_status 保持 active；
        # 另一个成员影子 ended + shadow_status='ended'。
        statuses = []
        for m in agent_members:
            row = await _get_member_row(db_session, group_id=group_id, member_id=uuid.UUID(m["id"]))
            assert row is not None
            statuses.append(row.shadow_status)
            shadow_row = await db_session.get(AgentSession, shadow_ids[m["id"]])
            assert shadow_row is not None
            if row.shadow_status == "ended":
                assert shadow_row.status == "ended"
            else:
                assert row.shadow_status == "active"
                assert shadow_row.status == "active"
        assert sorted(statuses) == ["active", "ended"]

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

        # 群主（影子属主）可读；群成员（非属主）详情读也已放行
        # （2026-09-02 影子会话挂 SessionPanel 本体后需要详情——读路径与 logs
        # 同口径放行，写路径仍仅属主/admin）；非群成员仍 404。
        resp = await client.get(
            f"/api/daemon/sessions/{shadow.id}", headers=_headers(env.owner_token)
        )
        assert resp.status_code == 200, resp.text
        resp = await client.get(f"/api/daemon/sessions/{shadow.id}", headers=_headers(member_token))
        assert resp.status_code == 200, resp.text

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


# ── 归档/取消归档（2026-09-03-group-chat-archive-delete task-04）──────────────


class TestGroupArchiveUnarchive:
    async def test_archive_unarchive_lifecycle(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        """归档→默认列表消失→归档视图出现→取消归档恢复（design §5.1 全链）。"""
        env = await _make_env(db_session, owner_name="arc-owner")
        member, member_token = await _env_user(db_session, env, name="arc-member")
        data = await _create_group(
            client,
            env.owner_token,
            project_id=env.project.id,
            user_members=[{"user_id": str(member.id)}],
        )
        group_id = uuid.UUID(data["id"])

        # 初始：默认视图可见（群主/成员两视角）且 archived_at NULL。
        for token in (env.owner_token, member_token):
            resp = await client.get("/api/daemon/group-chats", headers=_headers(token))
            assert resp.status_code == 200
            assert [g["id"] for g in resp.json()] == [data["id"]]
            assert resp.json()[0]["archived_at"] is None

        # 归档 → 204。
        resp = await client.post(
            f"/api/daemon/group-chats/{data['id']}/archive", headers=_headers(env.owner_token)
        )
        assert resp.status_code == 204, resp.text

        # DB：archived_at 置位；ended_at/deleted_at 保持 NULL（design §2 正交性）。
        await db_session.reset()
        row = await db_session.get(AgentGroupChat, group_id)
        assert row is not None
        assert row.archived_at is not None
        assert row.ended_at is None and row.deleted_at is None

        # 默认列表（无参=HTTP 默认 False）：群主/成员视角都消失（防泄漏锚点）。
        for token in (env.owner_token, member_token):
            resp = await client.get("/api/daemon/group-chats", headers=_headers(token))
            assert resp.json() == []

        # ?archived=true：归档视图出现且读体携带 archived_at。
        resp = await client.get(
            "/api/daemon/group-chats?archived=true", headers=_headers(member_token)
        )
        assert resp.status_code == 200
        assert [g["id"] for g in resp.json()] == [data["id"]]
        assert resp.json()[0]["archived_at"] is not None

        # 归档≠解散：详情仍可读（历史可见，design §5.1「归档是收纳不是解散」）。
        resp = await client.get(
            f"/api/daemon/group-chats/{data['id']}", headers=_headers(member_token)
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["archived_at"] is not None

        # 取消归档 → 204 → 行回默认视图。
        resp = await client.post(
            f"/api/daemon/group-chats/{data['id']}/unarchive", headers=_headers(env.owner_token)
        )
        assert resp.status_code == 204, resp.text
        await db_session.reset()
        row = await db_session.get(AgentGroupChat, group_id)
        assert row is not None and row.archived_at is None
        resp = await client.get("/api/daemon/group-chats", headers=_headers(env.owner_token))
        assert [g["id"] for g in resp.json()] == [data["id"]]
        resp = await client.get(
            "/api/daemon/group-chats?archived=true", headers=_headers(env.owner_token)
        )
        assert resp.json() == []

    async def test_archive_unarchive_idempotent(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        """重复归档/取消归档幂等：第二次 204 且 archived_at 不变（哨兵锚定）。

        手工把 ``archived_at`` 钉到哨兵值再重归档——若幂等早退失效重写列，
        哨兵必被 now() 覆盖（防「两次请求落在同一微秒」的假绿）。
        """
        env = await _make_env(db_session, owner_name="idm-owner")
        data = await _create_group(client, env.owner_token, project_id=env.project.id)
        group_id = uuid.UUID(data["id"])

        resp = await client.post(
            f"/api/daemon/group-chats/{data['id']}/archive", headers=_headers(env.owner_token)
        )
        assert resp.status_code == 204, resp.text

        # 哨兵锚定（SQLite 方言往返丢 tz——两侧都归一 naive 再比较）。
        await db_session.reset()
        row = await db_session.get(AgentGroupChat, group_id)
        assert row is not None and row.archived_at is not None
        sentinel = datetime(2020, 1, 1, tzinfo=UTC)
        row.archived_at = sentinel
        db_session.add(row)
        await db_session.commit()

        # 第二次归档 → 204 幂等且 archived_at 不变（哨兵保留）。
        resp = await client.post(
            f"/api/daemon/group-chats/{data['id']}/archive", headers=_headers(env.owner_token)
        )
        assert resp.status_code == 204, resp.text
        await db_session.reset()
        row = await db_session.get(AgentGroupChat, group_id)
        assert row is not None and row.archived_at is not None
        assert row.archived_at.replace(tzinfo=None) == sentinel.replace(tzinfo=None)

        # 取消归档后再次取消 → 204 幂等且 archived_at 保持 NULL。
        resp = await client.post(
            f"/api/daemon/group-chats/{data['id']}/unarchive", headers=_headers(env.owner_token)
        )
        assert resp.status_code == 204, resp.text
        resp = await client.post(
            f"/api/daemon/group-chats/{data['id']}/unarchive", headers=_headers(env.owner_token)
        )
        assert resp.status_code == 204, resp.text
        await db_session.reset()
        row = await db_session.get(AgentGroupChat, group_id)
        assert row is not None and row.archived_at is None

    async def test_ended_group_can_be_archived(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        """已解散群可归档（收纳解散群主场景，design §5.1）+ 三态正交。"""
        env = await _make_env(db_session, owner_name="ega-owner")
        data = await _create_group(
            client,
            env.owner_token,
            project_id=env.project.id,
            agent_members=[_agent_config(env.runtime.id)],
        )
        group_id = uuid.UUID(data["id"])

        resp = await client.post(
            f"/api/daemon/group-chats/{data['id']}/end", headers=_headers(env.owner_token)
        )
        assert resp.status_code == 200, resp.text

        resp = await client.post(
            f"/api/daemon/group-chats/{data['id']}/archive", headers=_headers(env.owner_token)
        )
        assert resp.status_code == 204, resp.text

        await db_session.reset()
        row = await db_session.get(AgentGroupChat, group_id)
        assert row is not None
        assert row.ended_at is not None and row.archived_at is not None
        assert row.deleted_at is None  # 归档不解散不软删（design §2）

        # 已解散+已归档：默认列表消失 / 归档视图出现。
        resp = await client.get("/api/daemon/group-chats", headers=_headers(env.owner_token))
        assert resp.json() == []
        resp = await client.get(
            "/api/daemon/group-chats?archived=true", headers=_headers(env.owner_token)
        )
        assert [g["id"] for g in resp.json()] == [data["id"]]


# ── 归档/删除权限（task-04）───────────────────────────────────────────────────


class TestGroupArchiveDeletePermissions:
    async def test_member_forbidden_outsider_hidden_ws_admin_allowed(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        """普通成员三端点 403（中文文案）；非成员 404；DB 零副作用；ws admin 放行。"""
        env = await _make_env(db_session, owner_name="apm-owner")
        member, member_token = await _env_user(db_session, env, name="apm-member")
        _outsider, outsider_token = await _env_user(db_session, env, name="apm-out")
        ws_admin, ws_admin_token = await _create_user_with_token(db_session, name="apm-wsadmin")
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
        group_id = uuid.UUID(data["id"])
        endpoints = [
            ("POST", f"/api/daemon/group-chats/{data['id']}/archive"),
            ("POST", f"/api/daemon/group-chats/{data['id']}/unarchive"),
            ("DELETE", f"/api/daemon/group-chats/{data['id']}"),
        ]

        # 普通成员（可见群但非群主）：三端点 403 + 中文文案。
        for method, path in endpoints:
            resp = await client.request(method, path, headers=_headers(member_token))
            assert resp.status_code == 403, f"{method} {path}: {resp.text}"
            assert resp.json()["code"] == "HTTP_403_GROUP_CHAT_FORBIDDEN"
            assert "只有群主或工作区管理员" in resp.json()["message"]

        # 非成员：三端点 404（先过成员门，不泄露存在性）。
        for method, path in endpoints:
            resp = await client.request(method, path, headers=_headers(outsider_token))
            assert resp.status_code == 404, f"{method} {path}: {resp.text}"
            assert resp.json()["code"] == "HTTP_404_GROUP_CHAT_NOT_FOUND"

        # DB：越权尝试零副作用（archived_at/deleted_at 双 NULL）。
        await db_session.reset()
        row = await db_session.get(AgentGroupChat, group_id)
        assert row is not None
        assert row.archived_at is None and row.deleted_at is None

        # workspace admin（非群主非成员）正向对照：归档放行（§5.1 权限表）。
        resp = await client.post(
            f"/api/daemon/group-chats/{data['id']}/archive", headers=_headers(ws_admin_token)
        )
        assert resp.status_code == 204, resp.text
        await db_session.reset()
        row = await db_session.get(AgentGroupChat, group_id)
        assert row is not None and row.archived_at is not None


# ── 删除全链（task-04，design §5.2）───────────────────────────────────────────


class TestDeleteGroupChain:
    async def test_delete_active_group_full_chain(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        """活跃群（含 agent 影子）删除：收口（影子 ended）→ 群行+时间线双置位 →
        一切读路径 404（列表三态全滤 / 详情 / 影子日志解析分支 / 属主时间线）。"""
        env = await _make_env(db_session, owner_name="dga-owner")
        member, member_token = await _env_user(db_session, env, name="dga-member")
        data = await _create_group(
            client,
            env.owner_token,
            project_id=env.project.id,
            user_members=[{"user_id": str(member.id)}],
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

        # 删除前对照：成员可经影子会话读日志（旁路封堵回归的正向基线）。
        resp = await client.get(
            f"/api/daemon/sessions/{shadow.id}/logs", headers=_headers(member_token)
        )
        assert resp.status_code == 200, resp.text

        resp = await client.delete(
            f"/api/daemon/group-chats/{data['id']}", headers=_headers(env.owner_token)
        )
        assert resp.status_code == 204, resp.text

        await db_session.reset()
        # 影子会话：end 收口（status=ended）；软删不落影子——design §5.2 双置位
        # 仅群行+群时间线，影子行保留审计。
        shadow_row = await db_session.get(AgentSession, shadow.id)
        assert shadow_row is not None and shadow_row.status == "ended"
        assert shadow_row.deleted_at is None
        # 群时间线会话：ended + deleted_at 置位（严格镜像会话侧软删）。
        timeline = await db_session.get(AgentSession, group_id)
        assert timeline is not None
        assert timeline.status == "ended" and timeline.ended_at is not None
        assert timeline.deleted_at is not None
        # 群行：deleted_at 置位（archived_at 正交保持 NULL）。
        group_row = await db_session.get(AgentGroupChat, group_id)
        assert group_row is not None and group_row.deleted_at is not None
        assert group_row.archived_at is None
        # agent 成员影子态收口 + 影子队列 pending 清理（end 链复用）。
        row_after = await _get_member_row(db_session, group_id=group_id, member_id=member_row.id)
        assert row_after is not None and row_after.shadow_status == "ended"
        assert await _list_queued(db_session, shadow.id) == []

        # 群列表三态全滤（deleted ⊥ archived，归档视图也不复活）。
        for qs in ("", "?archived=true", "?archived=false"):
            resp = await client.get(f"/api/daemon/group-chats{qs}", headers=_headers(member_token))
            assert resp.status_code == 200
            assert resp.json() == []

        # GET /group-chats/{id} → 404（软删视为不存在，不泄露存在性）。
        resp = await client.get(
            f"/api/daemon/group-chats/{data['id']}", headers=_headers(env.owner_token)
        )
        assert resp.status_code == 404
        assert resp.json()["code"] == "HTTP_404_GROUP_CHAT_NOT_FOUND"

        # 影子日志解析分支 404（旁路封堵回归：get_group_accessible_session 影子
        # 分支按 deleted_at IS NULL 过滤群行——对照删除前的 200）。
        resp = await client.get(
            f"/api/daemon/sessions/{shadow.id}/logs", headers=_headers(member_token)
        )
        assert resp.status_code == 404

        # 属主旁路封堵：群主 GET 群时间线会话详情 404（owner 路径 deleted_at
        # IS NULL 过滤——裸属主读不出已删群时间线）。
        resp = await client.get(
            f"/api/daemon/sessions/{data['session_id']}", headers=_headers(env.owner_token)
        )
        assert resp.status_code == 404

        # 幂等边界（design §7）：已删群重复删除 → 404（取群处即拒，非 204）。
        resp = await client.delete(
            f"/api/daemon/group-chats/{data['id']}", headers=_headers(env.owner_token)
        )
        assert resp.status_code == 404

    async def test_delete_ended_group_skips_closure(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        """已解散群删除跳过收口直接双置位（end_group 幂等早退——ended_at 哨兵保留
        证明未重跑 end 链）。"""
        env = await _make_env(db_session, owner_name="dge-owner")
        data = await _create_group(
            client,
            env.owner_token,
            project_id=env.project.id,
            agent_members=[_agent_config(env.runtime.id)],
        )
        group_id = uuid.UUID(data["id"])

        resp = await client.post(
            f"/api/daemon/group-chats/{data['id']}/end", headers=_headers(env.owner_token)
        )
        assert resp.status_code == 200, resp.text

        # 哨兵锚定 ended_at：若 delete 重跑收口链会覆盖 now()，哨兵必丢。
        await db_session.reset()
        row = await db_session.get(AgentGroupChat, group_id)
        assert row is not None and row.ended_at is not None
        sentinel = datetime(2020, 1, 1, tzinfo=UTC)
        row.ended_at = sentinel
        db_session.add(row)
        await db_session.commit()

        resp = await client.delete(
            f"/api/daemon/group-chats/{data['id']}", headers=_headers(env.owner_token)
        )
        assert resp.status_code == 204, resp.text

        await db_session.reset()
        row = await db_session.get(AgentGroupChat, group_id)
        assert row is not None
        assert row.deleted_at is not None
        assert row.ended_at is not None
        assert row.ended_at.replace(tzinfo=None) == sentinel.replace(tzinfo=None)
        # 时间线：ended 态保持 + 双置位落齐。
        timeline = await db_session.get(AgentSession, group_id)
        assert timeline is not None
        assert timeline.status == "ended" and timeline.deleted_at is not None


# ── 列表 archived 三态过滤（task-04，design §5.3）─────────────────────────────


class TestGroupListArchivedTriState:
    async def test_list_archived_tri_state(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        """三态：无参（HTTP 默认 False，防泄漏锚点）/ true / false；HTTP 显式
        null 不可达（FastAPI bool 解析 422）；None=全量照会话侧先例落
        service 层（test_session_review_fixes.TestListArchiveTriState）。"""
        env = await _make_env(db_session, owner_name="trs-owner")
        active = await _create_group(
            client, env.owner_token, project_id=env.project.id, title="在档群"
        )
        archived = await _create_group(
            client, env.owner_token, project_id=env.project.id, title="归档群"
        )
        resp = await client.post(
            f"/api/daemon/group-chats/{archived['id']}/archive", headers=_headers(env.owner_token)
        )
        assert resp.status_code == 204, resp.text

        # 无参（HTTP 默认 False——防泄漏锚点：无参消费点不见已归档群）。
        resp = await client.get("/api/daemon/group-chats", headers=_headers(env.owner_token))
        assert resp.status_code == 200
        assert {g["id"] for g in resp.json()} == {active["id"]}
        assert resp.json()[0]["archived_at"] is None

        # ?archived=true：仅已归档。
        resp = await client.get(
            "/api/daemon/group-chats?archived=true", headers=_headers(env.owner_token)
        )
        assert {g["id"] for g in resp.json()} == {archived["id"]}
        assert resp.json()[0]["archived_at"] is not None

        # ?archived=false：显式 False 与 HTTP 默认同口径。
        resp = await client.get(
            "/api/daemon/group-chats?archived=false", headers=_headers(env.owner_token)
        )
        assert {g["id"] for g in resp.json()} == {active["id"]}

        # HTTP 显式 null 不可达：FastAPI 对 bool query 的字符串解析拒绝
        # "null"/空串 → 422。锁定传输层边界——design §6.2b presence 消费点
        # 「显式传 archived: null」当前无法经 HTTP 表达（实现缺口，任务报告
        # 登记；router 若改造支持 null，本断言与下方 service 层用例同步更新）。
        resp = await client.get(
            "/api/daemon/group-chats?archived=null", headers=_headers(env.owner_token)
        )
        assert resp.status_code == 422

        # None 态（service 层，照会话侧三态先例）：全量含已归档+未归档。
        from app.modules.daemon.group.service import GroupChatService

        reads = await GroupChatService(db_session).list_groups(env.owner, archived=None)
        assert {str(g.id) for g in reads} == {active["id"], archived["id"]}
        reads_false = await GroupChatService(db_session).list_groups(env.owner, archived=False)
        assert {str(g.id) for g in reads_false} == {active["id"]}


# ── 归档/删除 SSE 信号（task-04，design §5.4）────────────────────────────────


class TestArchiveDeleteSseSignals:
    async def test_archive_unarchive_publish_status_changed(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        mocked_sessions_events_redis,
    ) -> None:
        """archive/unarchive → agent_sessions:changed status_changed（audience=
        全部用户成员）；幂等重归档不重发。"""
        env = await _make_env(db_session, owner_name="sse-owner")
        member, _member_token = await _env_user(db_session, env, name="sse-member")
        data = await _create_group(
            client,
            env.owner_token,
            project_id=env.project.id,
            user_members=[{"user_id": str(member.id)}],
        )
        mocked_sessions_events_redis.publish.reset_mock()  # 建群 "created" 信号清零

        resp = await client.post(
            f"/api/daemon/group-chats/{data['id']}/archive", headers=_headers(env.owner_token)
        )
        assert resp.status_code == 204, resp.text
        publishes = _sessions_changed_publishes(mocked_sessions_events_redis)
        assert publishes, "归档未发布 agent_sessions:changed"
        payload = publishes[-1]
        assert payload["event"] == "status_changed"
        assert payload["session_id"] == data["session_id"]
        assert payload["user_id"] == str(env.owner.id)  # 群主位
        assert sorted(payload["audience_user_ids"]) == sorted([str(env.owner.id), str(member.id)])

        # 幂等重归档 → 不重发（publish 计数不变）。
        before = len(_sessions_changed_publishes(mocked_sessions_events_redis))
        resp = await client.post(
            f"/api/daemon/group-chats/{data['id']}/archive", headers=_headers(env.owner_token)
        )
        assert resp.status_code == 204, resp.text
        assert len(_sessions_changed_publishes(mocked_sessions_events_redis)) == before

        # 取消归档 → status_changed 再发（群回默认列表的刷新信号）。
        mocked_sessions_events_redis.publish.reset_mock()
        resp = await client.post(
            f"/api/daemon/group-chats/{data['id']}/unarchive", headers=_headers(env.owner_token)
        )
        assert resp.status_code == 204, resp.text
        publishes = _sessions_changed_publishes(mocked_sessions_events_redis)
        assert publishes, "取消归档未发布 agent_sessions:changed"
        assert publishes[-1]["event"] == "status_changed"
        assert publishes[-1]["session_id"] == data["session_id"]

    async def test_delete_publishes_deleted(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        mocked_sessions_events_redis,
        mocked_group_redis,
    ) -> None:
        """delete → agent_sessions:changed deleted（末位；前置 status_changed
        来自 end 收口链）+ 群频道 session_ended（end 链复用，SSE 收流）。"""
        env = await _make_env(db_session, owner_name="ssd-owner")
        data = await _create_group(client, env.owner_token, project_id=env.project.id)
        mocked_sessions_events_redis.publish.reset_mock()
        mocked_group_redis.publish.reset_mock()

        resp = await client.delete(
            f"/api/daemon/group-chats/{data['id']}", headers=_headers(env.owner_token)
        )
        assert resp.status_code == 204, resp.text

        publishes = _sessions_changed_publishes(mocked_sessions_events_redis)
        assert publishes, "删除未发布 agent_sessions:changed"
        events = [p["event"] for p in publishes]
        # 活跃群删除先走 end 收口（status_changed）再发 deleted——deleted 恰一条
        # 且居末位（前端 invalidate 重拉后群消失）。
        assert events.count("deleted") == 1
        assert events[-1] == "deleted"
        deleted_payload = publishes[-1]
        assert deleted_payload["session_id"] == data["session_id"]
        assert deleted_payload["user_id"] == str(env.owner.id)
        assert sorted(deleted_payload["audience_user_ids"]) == [str(env.owner.id)]

        # 群频道：end 收口链广播 session_ended（既有语义复用——群 SSE 只认该
        # 事件收流，P1 修复先例）。
        session_id = uuid.UUID(data["session_id"])
        ended_events = [
            e
            for e in _channel_publishes(mocked_group_redis, session_id)
            if e.get("event") == "session_ended"
        ]
        assert len(ended_events) == 1
        assert ended_events[0]["status"] == "ended"
