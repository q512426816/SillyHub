"""Permission resolution.

``platform_admin`` bypasses every check (this is the V1 simplification
documented in task-04a §1). Everyone else must have the permission granted
via at least one role inside the requested workspace; within a workspace,
platform-level grants via ``user_roles`` admit only ``platform:admin``,
and other platform-level permissions apply only outside workspace context
(change 2026-06-16-admin-org-role-center task-02, tightened by
2026-09-20-workspace-member-visibility task-01).
"""

from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import col

from app.core.permission_cache import get_cached_permissions, set_cached_permissions
from app.modules.auth.model import Role, RolePermission, User, UserWorkspaceRole
from app.modules.auth.permissions import Permission


async def collect_permissions(
    session: AsyncSession, *, user_id: uuid.UUID, workspace_id: uuid.UUID
) -> set[str]:
    """Return the union of every permission this user has in this workspace."""
    cached = await get_cached_permissions(user_id, scope="workspace", workspace_id=workspace_id)
    if cached is not None:
        return cached
    stmt = (
        select(col(RolePermission.permission))
        .join(Role, col(Role.id) == col(RolePermission.role_id))
        .join(UserWorkspaceRole, col(UserWorkspaceRole.role_id) == col(Role.id))
        .where(col(UserWorkspaceRole.user_id) == user_id)
        .where(col(UserWorkspaceRole.workspace_id) == workspace_id)
    )
    rows = (await session.execute(stmt)).scalars().all()
    perms = set(rows)
    await set_cached_permissions(user_id, perms, scope="workspace", workspace_id=workspace_id)
    return perms


async def collect_permissions_all(session: AsyncSession, *, user_id: uuid.UUID) -> set[str]:
    """Union of permissions this user holds across *all* workspaces."""
    cached = await get_cached_permissions(user_id, scope="all")
    if cached is not None:
        return cached
    stmt = (
        select(col(RolePermission.permission))
        .join(Role, col(Role.id) == col(RolePermission.role_id))
        .join(UserWorkspaceRole, col(UserWorkspaceRole.role_id) == col(Role.id))
        .where(col(UserWorkspaceRole.user_id) == user_id)
    )
    rows = (await session.execute(stmt)).scalars().all()
    perms = set(rows)
    await set_cached_permissions(user_id, perms, scope="all")
    return perms


async def collect_permissions_platform(session: AsyncSession, *, user_id: uuid.UUID) -> set[str]:
    """Union of permissions granted at the platform level via ``user_roles``.

    Mirrors change 2026-06-16-admin-org-role-center task-02. Independent
    of any workspace; checked before the workspace-scoped path so admin
    center endpoints can grant access without a workspace context.

    Falls back to an empty set when the admin module is not yet
    bootstrapped (task-03 pending) so existing workspace-scoped tests
    do not break during the staged rollout.

    缓存(FR-02/D-003@v2):读 ``perm:{user_id}:platform``;miss 查库回填。
    ``ImportError`` 降级分支(admin 未 bootstrap)不回填缓存(非真实空集,真实
    权限可能非空,只是 admin 模块未装——缓存空集会导致后续命中错误返回空)。
    """
    cached = await get_cached_permissions(user_id, scope="platform")
    if cached is not None:
        return cached
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
    perms = set(rows)
    await set_cached_permissions(user_id, perms, scope="platform")
    return perms


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

    Change 2026-09-20-workspace-member-visibility (task-01): platform-level
    *business* permissions no longer punch through into a workspace context —
    inside a workspace only ``platform:admin`` (or the ``is_platform_admin``
    flag) escalates beyond membership. This supersedes the pass-through
    semantics of the ql-20260917-007 era. Entry checks without a workspace
    (``require_permission_any`` semantics) keep the legacy platform
    pass-through: platform-level hold of the permission itself (or
    ``PLATFORM_ADMIN``) still admits, else the all-workspace union decides.
    """
    if user.is_platform_admin:
        return True

    platform_perms = await collect_permissions_platform(session, user_id=user.id)

    if workspace_id is None:
        # Feature-entry path (require_permission_any): unchanged behavior.
        if permission.value in platform_perms or Permission.PLATFORM_ADMIN.value in platform_perms:
            return True
        perms = await collect_permissions_all(session, user_id=user.id)
        return permission.value in perms or Permission.PLATFORM_ADMIN.value in perms

    # Workspace context: platform segment only admits PLATFORM_ADMIN —
    # business permissions must come from workspace membership below.
    if Permission.PLATFORM_ADMIN.value in platform_perms:
        return True
    perms = await collect_permissions(session, user_id=user.id, workspace_id=workspace_id)
    return permission.value in perms or Permission.PLATFORM_ADMIN.value in perms


async def list_user_ids_with_permission(
    session: AsyncSession,
    *,
    workspace_id: uuid.UUID,
    permission: Permission,
) -> list[uuid.UUID]:
    """Broadcast recipient lookup (change 2026-08-29-approval-notify-push FR-03).

    Return the ids of every **active** user holding ``permission`` in this
    workspace. Mirrors :func:`has_permission`'s three resolution segments
    (D-002@v1):

    1. Workspace grant via ``user_workspace_roles`` → roles →
       role_permissions (users holding a role whose permission set contains
       ``permission`` **or** ``PLATFORM_ADMIN`` are admitted).
    2. Platform-level grant via admin ``user_roles``, admitting only
       ``PLATFORM_ADMIN`` holders (workspace-agnostic). Falls back to an
       empty segment when the admin module is not bootstrapped — same
       ImportError degradation as :func:`collect_permissions_platform`.
    3. Users flagged ``is_platform_admin``.

    2026-09-20-workspace-member-visibility：段 2 仅匹配 platform:admin——平台级持业务
    权限的非成员不再收工作区广播（对齐 has_permission 收紧后语义）。

    Only users with ``status == "active"`` are returned (Grill X-04);
    disabled/deleted accounts never receive broadcast notifications.

    This is a reverse lookup over the same tables the per-user collectors
    query, so it deliberately bypasses the per-user permission cache.
    """
    target = permission.value
    admin_perm = Permission.PLATFORM_ADMIN.value

    # Segment 1: workspace-scoped grants (PLATFORM_ADMIN role passes for any
    # permission, mirroring has_permission's :125/:130 semantics).
    stmt = (
        select(col(UserWorkspaceRole.user_id))
        .join(Role, col(Role.id) == col(UserWorkspaceRole.role_id))
        .join(RolePermission, col(RolePermission.role_id) == col(Role.id))
        .join(User, col(User.id) == col(UserWorkspaceRole.user_id))
        .where(col(UserWorkspaceRole.workspace_id) == workspace_id)
        .where(col(User.status) == "active")
        .where(col(RolePermission.permission).in_([target, admin_perm]))
        .distinct()
    )
    user_ids = set((await session.execute(stmt)).scalars().all())

    # Segment 2: platform-level grants via the admin module's UserRole.
    # 2026-09-20-workspace-member-visibility: only PLATFORM_ADMIN matches —
    # platform-level holders of the business permission itself (non-members)
    # no longer receive workspace broadcasts, mirroring has_permission's
    # tightened workspace segment (task-01).
    try:
        from app.modules.admin.model import UserRole
    except ImportError:
        pass  # admin not bootstrapped — empty segment (rbac.py:79 precedent)
    else:
        stmt = (
            select(col(UserRole.user_id))
            .join(Role, col(Role.id) == col(UserRole.role_id))
            .join(RolePermission, col(RolePermission.role_id) == col(Role.id))
            .join(User, col(User.id) == col(UserRole.user_id))
            .where(col(User.status) == "active")
            .where(col(RolePermission.permission).in_([admin_perm]))
            .distinct()
        )
        user_ids.update((await session.execute(stmt)).scalars().all())

    # Segment 3: platform admin flag.
    stmt = select(col(User.id)).where(
        col(User.is_platform_admin) == True,  # noqa: E712 — SQL boolean
        col(User.status) == "active",
    )
    user_ids.update((await session.execute(stmt)).scalars().all())

    return list(user_ids)


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
