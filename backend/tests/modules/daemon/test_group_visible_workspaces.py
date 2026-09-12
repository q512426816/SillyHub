"""task-03（2026-09-13-session-group-ux-fixes D-003）群列表 visible_workspace_ids。

覆盖（任务卡 acceptance）：

- 群挂项目（``PpmProjectWorkspace`` 关联 D/F 两工作区、群 ``workspace_id=D``）
  → 列表项 ``visible_workspace_ids`` 含 D 与 F（顺序不敏感，且 D 去重不重复
  出现——直接归属与项目关联交集）；
- 无 project 群（项目删除 SET NULL 后的存量口径，直改行模拟）→
  ``visible_workspace_ids`` 仅直接归属 ``[workspace_id]``；
- 非群成员用户（纵使是项目成员）列表不见该群——既有成员过滤零回归。

夹具范式镜像 ``test_group_member_avatar_fallback.py``（in-memory SQLite +
httpx ASGI client + 手签 JWT + workspace 角色播种；Redis publish 两处
get_redis 打桩）。
"""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime
from unittest.mock import AsyncMock
from unittest.mock import patch as mock_patch

import pytest
from httpx import AsyncClient
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.model import AgentGroupChat
from app.modules.auth.model import Role, RolePermission, User, UserWorkspaceRole
from app.modules.auth.permissions import Permission
from app.modules.ppm.project.model import PpmProjectMaintenance, PpmProjectMember
from app.modules.workspace.model import PpmProjectWorkspace, Workspace

# ── 环境播种（test_group_member_avatar_fallback.py 同款）────────────────────


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
) -> tuple[User, str]:
    """造平台用户。"""
    user = User(
        id=uuid.uuid4(),
        email=f"visible-{name}-{uuid.uuid4()}@example.com",
        password_hash="irrelevant",
        display_name=name,
        status="active",
        is_platform_admin=False,
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
        key=f"visible-{uuid.uuid4().hex[:8]}",
        name="visible-workspace-test-role",
        description="task-03 seed",
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


async def _make_env(
    db_session: AsyncSession,
) -> tuple[Workspace, Workspace, PpmProjectMaintenance]:
    """双工作区（D/F）+ 同时关联两工作区的项目（D-003 场景底座）。"""
    ws_d = Workspace(
        id=uuid.uuid4(),
        name="visible-ws-d",
        slug=f"visible-ws-d-{uuid.uuid4().hex[:8]}",
        root_path="C:/tmp/visible-ws-d",
        status="active",
    )
    ws_f = Workspace(
        id=uuid.uuid4(),
        name="visible-ws-f",
        slug=f"visible-ws-f-{uuid.uuid4().hex[:8]}",
        root_path="C:/tmp/visible-ws-f",
        status="active",
    )
    db_session.add_all([ws_d, ws_f])
    project = PpmProjectMaintenance(
        id=uuid.uuid4(),
        project_code=f"VIS-{uuid.uuid4().hex[:12]}",
        project_name="可见工作区测试项目",
    )
    db_session.add(project)
    db_session.add_all(
        [
            PpmProjectWorkspace(ppm_project_id=project.id, workspace_id=ws_d.id),
            PpmProjectWorkspace(ppm_project_id=project.id, workspace_id=ws_f.id),
        ]
    )
    await db_session.commit()
    return ws_d, ws_f, project


async def _env_user(
    db_session: AsyncSession,
    ws_d: Workspace,
    project: PpmProjectMaintenance,
    *,
    name: str,
) -> tuple[User, str]:
    """项目成员 + D 工作区 TASK_RUN_AGENT 角色（端点门；群成员资格另行区分）。"""
    user, token = await _create_user_with_token(db_session, name=name)
    await _grant_workspace_role(
        db_session,
        workspace_id=ws_d.id,
        user_id=user.id,
        permissions=[Permission.TASK_RUN_AGENT],
    )
    db_session.add(PpmProjectMember(id=uuid.uuid4(), pm_project_id=project.id, user_id=user.id))
    await db_session.commit()
    return user, token


async def _create_group_on_d(
    client: AsyncClient,
    owner_token: str,
    *,
    project_id: uuid.UUID,
    workspace_id: uuid.UUID,
) -> dict:
    payload = {
        "title": "可见工作区测试群",
        "project_id": str(project_id),
        "workspace_id": str(workspace_id),
    }
    resp = await client.post("/api/daemon/group-chats", json=payload, headers=_headers(owner_token))
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _list_groups(client: AsyncClient, token: str) -> dict[str, dict]:
    resp = await client.get("/api/daemon/group-chats", headers=_headers(token))
    assert resp.status_code == 200, resp.text
    return {item["id"]: item for item in resp.json()}


# ── Redis publish 替身（test_group_member_avatar_fallback.py 先例）──────────


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


# ── D-003：visible_workspace_ids 组装三断言 ─────────────────────────────────


class TestGroupVisibleWorkspaceIds:
    async def test_project_group_unions_linked_workspaces(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        """群挂 D/F 双工作区项目（锚 D）：可见集合 = {D, F}，D 去重不重复。"""
        ws_d, ws_f, project = await _make_env(db_session)
        _owner, owner_token = await _env_user(db_session, ws_d, project, name="群主")
        data = await _create_group_on_d(
            client, owner_token, project_id=project.id, workspace_id=ws_d.id
        )
        assert data["workspace_id"] == str(ws_d.id)  # 锚定直接归属 D

        items = await _list_groups(client, owner_token)
        item = items[data["id"]]
        visible = item["visible_workspace_ids"]
        # 顺序不敏感；D 既在直接归属又在项目关联集——去重后恰 2 个元素。
        assert set(visible) == {str(ws_d.id), str(ws_f.id)}
        assert len(visible) == 2, visible

    async def test_no_project_group_only_direct_workspace(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        """项目删除后的存量无 project 群：可见集合退化为仅直接归属 [D]。"""
        ws_d, _ws_f, project = await _make_env(db_session)
        _owner, owner_token = await _env_user(db_session, ws_d, project, name="群主")
        data = await _create_group_on_d(
            client, owner_token, project_id=project.id, workspace_id=ws_d.id
        )
        group_id = uuid.UUID(data["id"])

        # 模拟项目删除（ppm FK ondelete=SET NULL 后的存量群口径）：直改行置空。
        await db_session.execute(
            update(AgentGroupChat).where(AgentGroupChat.id == group_id).values(project_id=None)
        )
        await db_session.commit()

        items = await _list_groups(client, owner_token)
        assert items[str(group_id)]["visible_workspace_ids"] == [str(ws_d.id)]

    async def test_non_member_cannot_see_group(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        """非群成员（纵使是项目成员）列表不见该群——成员过滤零回归。"""
        ws_d, _ws_f, project = await _make_env(db_session)
        _owner, owner_token = await _env_user(db_session, ws_d, project, name="群主")
        data = await _create_group_on_d(
            client, owner_token, project_id=project.id, workspace_id=ws_d.id
        )
        # 旁观者：同项目成员 + 同工作区角色，但从未被邀请进群。
        _outsider, outsider_token = await _env_user(db_session, ws_d, project, name="旁观者")

        owner_items = await _list_groups(client, owner_token)
        assert data["id"] in owner_items  # 群主视角可见（对照组）
        outsider_items = await _list_groups(client, outsider_token)
        assert data["id"] not in outsider_items
        assert outsider_items == {}  # 无任何群——成员过滤不因可见集扩展放宽
