"""Permission resolution.

``platform_admin`` bypasses every check (this is the V1 simplification
documented in task-04a §1). Everyone else must have the permission granted
via at least one role inside the requested workspace, **or** at the
platform level via the ``user_roles`` table (change
2026-06-16-admin-org-role-center task-02).
"""

from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import col

from app.modules.auth.model import Role, RolePermission, User, UserWorkspaceRole
from app.modules.auth.permissions import Permission


async def collect_permissions(
    session: AsyncSession, *, user_id: uuid.UUID, workspace_id: uuid.UUID
) -> set[str]:
    """Return the union of every permission this user has in this workspace."""
    stmt = (
        select(col(RolePermission.permission))
        .join(Role, col(Role.id) == col(RolePermission.role_id))
        .join(UserWorkspaceRole, col(UserWorkspaceRole.role_id) == col(Role.id))
        .where(col(UserWorkspaceRole.user_id) == user_id)
        .where(col(UserWorkspaceRole.workspace_id) == workspace_id)
    )
    rows = (await session.execute(stmt)).scalars().all()
    return set(rows)


async def collect_permissions_all(session: AsyncSession, *, user_id: uuid.UUID) -> set[str]:
    """Union of permissions this user holds across *all* workspaces."""
    stmt = (
        select(col(RolePermission.permission))
        .join(Role, col(Role.id) == col(RolePermission.role_id))
        .join(UserWorkspaceRole, col(UserWorkspaceRole.role_id) == col(Role.id))
        .where(col(UserWorkspaceRole.user_id) == user_id)
    )
    rows = (await session.execute(stmt)).scalars().all()
    return set(rows)


async def collect_permissions_platform(session: AsyncSession, *, user_id: uuid.UUID) -> set[str]:
    """Union of permissions granted at the platform level via ``user_roles``.

    Mirrors change 2026-06-16-admin-org-role-center task-02. Independent
    of any workspace; checked before the workspace-scoped path so admin
    center endpoints can grant access without a workspace context.

    Falls back to an empty set when the admin module is not yet
    bootstrapped (task-03 pending) so existing workspace-scoped tests
    do not break during the staged rollout.
    """
    try:
        from app.modules.admin.model import UserRole
    except ImportError:
        return set()

    stmt = (
        select(col(RolePermission.permission))
        .join(Role, col(Role.id) == col(RolePermission.role_id))
        .join(UserRole, col(UserRole.role_id) == col(Role.id))
        .where(col(UserRole.user_id) == user_id)
    )
    rows = (await session.execute(stmt)).scalars().all()
    return set(rows)


async def collect_permissions_everywhere(session: AsyncSession, *, user_id: uuid.UUID) -> set[str]:
    """Union of platform-level + every-workspace permissions for ``user_id``.

    Used by ``GET /api/auth/me`` so the frontend can drive UI gating
    (e.g. the admin-center menu) off the user's full grant set rather
    than just ``is_platform_admin``.
    """
    platform = await collect_permissions_platform(session, user_id=user_id)
    workspace = await collect_permissions_all(session, user_id=user_id)
    return platform | workspace


async def has_permission(
    session: AsyncSession,
    *,
    user: User,
    permission: Permission,
    workspace_id: uuid.UUID | None,
) -> bool:
    """``True`` iff ``user`` may perform ``permission`` in this workspace.

    Resolution order (change 2026-06-16-admin-org-role-center task-02):
    1. ``is_platform_admin`` short-circuit.
    2. Platform-level grant via ``user_roles`` (workspace-agnostic).
    3. Workspace-scoped grant via ``user_workspace_roles``.
    """
    if user.is_platform_admin:
        return True

    platform_perms = await collect_permissions_platform(session, user_id=user.id)
    if permission.value in platform_perms or Permission.PLATFORM_ADMIN.value in platform_perms:
        return True

    if workspace_id is None:
        perms = await collect_permissions_all(session, user_id=user.id)
        return permission.value in perms or Permission.PLATFORM_ADMIN.value in perms
    perms = await collect_permissions(session, user_id=user.id, workspace_id=workspace_id)
    return permission.value in perms or Permission.PLATFORM_ADMIN.value in perms


async def list_user_workspace_roles(
    session: AsyncSession, *, user_id: uuid.UUID
) -> list[tuple[uuid.UUID, str, str]]:
    """For ``GET /api/auth/me``: returns (workspace_id, role_key, role_name)."""
    stmt = (
        select(col(UserWorkspaceRole.workspace_id), col(Role.key), col(Role.name))
        .join(Role, col(Role.id) == col(UserWorkspaceRole.role_id))
        .where(col(UserWorkspaceRole.user_id) == user_id)
    )
    rows = (await session.execute(stmt)).all()
    return [(wid, key, name) for wid, key, name in rows]


async def allowed_workspace_ids(
    session: AsyncSession,
    *,
    user_id: uuid.UUID,
    permission: Permission,
) -> list[uuid.UUID]:
    """Return workspace_ids where user has the exact ``permission`` granted.

    Platform admin bypasses this at the dependency layer.
    """
    stmt = (
        select(col(UserWorkspaceRole.workspace_id))
        .join(Role, col(Role.id) == col(UserWorkspaceRole.role_id))
        .join(RolePermission, col(RolePermission.role_id) == col(Role.id))
        .where(col(UserWorkspaceRole.user_id) == user_id)
        .where(col(RolePermission.permission) == permission.value)
        .distinct()
    )
    rows = (await session.execute(stmt)).scalars().all()
    return list(rows)
