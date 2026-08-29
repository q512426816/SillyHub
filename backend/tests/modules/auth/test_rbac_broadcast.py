"""Tests for :func:`list_user_ids_with_permission` (broadcast recipient lookup).

Change 2026-08-29-approval-notify-push task-03 / FR-03 / D-002@v1：镜像
``has_permission`` 三段解析（工作区 grant ∪ 平台级 grant ∪ ``is_platform_admin``）
反查收件人集合，供 NotificationService.notify_broadcast 使用。

覆盖：
  1. 工作区 grant 命中 + 未授权/其他 workspace 用户不返回；
  2. 平台级 grant（admin UserRole）命中；
  3. ``is_platform_admin`` 用户命中（无需任何 grant）；
  4. 并集去重（同一用户多段命中只出现一次）；
  5. 非活跃账户（status != active）被过滤；
  6. 空结果。
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.auth.model import Role, RolePermission, User, UserWorkspaceRole
from app.modules.auth.permissions import Permission
from app.modules.auth.rbac import list_user_ids_with_permission


async def _make_user(session: AsyncSession, *, status: str = "active", admin: bool = False) -> User:
    user = User(
        id=uuid.uuid4(),
        email=f"user-{uuid.uuid4().hex[:8]}@example.com",
        password_hash="x",
        status=status,
        is_platform_admin=admin,
    )
    session.add(user)
    await session.commit()
    await session.refresh(user)
    return user


async def _make_role(session: AsyncSession, *, permissions: list[Permission]) -> Role:
    role = Role(id=uuid.uuid4(), key=f"role-{uuid.uuid4().hex[:8]}", name="t")
    session.add(role)
    await session.flush()
    for perm in permissions:
        session.add(RolePermission(role_id=role.id, permission=perm.value))
    await session.commit()
    return role


@pytest.mark.asyncio
async def test_workspace_grant_hit_and_unauthorized_miss(
    db_session: AsyncSession,
) -> None:
    """工作区 grant 命中；未授权用户 + 其他 workspace 的同角色用户不返回。"""
    ws = uuid.uuid4()
    other_ws = uuid.uuid4()
    role = await _make_role(db_session, permissions=[Permission.CHANGE_CREATE])

    holder = await _make_user(db_session)
    outsider = await _make_user(db_session)
    other_ws_user = await _make_user(db_session)

    db_session.add(UserWorkspaceRole(user_id=holder.id, workspace_id=ws, role_id=role.id))
    db_session.add(
        UserWorkspaceRole(user_id=other_ws_user.id, workspace_id=other_ws, role_id=role.id)
    )
    await db_session.commit()

    got = await list_user_ids_with_permission(
        db_session, workspace_id=ws, permission=Permission.CHANGE_CREATE
    )
    assert set(got) == {holder.id}
    assert outsider.id not in got
    assert other_ws_user.id not in got


@pytest.mark.asyncio
async def test_workspace_platform_admin_role_grants_permission(
    db_session: AsyncSession,
) -> None:
    """工作区内持有 PLATFORM_ADMIN 角色的用户对任意 permission 放行（镜像 :125/:130）。"""
    from app.modules.admin.model import UserRole as AdminUserRole  # noqa: F401

    ws = uuid.uuid4()
    role = await _make_role(db_session, permissions=[Permission.PLATFORM_ADMIN])
    user = await _make_user(db_session)
    db_session.add(UserWorkspaceRole(user_id=user.id, workspace_id=ws, role_id=role.id))
    await db_session.commit()

    got = await list_user_ids_with_permission(
        db_session, workspace_id=ws, permission=Permission.CHANGE_CREATE
    )
    assert set(got) == {user.id}


@pytest.mark.asyncio
async def test_platform_level_grant_hit(db_session: AsyncSession) -> None:
    """平台级 UserRole grant（无 workspace 归属）命中。"""
    from app.modules.admin.model import UserRole

    ws = uuid.uuid4()
    role = await _make_role(db_session, permissions=[Permission.CHANGE_CREATE])
    user = await _make_user(db_session)
    db_session.add(UserRole(user_id=user.id, role_id=role.id))
    await db_session.commit()

    got = await list_user_ids_with_permission(
        db_session, workspace_id=ws, permission=Permission.CHANGE_CREATE
    )
    assert set(got) == {user.id}


@pytest.mark.asyncio
async def test_is_platform_admin_user_hit_without_grants(
    db_session: AsyncSession,
) -> None:
    ws = uuid.uuid4()
    admin = await _make_user(db_session, admin=True)
    normal = await _make_user(db_session)

    got = await list_user_ids_with_permission(
        db_session, workspace_id=ws, permission=Permission.CHANGE_CREATE
    )
    assert set(got) == {admin.id}
    assert normal.id not in got


@pytest.mark.asyncio
async def test_union_deduplicates_multi_segment_hits(
    db_session: AsyncSession,
) -> None:
    """同一用户同时命中工作区 grant + 平台级 grant，只出现一次。"""
    from app.modules.admin.model import UserRole

    ws = uuid.uuid4()
    role = await _make_role(db_session, permissions=[Permission.CHANGE_CREATE])
    user = await _make_user(db_session)
    db_session.add(UserWorkspaceRole(user_id=user.id, workspace_id=ws, role_id=role.id))
    db_session.add(UserRole(user_id=user.id, role_id=role.id))
    await db_session.commit()

    got = await list_user_ids_with_permission(
        db_session, workspace_id=ws, permission=Permission.CHANGE_CREATE
    )
    assert got.count(user.id) == 1


@pytest.mark.asyncio
async def test_inactive_users_filtered(db_session: AsyncSession) -> None:
    """disabled / deleted 账户即使持有 grant / is_platform_admin 也不返回。"""
    ws = uuid.uuid4()
    role = await _make_role(db_session, permissions=[Permission.CHANGE_CREATE])

    disabled = await _make_user(db_session, status="disabled")
    deleted = await _make_user(db_session, status="deleted", admin=True)
    active = await _make_user(db_session)

    for u in (disabled, active):
        db_session.add(UserWorkspaceRole(user_id=u.id, workspace_id=ws, role_id=role.id))
    await db_session.commit()

    got = await list_user_ids_with_permission(
        db_session, workspace_id=ws, permission=Permission.CHANGE_CREATE
    )
    assert set(got) == {active.id}
    assert disabled.id not in got
    assert deleted.id not in got


@pytest.mark.asyncio
async def test_empty_result_when_noone_holds_permission(
    db_session: AsyncSession,
) -> None:
    ws = uuid.uuid4()
    await _make_user(db_session)

    got = await list_user_ids_with_permission(
        db_session, workspace_id=ws, permission=Permission.CHANGE_CREATE
    )
    assert got == []
