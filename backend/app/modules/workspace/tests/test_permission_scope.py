"""workspace activate / init 权限 scope 收紧测试（security-audit-remediation task-09）。

覆盖 ``POST /api/workspaces/{id}/activate`` 与 ``POST /api/workspaces/{id}/init``：
  - 非成员（any 级有 workspace:write——在其它 workspace 持有该权限）→ 403；
  - 目标 workspace 成员（带 workspace:write 角色）→ 放行（回归护栏，init 走
    平台 admin 既有用例覆盖，这里覆盖普通成员路径）。

背景：两端口原为 ``require_permission_any(WORKSPACE_WRITE)``（跨 workspace 并集
判定），任何在别的 workspace 有写权限的用户可对本 workspace 激活/派发 init
lease。收紧为 workspace-scoped ``require_permission(WORKSPACE_WRITE)``（路径参数
workspace_id 注入，非成员 403 权限拒绝）。

不 mock service —— 真实建 Workspace/Role/UserWorkspaceRole 行跑真实 SQL
（SQLite in-memory，方言无关断言）。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.security import create_access_token, password_hasher
from app.modules.auth.model import Role, RolePermission, User, UserWorkspaceRole
from app.modules.workspace.model import Workspace


async def _make_user(db_session: AsyncSession) -> tuple[User, str]:
    user = User(
        id=uuid.uuid4(),
        email=f"ws-scope-{uuid.uuid4().hex[:6]}@example.com",
        password_hash=password_hasher.hash("x"),
        status="active",
        is_platform_admin=False,
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    token, _ = create_access_token(
        user_id=user.id,
        email=user.email,
        is_admin=user.is_platform_admin,
        settings=get_settings(),
    )
    return user, token


async def _make_workspace(db_session: AsyncSession, *, name: str) -> Workspace:
    ws = Workspace(
        id=uuid.uuid4(),
        name=name,
        slug=f"{name}-{uuid.uuid4().hex[:8]}",
        root_path=f"/tmp/{name}-{uuid.uuid4().hex[:8]}",
        status="active",
    )
    db_session.add(ws)
    await db_session.commit()
    await db_session.refresh(ws)
    return ws


def _make_write_role(ws: Workspace) -> Role:
    return Role(
        id=uuid.uuid4(),
        key=f"ws_writer_{ws.id.hex[:6]}",
        name="Workspace Writer",
        description="test role with workspace:write",
    )


async def _grant_write_role(
    db_session: AsyncSession, *, user: User, ws: Workspace, role: Role
) -> None:
    db_session.add(role)
    db_session.add(RolePermission(role_id=role.id, permission="workspace:write"))
    db_session.add(
        UserWorkspaceRole(
            user_id=user.id,
            workspace_id=ws.id,
            role_id=role.id,
            granted_by=None,
            granted_at=datetime.now(UTC),
        )
    )
    await db_session.commit()


async def test_activate_403_for_member_of_other_workspace(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """any 级有 workspace:write（在 W2）、目标 W1 无角色 → activate 403。"""
    ws1 = await _make_workspace(db_session, name="scope-w1")
    ws2 = await _make_workspace(db_session, name="scope-w2")
    user, token = await _make_user(db_session)
    await _grant_write_role(db_session, user=user, ws=ws2, role=_make_write_role(ws2))

    resp = await client.post(
        f"/api/workspaces/{ws1.id}/activate",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 403, resp.text


async def test_activate_403_for_user_with_no_roles(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """完全无角色的普通用户 → activate 403（原有语义回归）。"""
    ws = await _make_workspace(db_session, name="scope-no-role")
    _, token = await _make_user(db_session)

    resp = await client.post(
        f"/api/workspaces/{ws.id}/activate",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 403, resp.text


async def test_activate_200_for_workspace_member_with_write(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """目标 workspace 成员（带 workspace:write）→ activate 放行，状态流转回归不变。"""
    ws = await _make_workspace(db_session, name="scope-ok")
    user, token = await _make_user(db_session)
    await _grant_write_role(db_session, user=user, ws=ws, role=_make_write_role(ws))

    resp = await client.post(
        f"/api/workspaces/{ws.id}/activate",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["id"] == str(ws.id)
    assert resp.json()["status"] == "active"


async def test_init_403_for_member_of_other_workspace(
    client: AsyncClient, db_session: AsyncSession, monkeypatch: Any
) -> None:
    """any 级有 workspace:write（在 W2）、目标 W1 无角色 → init 403（不触达派发逻辑）。"""
    ws1 = await _make_workspace(db_session, name="scope-init-w1")
    ws2 = await _make_workspace(db_session, name="scope-init-w2")
    user, token = await _make_user(db_session)
    await _grant_write_role(db_session, user=user, ws=ws2, role=_make_write_role(ws2))

    # 权限被拒时绝不能走到 service 派发——mock 成 fail-fast 哨兵。
    from app.modules.agent import service as agent_service_module

    def _must_not_dispatch(*args: Any, **kwargs: Any) -> None:
        raise AssertionError("start_init_dispatch must not be reached for non-member")

    monkeypatch.setattr(
        agent_service_module.AgentService, "start_init_dispatch", _must_not_dispatch
    )

    resp = await client.post(
        f"/api/workspaces/{ws1.id}/init",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 403, resp.text
