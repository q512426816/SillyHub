"""task-04（2026-09-10-account-avatar-upload D-002）群成员 user 侧 avatar 回落解析。

覆盖（任务卡 acceptance）：

- 群读主路径（``_to_read`` 批量构造）：user 成员 ``member.avatar`` 有值原样、
  NULL/空串回落 ``users.avatar``、两者皆空 None；agent 成员 avatar 不受影响；
- 建群 / 群列表 / 群详情响应同源回落；
- 加用户成员返回（``members.py`` 新增行 + 复活行两分支）回落；
- 改成员返回（PATCH avatar 空串=清除）回落——响应体与后续群读一致；
- 回落仅增一次 users select-in 预取（无 N+1，D-002 设计约束）；
- 纯函数 ``_apply_user_avatar_fallback`` 单元语义（含映射缺 user 行的退化）。

夹具范式镜像 ``app/modules/daemon/tests/test_group_chat_management.py``（in-memory
SQLite + httpx ASGI client + 手签 JWT + workspace 角色播种——端点门
TASK_RUN_AGENT 需 workspace 角色；Redis publish 两处 get_redis 打桩）。
"""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator, Iterator
from datetime import UTC, datetime
from typing import Any
from unittest.mock import AsyncMock
from unittest.mock import patch as mock_patch

import pytest
from httpx import AsyncClient
from sqlalchemy import event
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.schema import GroupMemberRead
from app.modules.auth.model import Role, RolePermission, User, UserWorkspaceRole
from app.modules.auth.permissions import Permission
from app.modules.daemon.group.service.helpers import _apply_user_avatar_fallback
from app.modules.ppm.project.model import PpmProjectMaintenance, PpmProjectMember
from app.modules.workspace.model import PpmProjectWorkspace, Workspace

# ── 环境播种（test_group_chat_management.py 同款）────────────────────────────


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
    db_session: AsyncSession,
    *,
    name: str,
    admin: bool = False,
    avatar: str | None = None,
) -> tuple[User, str]:
    """造平台用户（avatar=平台头像列 users.avatar，D-001）。"""
    user = User(
        id=uuid.uuid4(),
        email=f"avatar-{name}-{uuid.uuid4()}@example.com",
        password_hash="irrelevant",
        display_name=name,
        status="active",
        is_platform_admin=admin,
        avatar=avatar,
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
        key=f"avatar-{uuid.uuid4().hex[:8]}",
        name="avatar-fallback-test-role",
        description="task-04 seed",
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


async def _make_env(db_session: AsyncSession) -> tuple[Workspace, PpmProjectMaintenance]:
    ws = Workspace(
        id=uuid.uuid4(),
        name="avatar-ws",
        slug=f"avatar-ws-{uuid.uuid4().hex[:8]}",
        root_path="C:/tmp/avatar-ws",
        status="active",
    )
    db_session.add(ws)
    project = PpmProjectMaintenance(
        id=uuid.uuid4(),
        project_code=f"AVT-{uuid.uuid4().hex[:12]}",
        project_name="头像回落测试项目",
    )
    db_session.add(project)
    db_session.add(PpmProjectWorkspace(ppm_project_id=project.id, workspace_id=ws.id))
    await db_session.commit()
    return ws, project


async def _env_owner(
    db_session: AsyncSession,
    ws: Workspace,
    project: PpmProjectMaintenance,
    *,
    avatar: str | None = None,
) -> tuple[User, str]:
    """群主（TASK_RUN_AGENT 角色 + 项目成员，建群口径）。"""
    owner, token = await _create_user_with_token(db_session, name="群主", avatar=avatar)
    await _grant_workspace_role(
        db_session,
        workspace_id=ws.id,
        user_id=owner.id,
        permissions=[Permission.TASK_RUN_AGENT],
    )
    db_session.add(PpmProjectMember(id=uuid.uuid4(), pm_project_id=project.id, user_id=owner.id))
    await db_session.commit()
    return owner, token


async def _env_user(
    db_session: AsyncSession,
    ws: Workspace,
    project: PpmProjectMaintenance,
    *,
    name: str,
    avatar: str | None = None,
) -> tuple[User, str]:
    """受邀用户（workspace 角色 + 项目成员，可被邀请进群）。"""
    user, token = await _create_user_with_token(db_session, name=name, avatar=avatar)
    await _grant_workspace_role(
        db_session,
        workspace_id=ws.id,
        user_id=user.id,
        permissions=[Permission.TASK_RUN_AGENT],
    )
    db_session.add(PpmProjectMember(id=uuid.uuid4(), pm_project_id=project.id, user_id=user.id))
    await db_session.commit()
    return user, token


def _agent_config(runtime_id: uuid.UUID, name: str = "小码", avatar: str | None = None) -> dict:
    cfg: dict = {"display_name": name, "runtime_id": str(runtime_id), "provider": "claude"}
    if avatar is not None:
        cfg["avatar"] = avatar
    return cfg


async def _seed_runtime(db_session: AsyncSession, user_id: uuid.UUID) -> uuid.UUID:
    """造在线机器（agent 成员六要素 runtime 引用，建群校验用）。"""
    from app.modules.daemon.model import DaemonInstance, DaemonRuntime

    instance = DaemonInstance(
        id=uuid.uuid4(),
        user_id=user_id,
        hostname="avatar-host",
        server_url="http://test.local",
        status="online",
        last_heartbeat_at=datetime.now(UTC),
    )
    db_session.add(instance)
    runtime = DaemonRuntime(
        id=uuid.uuid4(),
        daemon_instance_id=instance.id,
        user_id=user_id,
        name="avatar-host",
        provider="claude",
        status="online",
        last_heartbeat_at=datetime.now(UTC),
    )
    db_session.add(runtime)
    await db_session.commit()
    return runtime.id


async def _create_group(
    client: AsyncClient,
    owner_token: str,
    *,
    project_id: uuid.UUID,
    user_members: list[dict] | None = None,
    agent_members: list[dict] | None = None,
) -> dict:
    payload: dict = {"title": "头像回落测试群", "project_id": str(project_id)}
    if user_members:
        payload["user_members"] = user_members
    if agent_members:
        payload["agent_members"] = agent_members
    resp = await client.post("/api/daemon/group-chats", json=payload, headers=_headers(owner_token))
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _get_group(client: AsyncClient, token: str, group_id: uuid.UUID) -> dict:
    resp = await client.get(f"/api/daemon/group-chats/{group_id}", headers=_headers(token))
    assert resp.status_code == 200, resp.text
    return resp.json()


def _member_by_name(data: dict, name: str) -> dict:
    members = {m["display_name"]: m for m in data["members"]}
    assert name in members, f"成员 {name} 不在响应 members：{sorted(members)}"
    return members[name]


# ── Redis publish 替身（test_group_chat_management.py 先例，autouse 保hermetic）──


@pytest.fixture(autouse=True)
def _mocked_group_redis() -> AsyncIterator[AsyncMock]:
    """群频道 publish 替身（group service 侧 get_redis）。"""
    redis = AsyncMock()
    redis.publish = AsyncMock()
    with mock_patch("app.modules.daemon.group.service.get_redis", return_value=redis):
        yield redis


@pytest.fixture(autouse=True)
def _mocked_sessions_events_redis() -> AsyncIterator[AsyncMock]:
    """agent_sessions:changed publish 替身（session_events 模块侧 get_redis）。"""
    redis = AsyncMock()
    redis.publish = AsyncMock()
    with mock_patch("app.modules.daemon.session_events.get_redis", return_value=redis):
        yield redis


@pytest.fixture()
def users_avatar_prefetches(db_engine: Any) -> Iterator[list[str]]:
    """捕获 users 表 avatar 预取语句（``SELECT users.id, users.avatar ... IN``）。

    鉴权等路径的整行 User 加载是 ``WHERE users.id = ?`` 形态，不命中本过滤——
    计数即回落预取的真实查询次数（N+1 回归锚点）。
    """
    captured: list[str] = []

    def _before_cursor_execute(
        conn: Any, cursor: Any, statement: str, parameters: Any, context: Any, executemany: Any
    ) -> None:
        if "users.avatar" in statement and "users.id IN" in statement:
            captured.append(statement)

    event.listen(db_engine.sync_engine, "before_cursor_execute", _before_cursor_execute)
    try:
        yield captured
    finally:
        event.remove(db_engine.sync_engine, "before_cursor_execute", _before_cursor_execute)


# ── 群读主路径（建群响应 / 详情 / 列表）────────────────────────────────────


class TestGroupReadAvatarFallback:
    async def test_read_fallback_matrix(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        """user 成员回落矩阵：自定义优先 / NULL 回落 / 空串回落 / 双空 None / agent 不动。"""
        ws, project = await _make_env(db_session)
        owner, owner_token = await _env_owner(db_session, ws, project, avatar="/api/file/owner")
        runtime_id = await _seed_runtime(db_session, owner.id)
        # 小英：平台头像 + 无群内自定义 → 回落平台头像。
        ying, _ = await _env_user(db_session, ws, project, name="小英", avatar="/api/file/ying")
        # 小明：平台头像 + 群内自定义 → 自定义优先。
        ming, _ = await _env_user(db_session, ws, project, name="小明", avatar="/api/file/ming")
        # 小红：无平台头像 + 无群内自定义 → None。
        hong, _ = await _env_user(db_session, ws, project, name="小红")
        # 小刚：无平台头像 + 群内空串（清除态）→ None。
        gang, _ = await _env_user(db_session, ws, project, name="小刚")

        data = await _create_group(
            client,
            owner_token,
            project_id=project.id,
            user_members=[
                {"user_id": str(ying.id)},
                {"user_id": str(ming.id), "avatar": "/api/file/ming-custom"},
                {"user_id": str(hong.id)},
                {"user_id": str(gang.id), "avatar": ""},
            ],
            agent_members=[
                _agent_config(runtime_id, name="小码", avatar="/api/file/bot"),
                _agent_config(runtime_id, name="小灵"),
            ],
        )
        group_id = uuid.UUID(data["id"])
        # 小刚建群体 avatar 传空串=未自定义（写侧透传），读取端回落 None。
        by_name = {m["display_name"]: m for m in data["members"]}
        assert by_name["群主"]["avatar"] == "/api/file/owner"  # 建群者本人回落
        assert by_name["小英"]["avatar"] == "/api/file/ying"
        assert by_name["小明"]["avatar"] == "/api/file/ming-custom"
        assert by_name["小红"]["avatar"] is None
        assert by_name["小刚"]["avatar"] is None
        assert by_name["小码"]["avatar"] == "/api/file/bot"  # agent 自定义不动
        assert by_name["小灵"]["avatar"] is None  # agent 无头像不回落

        # 详情端点同源（service _to_read 同一路径）。
        detail = await _get_group(client, owner_token, group_id)
        detail_members = {m["display_name"]: m for m in detail["members"]}
        assert detail_members["小英"]["avatar"] == "/api/file/ying"
        assert detail_members["小明"]["avatar"] == "/api/file/ming-custom"
        assert detail_members["小红"]["avatar"] is None
        assert detail_members["小码"]["avatar"] == "/api/file/bot"

        # 列表端点成员 chips 同样回落（受邀成员视角也能看到自己的平台头像）。
        resp = await client.get("/api/daemon/group-chats", headers=_headers(owner_token))
        assert resp.status_code == 200, resp.text
        items = {i["id"]: i for i in resp.json()}
        list_members = {m["display_name"]: m for m in items[str(group_id)]["members"]}
        assert list_members["小英"]["avatar"] == "/api/file/ying"
        assert list_members["小明"]["avatar"] == "/api/file/ming-custom"
        assert list_members["小码"]["avatar"] == "/api/file/bot"

    async def test_platform_avatar_update_reflected_on_read(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        """回落是读取端实时解析：users.avatar 更新后下次群读取新值（非快照）。"""
        ws, project = await _make_env(db_session)
        _owner, owner_token = await _env_owner(db_session, ws, project)
        ying, _ = await _env_user(db_session, ws, project, name="小英")
        data = await _create_group(
            client,
            owner_token,
            project_id=project.id,
            user_members=[{"user_id": str(ying.id)}],
        )
        group_id = uuid.UUID(data["id"])
        assert _member_by_name(data, "小英")["avatar"] is None

        ying.avatar = "/api/file/ying-new"
        db_session.add(ying)
        await db_session.commit()

        detail = await _get_group(client, owner_token, group_id)
        assert _member_by_name(detail, "小英")["avatar"] == "/api/file/ying-new"


# ── 加用户成员返回回落（新增行 + 复活行两分支）────────────────────────────


class TestAddMemberAvatarFallback:
    async def test_add_user_member_falls_back(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        """加用户成员响应：无群内自定义 → 平台头像；带自定义 → 自定义优先。"""
        ws, project = await _make_env(db_session)
        _owner, owner_token = await _env_owner(db_session, ws, project)
        ying, _ = await _env_user(db_session, ws, project, name="小英", avatar="/api/file/ying")
        ming, _ = await _env_user(db_session, ws, project, name="小明", avatar="/api/file/ming")

        data = await _create_group(client, owner_token, project_id=project.id)
        group_id = uuid.UUID(data["id"])

        resp = await client.post(
            f"/api/daemon/group-chats/{group_id}/members",
            json={"user": {"user_id": str(ying.id)}},
            headers=_headers(owner_token),
        )
        assert resp.status_code == 201, resp.text
        assert resp.json()["avatar"] == "/api/file/ying"

        resp = await client.post(
            f"/api/daemon/group-chats/{group_id}/members",
            json={"user": {"user_id": str(ming.id), "avatar": "/api/file/ming-custom"}},
            headers=_headers(owner_token),
        )
        assert resp.status_code == 201, resp.text
        assert resp.json()["avatar"] == "/api/file/ming-custom"

    async def test_revived_user_member_falls_back(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        """移除后复活行（members.py 复活分支）：响应同样回落平台头像。"""
        ws, project = await _make_env(db_session)
        _owner, owner_token = await _env_owner(db_session, ws, project)
        ying, _ = await _env_user(db_session, ws, project, name="小英", avatar="/api/file/ying")

        data = await _create_group(
            client,
            owner_token,
            project_id=project.id,
            user_members=[{"user_id": str(ying.id)}],
        )
        group_id = uuid.UUID(data["id"])
        ying_member_id = _member_by_name(data, "小英")["id"]

        resp = await client.delete(
            f"/api/daemon/group-chats/{group_id}/members/{ying_member_id}",
            headers=_headers(owner_token),
        )
        assert resp.status_code == 204, resp.text

        # 复活：再次邀请同一用户走原行复活分支（removed_at 清空）。
        resp = await client.post(
            f"/api/daemon/group-chats/{group_id}/members",
            json={"user": {"user_id": str(ying.id)}},
            headers=_headers(owner_token),
        )
        assert resp.status_code == 201, resp.text
        assert resp.json()["avatar"] == "/api/file/ying"
        assert resp.json()["id"] == ying_member_id  # 原行复活（同 member id）


# ── 改成员返回回落（PATCH avatar 空串=清除）────────────────────────────────


class TestUpdateMemberAvatarFallback:
    async def test_patch_user_avatar_clear_falls_back(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        """用户成员 PATCH avatar=''（清除群内自定义）：响应体与后续群读都回落平台头像。"""
        ws, project = await _make_env(db_session)
        _owner, owner_token = await _env_owner(db_session, ws, project)
        ying, _ = await _env_user(db_session, ws, project, name="小英", avatar="/api/file/ying")

        data = await _create_group(
            client,
            owner_token,
            project_id=project.id,
            user_members=[{"user_id": str(ying.id), "avatar": "/api/file/ming-custom"}],
        )
        group_id = uuid.UUID(data["id"])
        member_id = _member_by_name(data, "小英")["id"]

        resp = await client.patch(
            f"/api/daemon/group-chats/{group_id}/members/{member_id}",
            json={"avatar": ""},
            headers=_headers(owner_token),
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["avatar"] == "/api/file/ying"  # 响应体回落

        detail = await _get_group(client, owner_token, group_id)
        assert _member_by_name(detail, "小英")["avatar"] == "/api/file/ying"

    async def test_patch_user_avatar_none_keeps_custom(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        """PATCH 不带 avatar（None=不改）：群内自定义保留，不触发回落覆盖。"""
        ws, project = await _make_env(db_session)
        _owner, owner_token = await _env_owner(db_session, ws, project)
        ying, _ = await _env_user(db_session, ws, project, name="小英", avatar="/api/file/ying")

        data = await _create_group(
            client,
            owner_token,
            project_id=project.id,
            user_members=[{"user_id": str(ying.id), "avatar": "/api/file/ming-custom"}],
        )
        group_id = uuid.UUID(data["id"])
        member_id = _member_by_name(data, "小英")["id"]

        resp = await client.patch(
            f"/api/daemon/group-chats/{group_id}/members/{member_id}",
            json={"display_name": "英改"},
            headers=_headers(owner_token),
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["avatar"] == "/api/file/ming-custom"

    async def test_patch_user_without_platform_avatar_returns_none(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        """用户无平台头像且清除群内自定义：响应 None（两者皆空）。"""
        ws, project = await _make_env(db_session)
        _owner, owner_token = await _env_owner(db_session, ws, project)
        hong, _ = await _env_user(db_session, ws, project, name="小红")

        data = await _create_group(
            client,
            owner_token,
            project_id=project.id,
            user_members=[{"user_id": str(hong.id), "avatar": "/api/file/hong-custom"}],
        )
        group_id = uuid.UUID(data["id"])
        member_id = _member_by_name(data, "小红")["id"]

        resp = await client.patch(
            f"/api/daemon/group-chats/{group_id}/members/{member_id}",
            json={"avatar": ""},
            headers=_headers(owner_token),
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["avatar"] is None

    async def test_patch_agent_member_avatar_no_fallback(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        """agent 成员 PATCH avatar：清除存空串原样返回，不做平台头像回落。"""
        ws, project = await _make_env(db_session)
        owner, owner_token = await _env_owner(db_session, ws, project)
        runtime_id = await _seed_runtime(db_session, owner.id)

        data = await _create_group(
            client,
            owner_token,
            project_id=project.id,
            agent_members=[_agent_config(runtime_id, name="小码", avatar="/api/file/bot")],
        )
        group_id = uuid.UUID(data["id"])
        member_id = _member_by_name(data, "小码")["id"]

        resp = await client.patch(
            f"/api/daemon/group-chats/{group_id}/members/{member_id}",
            json={"avatar": ""},
            headers=_headers(owner_token),
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["avatar"] == ""  # agent 成员清除=空串原样（无 user 行回落）


# ── 预取单查询（无 N+1，D-002）─────────────────────────────────────────────


class TestAvatarPrefetchSingleQuery:
    async def test_group_detail_one_users_select(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        users_avatar_prefetches: list[str],
    ) -> None:
        """群详情回落只打一次 users select-in（多 user 成员不 N+1）。"""
        ws, project = await _make_env(db_session)
        owner, owner_token = await _env_owner(db_session, ws, project, avatar="/api/file/owner")
        runtime_id = await _seed_runtime(db_session, owner.id)
        invited: list[dict] = []
        for name in ("小英", "小明", "小红"):
            user, _ = await _env_user(
                db_session, ws, project, name=name, avatar=f"/api/file/{name}"
            )
            invited.append({"user_id": str(user.id)})

        data = await _create_group(
            client,
            owner_token,
            project_id=project.id,
            user_members=invited,
            agent_members=[_agent_config(runtime_id)],
        )
        group_id = uuid.UUID(data["id"])
        users_avatar_prefetches.clear()  # 建群路径的预取不计入本次断言

        detail = await _get_group(client, owner_token, group_id)
        assert len(detail["members"]) == 5
        assert len(users_avatar_prefetches) == 1, users_avatar_prefetches

    async def test_group_list_one_users_select(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        users_avatar_prefetches: list[str],
    ) -> None:
        """群列表跨群批量预取：两个群各含 user 成员，一次请求仍只打一次 users select。"""
        ws, project = await _make_env(db_session)
        _owner, owner_token = await _env_owner(db_session, ws, project, avatar="/api/file/owner")
        ying, _ = await _env_user(db_session, ws, project, name="小英", avatar="/api/file/ying")
        ming, _ = await _env_user(db_session, ws, project, name="小明", avatar="/api/file/ming")

        await _create_group(
            client,
            owner_token,
            project_id=project.id,
            user_members=[{"user_id": str(ying.id)}],
        )
        await _create_group(
            client,
            owner_token,
            project_id=project.id,
            user_members=[{"user_id": str(ming.id)}],
        )
        users_avatar_prefetches.clear()

        resp = await client.get("/api/daemon/group-chats", headers=_headers(owner_token))
        assert resp.status_code == 200, resp.text
        assert len(resp.json()) == 2
        assert len(users_avatar_prefetches) == 1, users_avatar_prefetches


# ── 纯函数单元语义（helpers._apply_user_avatar_fallback）───────────────────


def _member_read(
    *,
    member_type: str = "user",
    avatar: str | None = None,
    user_id: uuid.UUID | None = None,
) -> GroupMemberRead:
    return GroupMemberRead(
        id=uuid.uuid4(),
        member_type=member_type,
        display_name="x",
        avatar=avatar,
        user_id=user_id,
        joined_at=datetime.now(UTC),
        shadow_status="none",
    )


class TestApplyUserAvatarFallbackUnit:
    def test_custom_avatar_wins(self) -> None:
        uid = uuid.uuid4()
        read = _member_read(avatar="/api/file/custom", user_id=uid)
        _apply_user_avatar_fallback([read], {uid: "/api/file/platform"})
        assert read.avatar == "/api/file/custom"

    def test_none_falls_back(self) -> None:
        uid = uuid.uuid4()
        read = _member_read(avatar=None, user_id=uid)
        _apply_user_avatar_fallback([read], {uid: "/api/file/platform"})
        assert read.avatar == "/api/file/platform"

    def test_empty_string_falls_back(self) -> None:
        uid = uuid.uuid4()
        read = _member_read(avatar="", user_id=uid)
        _apply_user_avatar_fallback([read], {uid: "/api/file/platform"})
        assert read.avatar == "/api/file/platform"

    def test_both_empty_returns_none(self) -> None:
        uid = uuid.uuid4()
        read = _member_read(avatar="", user_id=uid)
        _apply_user_avatar_fallback([read], {uid: None})
        assert read.avatar is None

    def test_agent_members_untouched(self) -> None:
        read_agent_custom = _member_read(member_type="agent", avatar="/api/file/bot")
        read_agent_empty = _member_read(member_type="agent", avatar="")
        _apply_user_avatar_fallback(
            [read_agent_custom, read_agent_empty], {uuid.uuid4(): "/api/file/platform"}
        )
        assert read_agent_custom.avatar == "/api/file/bot"
        assert read_agent_empty.avatar == ""

    def test_user_row_missing_from_map_keeps_falsy_none(self) -> None:
        """映射缺 user 行（硬删退化）：空值成员归一为 None，自定义保留。"""
        uid = uuid.uuid4()
        read_empty = _member_read(avatar="", user_id=uid)
        read_custom = _member_read(avatar="/api/file/custom", user_id=uid)
        _apply_user_avatar_fallback([read_empty, read_custom], {})
        assert read_empty.avatar is None
        assert read_custom.avatar == "/api/file/custom"
