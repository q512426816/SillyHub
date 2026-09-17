"""工作区列表平台级授权口径对齐测试（ql-20260917-007-7cec）。

背景：持有平台级角色（``user_roles``，如 super_admin 含 ``workspace:read``）
的用户在 ``has_permission`` 段 2 与通知广播收件人查找（
``list_user_ids_with_permission`` 段 2）下对所有工作区有真实读权限，
但 ``GET /api/workspaces`` 非管理员分支原先只查 ``user_workspace_roles``
（``allowed_workspace_ids``），导致「列表看不到工作区，却能收到其通知、
点进其内容」的三处口径割裂。

覆盖 ``GET /api/workspaces``：
  - 平台级角色含 ``workspace:read`` → 全量工作区可见（含非成员工作区）；
  - 平台级角色含 ``platform:admin`` → 全量可见；
  - 平台级角色不含读权限（如仅 ``ppm:task:read``）→ 维持工作区级限定，
    看不到非成员工作区（回归护栏，防口径扩大成「任何平台角色都全量」）；
  - 无任何角色的普通用户 → 空列表（既有语义回归）。

不 mock service —— 真实建 Workspace/Role/UserRole 行跑真实 SQL
（SQLite in-memory，方言无关断言），与 test_permission_scope.py 同范式。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.security import create_access_token, password_hasher
from app.modules.admin.model import UserRole
from app.modules.auth.model import Role, RolePermission, User, UserWorkspaceRole
from app.modules.workspace.model import Workspace


async def _make_user(db_session: AsyncSession) -> tuple[User, str]:
    user = User(
        id=uuid.uuid4(),
        email=f"plat-grant-{uuid.uuid4().hex[:6]}@example.com",
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


async def _grant_platform_role(
    db_session: AsyncSession, *, user: User, permissions: list[str]
) -> None:
    """给 user 绑一个平台级角色（user_roles），带指定权限集。"""
    role = Role(
        id=uuid.uuid4(),
        key=f"plat_{uuid.uuid4().hex[:8]}",
        name="Platform Role",
        description="test platform-level role",
    )
    db_session.add(role)
    for perm in permissions:
        db_session.add(RolePermission(role_id=role.id, permission=perm))
    db_session.add(UserRole(user_id=user.id, role_id=role.id))
    await db_session.commit()


async def test_platform_workspace_read_sees_all_workspaces(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """平台级 workspace:read → 非成员工作区也出现在列表（对齐真实读权限）。"""
    member_ws = await _make_workspace(db_session, name="pg-member")
    outsider_ws = await _make_workspace(db_session, name="pg-outsider")
    user, token = await _make_user(db_session)
    await _grant_platform_role(db_session, user=user, permissions=["workspace:read"])

    resp = await client.get("/api/workspaces", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200, resp.text
    ids = {item["id"] for item in resp.json()["items"]}
    assert str(member_ws.id) in ids
    assert str(outsider_ws.id) in ids


async def test_platform_admin_perm_sees_all_workspaces(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """平台级 platform:admin 权限 → 全量可见（对齐 has_permission 段 2 准入）。"""
    outsider_ws = await _make_workspace(db_session, name="pg-admin-outsider")
    user, token = await _make_user(db_session)
    await _grant_platform_role(db_session, user=user, permissions=["platform:admin"])

    resp = await client.get("/api/workspaces", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200, resp.text
    ids = {item["id"] for item in resp.json()["items"]}
    assert str(outsider_ws.id) in ids


async def test_workspace_scoped_member_sees_only_own_workspace(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """工作区级 workspace:read 成员 → 只见自己工作区，不见非成员工作区
    （allowed_workspace_ids 分支回归护栏，平台级对齐不得影响原路径）。"""
    own_ws = await _make_workspace(db_session, name="pg-own")
    outsider_ws = await _make_workspace(db_session, name="pg-ws-outsider")
    user, token = await _make_user(db_session)
    role = Role(
        id=uuid.uuid4(),
        key=f"ws_reader_{uuid.uuid4().hex[:6]}",
        name="Workspace Reader",
        description="test role with workspace:read",
    )
    db_session.add(role)
    db_session.add(RolePermission(role_id=role.id, permission="workspace:read"))
    db_session.add(
        UserWorkspaceRole(
            user_id=user.id,
            workspace_id=own_ws.id,
            role_id=role.id,
            granted_by=None,
            granted_at=datetime.now(UTC),
        )
    )
    await db_session.commit()

    resp = await client.get("/api/workspaces", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200, resp.text
    ids = {item["id"] for item in resp.json()["items"]}
    assert str(own_ws.id) in ids
    assert str(outsider_ws.id) not in ids


async def test_platform_role_without_read_perm_rejected_at_door(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """平台级角色不含读权限（如仅 ppm 权限）→ 被入口
    ``require_permission_any(WORKSPACE_READ)`` 挡 403（依赖层先于列表分支，
    既有语义回归——口径不扩大成「任何平台角色都全量」）。"""
    await _make_workspace(db_session, name="pg-ppm-outsider")
    user, token = await _make_user(db_session)
    await _grant_platform_role(db_session, user=user, permissions=["ppm:task:read"])

    resp = await client.get("/api/workspaces", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 403, resp.text


async def test_user_without_any_role_gets_403(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """无任何角色的普通用户 → 403（既有语义回归，入口依赖未变）。"""
    await _make_workspace(db_session, name="pg-no-role")
    _, token = await _make_user(db_session)

    resp = await client.get("/api/workspaces", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 403, resp.text
