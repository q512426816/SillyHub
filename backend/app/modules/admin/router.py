"""Admin router: ``/api/admin/{users,organizations,roles}``.

Endpoints are registered in subsequent tasks of change
``2026-06-16-admin-org-role-center``:

- task-04 → roles endpoints (7 routes under ``/admin/roles``) ✓
- task-05 → organizations endpoints (7 routes under ``/admin/organizations``)
- task-06 → users endpoints (11 + 2 routes under ``/admin/users``)
"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Path, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_deps import get_current_user, require_permission_any
from app.core.db import get_session
from app.modules.admin.model import Organization, UserOrganization, UserRole
from app.modules.admin.organizations_service import OrganizationService
from app.modules.admin.roles_service import RoleService
from app.modules.admin.schema import (
    AuditLogRead,
    OrganizationBrief,
    OrganizationCreateRequest,
    OrganizationDetail,
    OrganizationRead,
    OrganizationUpdateRequest,
    ResetPasswordRequest,
    ResetPasswordResponse,
    RevokeAllResponse,
    RoleBrief,
    RoleCreateRequest,
    RoleListResponse,
    RoleRead,
    RoleUpdateRequest,
    RoleUserListResponse,
    UserCreateRequest,
    UserListResponse,
    UserRead,
    UserSessionRead,
    UserUpdateRequest,
    UserWorkspaceRead,
)
from app.modules.admin.users_service import UserService
from app.modules.auth.model import Role, User, UserWorkspaceRole
from app.modules.auth.permissions import Permission

router = APIRouter(prefix="/admin", tags=["admin"])


# ── Roles (task-04) ──────────────────────────────────────────────────────────


@router.get(
    "/roles",
    response_model=RoleListResponse,
    dependencies=[Depends(require_permission_any(Permission.ROLE_READ))],
)
async def list_roles(
    session: Annotated[AsyncSession, Depends(get_session)],
    user: Annotated[User, Depends(get_current_user)],
    search: str = Query("", max_length=100),
    is_active: bool | None = Query(None),
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=100),
) -> RoleListResponse:
    return await RoleService(session, user.id).list(
        search=search, is_active=is_active, page=page, size=size
    )


@router.get(
    "/roles/{role_id}",
    response_model=RoleRead,
    dependencies=[Depends(require_permission_any(Permission.ROLE_READ))],
)
async def get_role(
    role_id: Annotated[uuid.UUID, Path()],
    session: Annotated[AsyncSession, Depends(get_session)],
    user: Annotated[User, Depends(get_current_user)],
) -> RoleRead:
    return await RoleService(session, user.id).get(role_id)


@router.post(
    "/roles",
    response_model=RoleRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_permission_any(Permission.ROLE_WRITE))],
)
async def create_role(
    payload: RoleCreateRequest,
    session: Annotated[AsyncSession, Depends(get_session)],
    user: Annotated[User, Depends(get_current_user)],
) -> RoleRead:
    return await RoleService(session, user.id).create(payload)


@router.patch(
    "/roles/{role_id}",
    response_model=RoleRead,
    dependencies=[Depends(require_permission_any(Permission.ROLE_WRITE))],
)
async def update_role(
    role_id: Annotated[uuid.UUID, Path()],
    payload: RoleUpdateRequest,
    session: Annotated[AsyncSession, Depends(get_session)],
    user: Annotated[User, Depends(get_current_user)],
) -> RoleRead:
    return await RoleService(session, user.id).update(role_id, payload)


@router.post(
    "/roles/{role_id}/disable",
    response_model=RoleRead,
    dependencies=[Depends(require_permission_any(Permission.ROLE_WRITE))],
)
async def disable_role(
    role_id: Annotated[uuid.UUID, Path()],
    session: Annotated[AsyncSession, Depends(get_session)],
    user: Annotated[User, Depends(get_current_user)],
) -> RoleRead:
    return await RoleService(session, user.id).disable(role_id)


@router.post(
    "/roles/{role_id}/enable",
    response_model=RoleRead,
    dependencies=[Depends(require_permission_any(Permission.ROLE_WRITE))],
)
async def enable_role(
    role_id: Annotated[uuid.UUID, Path()],
    session: Annotated[AsyncSession, Depends(get_session)],
    user: Annotated[User, Depends(get_current_user)],
) -> RoleRead:
    return await RoleService(session, user.id).enable(role_id)


@router.delete(
    "/roles/{role_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_permission_any(Permission.ROLE_WRITE))],
)
async def delete_role(
    role_id: Annotated[uuid.UUID, Path()],
    session: Annotated[AsyncSession, Depends(get_session)],
    user: Annotated[User, Depends(get_current_user)],
) -> None:
    await RoleService(session, user.id).delete(role_id)


@router.get(
    "/roles/{role_id}/users",
    response_model=RoleUserListResponse,
    dependencies=[Depends(require_permission_any(Permission.ROLE_READ))],
)
async def list_role_users(
    role_id: Annotated[uuid.UUID, Path()],
    session: Annotated[AsyncSession, Depends(get_session)],
    user: Annotated[User, Depends(get_current_user)],
) -> RoleUserListResponse:
    return await RoleService(session, user.id).list_users(role_id)


# ── Organizations (task-05) ──────────────────────────────────────────────────


@router.get(
    "/organizations",
    response_model=list[OrganizationRead],
    dependencies=[Depends(require_permission_any(Permission.ORGANIZATION_READ))],
)
async def list_organizations(
    session: Annotated[AsyncSession, Depends(get_session)],
    user: Annotated[User, Depends(get_current_user)],
    parent_id: uuid.UUID | None = Query(None),
    is_active: bool | None = Query(None),
) -> list[OrganizationRead]:
    return await OrganizationService(session, user.id).list_organizations(
        parent_id=parent_id, is_active=is_active
    )


@router.get(
    "/organizations/{org_id}",
    response_model=OrganizationDetail,
    dependencies=[Depends(require_permission_any(Permission.ORGANIZATION_READ))],
)
async def get_organization(
    org_id: Annotated[uuid.UUID, Path()],
    session: Annotated[AsyncSession, Depends(get_session)],
    user: Annotated[User, Depends(get_current_user)],
) -> OrganizationDetail:
    return await OrganizationService(session, user.id).get_organization(org_id)


@router.post(
    "/organizations",
    response_model=OrganizationRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_permission_any(Permission.ORGANIZATION_WRITE))],
)
async def create_organization(
    payload: OrganizationCreateRequest,
    session: Annotated[AsyncSession, Depends(get_session)],
    user: Annotated[User, Depends(get_current_user)],
) -> OrganizationRead:
    return await OrganizationService(session, user.id).create_organization(payload)


@router.patch(
    "/organizations/{org_id}",
    response_model=OrganizationRead,
    dependencies=[Depends(require_permission_any(Permission.ORGANIZATION_WRITE))],
)
async def update_organization(
    org_id: Annotated[uuid.UUID, Path()],
    payload: OrganizationUpdateRequest,
    session: Annotated[AsyncSession, Depends(get_session)],
    user: Annotated[User, Depends(get_current_user)],
) -> OrganizationRead:
    return await OrganizationService(session, user.id).update_organization(org_id, payload)


@router.post(
    "/organizations/{org_id}/disable",
    response_model=OrganizationRead,
    dependencies=[Depends(require_permission_any(Permission.ORGANIZATION_WRITE))],
)
async def disable_organization(
    org_id: Annotated[uuid.UUID, Path()],
    session: Annotated[AsyncSession, Depends(get_session)],
    user: Annotated[User, Depends(get_current_user)],
) -> OrganizationRead:
    return await OrganizationService(session, user.id).disable_organization(org_id)


@router.post(
    "/organizations/{org_id}/enable",
    response_model=OrganizationRead,
    dependencies=[Depends(require_permission_any(Permission.ORGANIZATION_WRITE))],
)
async def enable_organization(
    org_id: Annotated[uuid.UUID, Path()],
    session: Annotated[AsyncSession, Depends(get_session)],
    user: Annotated[User, Depends(get_current_user)],
) -> OrganizationRead:
    return await OrganizationService(session, user.id).enable_organization(org_id)


@router.delete(
    "/organizations/{org_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_permission_any(Permission.ORGANIZATION_WRITE))],
)
async def delete_organization(
    org_id: Annotated[uuid.UUID, Path()],
    session: Annotated[AsyncSession, Depends(get_session)],
    user: Annotated[User, Depends(get_current_user)],
) -> None:
    await OrganizationService(session, user.id).delete_organization(org_id)


# ── Users (task-06) ──────────────────────────────────────────────────────────


async def _user_with_relations(session: AsyncSession, user: User) -> UserRead:
    """Attach org/role briefs to a User row for the UserRead payload.

    Roles merge platform-level bindings (``user_roles``) with workspace-scoped
    bindings (``user_workspace_roles``), deduped by ``role_id`` — a user bound
    to ``workspace_owner`` in three workspaces still sees the role once in the
    admin list. Matches the dual-table read in
    :func:`app.modules.admin.roles_service.RoleService.list_users`.
    """
    org_rows = (
        (
            await session.execute(
                select(Organization)
                .join(
                    UserOrganization,
                    UserOrganization.__table__.c.organization_id == Organization.id,
                )
                .where(UserOrganization.__table__.c.user_id == user.id)
            )
        )
        .scalars()
        .all()
    )
    platform_role_rows = (
        (
            await session.execute(
                select(Role)
                .join(UserRole, UserRole.__table__.c.role_id == Role.id)
                .where(UserRole.__table__.c.user_id == user.id)
            )
        )
        .scalars()
        .all()
    )
    workspace_role_rows = (
        (
            await session.execute(
                select(Role)
                .join(UserWorkspaceRole, UserWorkspaceRole.__table__.c.role_id == Role.id)
                .where(UserWorkspaceRole.__table__.c.user_id == user.id)
            )
        )
        .scalars()
        .all()
    )

    merged: dict[uuid.UUID, Role] = {}
    for r in platform_role_rows:
        merged[r.id] = r
    for r in workspace_role_rows:
        merged.setdefault(r.id, r)

    return UserRead(
        id=user.id,
        email=user.email,
        username=user.username,
        display_name=user.display_name,
        status=user.status,
        is_platform_admin=user.is_platform_admin,
        login_enabled=user.login_enabled,
        last_login_at=user.last_login_at,
        created_at=user.created_at,
        organizations=[OrganizationBrief(id=o.id, name=o.name, code=o.code) for o in org_rows],
        roles=[RoleBrief(id=r.id, key=r.key, name=r.name) for r in merged.values()],
    )


@router.get(
    "/users",
    response_model=UserListResponse,
    dependencies=[Depends(require_permission_any(Permission.USER_READ))],
)
async def list_users(
    session: Annotated[AsyncSession, Depends(get_session)],
    user: Annotated[User, Depends(get_current_user)],
    q: str | None = Query(None),
    status_filter: str | None = Query(None, alias="status"),
    role: str | None = Query(None),
    sort: str = Query("created_at"),
    order: str = Query("desc"),
    limit: int = Query(20, ge=1, le=200),
    offset: int = Query(0, ge=0),
    organization_id: uuid.UUID | None = Query(None),
    include_children: bool = Query(True),
) -> UserListResponse:
    svc = UserService(session, user.id)
    rows, total = await svc.list_users(
        q=q,
        status=status_filter,
        role=role,
        sort=sort,
        order=order,
        limit=limit,
        offset=offset,
        organization_id=organization_id,
        include_children=include_children,
    )
    items = [await _user_with_relations(session, u) for u in rows]
    return UserListResponse(items=items, total=total)


@router.get(
    "/users/{user_id}",
    response_model=UserRead,
    dependencies=[Depends(require_permission_any(Permission.USER_READ))],
)
async def get_user(
    user_id: Annotated[uuid.UUID, Path()],
    session: Annotated[AsyncSession, Depends(get_session)],
    user: Annotated[User, Depends(get_current_user)],
) -> UserRead:
    target = await UserService(session, user.id).get_user(user_id)
    return await _user_with_relations(session, target)


@router.post(
    "/users",
    response_model=UserRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_permission_any(Permission.USER_WRITE))],
)
async def create_user(
    payload: UserCreateRequest,
    session: Annotated[AsyncSession, Depends(get_session)],
    user: Annotated[User, Depends(get_current_user)],
) -> UserRead:
    svc = UserService(session, user.id)
    target = await svc.create_user(
        email=payload.email,
        password=payload.password,
        username=payload.username,
        display_name=payload.display_name,
        is_platform_admin=payload.is_platform_admin,
        login_enabled=payload.login_enabled,
        organization_ids=payload.organization_ids or None,
        role_ids=payload.role_ids or None,
    )
    return await _user_with_relations(session, target)


@router.patch(
    "/users/{user_id}",
    response_model=UserRead,
    dependencies=[Depends(require_permission_any(Permission.USER_WRITE))],
)
async def update_user(
    user_id: Annotated[uuid.UUID, Path()],
    payload: UserUpdateRequest,
    session: Annotated[AsyncSession, Depends(get_session)],
    user: Annotated[User, Depends(get_current_user)],
) -> UserRead:
    svc = UserService(session, user.id)
    target = await svc.update_user(
        user_id,
        display_name=payload.display_name,
        is_platform_admin=payload.is_platform_admin,
        status=payload.status,
        login_enabled=payload.login_enabled,
        username=payload.username,
        email=payload.email,
        organization_ids=payload.organization_ids,
        role_ids=payload.role_ids,
    )
    return await _user_with_relations(session, target)


@router.delete(
    "/users/{user_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_permission_any(Permission.USER_WRITE))],
)
async def delete_user(
    user_id: Annotated[uuid.UUID, Path()],
    session: Annotated[AsyncSession, Depends(get_session)],
    user: Annotated[User, Depends(get_current_user)],
) -> None:
    await UserService(session, user.id).delete_user(user_id)


@router.get(
    "/users/{user_id}/sessions",
    response_model=list[UserSessionRead],
    dependencies=[Depends(require_permission_any(Permission.USER_READ))],
)
async def list_user_sessions(
    user_id: Annotated[uuid.UUID, Path()],
    session: Annotated[AsyncSession, Depends(get_session)],
    user: Annotated[User, Depends(get_current_user)],
) -> list[UserSessionRead]:
    rows = await UserService(session, user.id).list_sessions(user_id)
    return [UserSessionRead.model_validate(s) for s in rows]


@router.delete(
    "/users/{user_id}/sessions/{session_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_permission_any(Permission.USER_WRITE))],
)
async def revoke_user_session(
    user_id: Annotated[uuid.UUID, Path()],
    session_id: Annotated[uuid.UUID, Path()],
    session: Annotated[AsyncSession, Depends(get_session)],
    user: Annotated[User, Depends(get_current_user)],
) -> None:
    await UserService(session, user.id).revoke_session(user_id, session_id)


@router.post(
    "/users/{user_id}/sessions/revoke-all",
    response_model=RevokeAllResponse,
    dependencies=[Depends(require_permission_any(Permission.USER_WRITE))],
)
async def revoke_all_user_sessions(
    user_id: Annotated[uuid.UUID, Path()],
    session: Annotated[AsyncSession, Depends(get_session)],
    user: Annotated[User, Depends(get_current_user)],
) -> RevokeAllResponse:
    count = await UserService(session, user.id).revoke_all_sessions(user_id)
    return RevokeAllResponse(revoked_count=count)


@router.get(
    "/users/{user_id}/audit",
    response_model=list[AuditLogRead],
    dependencies=[Depends(require_permission_any(Permission.USER_READ))],
)
async def list_user_audit(
    user_id: Annotated[uuid.UUID, Path()],
    session: Annotated[AsyncSession, Depends(get_session)],
    user: Annotated[User, Depends(get_current_user)],
) -> list[AuditLogRead]:
    rows = await UserService(session, user.id).list_audit_logs(user_id)
    return [AuditLogRead.model_validate(a) for a in rows]


@router.get(
    "/users/{user_id}/workspaces",
    response_model=list[UserWorkspaceRead],
    dependencies=[Depends(require_permission_any(Permission.USER_READ))],
)
async def list_user_workspaces(
    user_id: Annotated[uuid.UUID, Path()],
    session: Annotated[AsyncSession, Depends(get_session)],
    user: Annotated[User, Depends(get_current_user)],
) -> list[UserWorkspaceRead]:
    return await UserService(session, user.id).list_workspaces(user_id)


@router.post(
    "/users/{user_id}/reset-password",
    response_model=ResetPasswordResponse,
    dependencies=[Depends(require_permission_any(Permission.USER_WRITE))],
)
async def reset_user_password(
    user_id: Annotated[uuid.UUID, Path()],
    payload: ResetPasswordRequest,
    session: Annotated[AsyncSession, Depends(get_session)],
    user: Annotated[User, Depends(get_current_user)],
) -> ResetPasswordResponse:
    plaintext = await UserService(session, user.id).reset_password(
        user_id,
        payload.new_password,
        force_change_on_next_login=payload.force_change_on_next_login,
    )
    return ResetPasswordResponse(plaintext_password=plaintext)


@router.post(
    "/users/{user_id}/disable-login",
    response_model=UserRead,
    dependencies=[Depends(require_permission_any(Permission.USER_LOGIN_MANAGE))],
)
async def disable_user_login(
    user_id: Annotated[uuid.UUID, Path()],
    session: Annotated[AsyncSession, Depends(get_session)],
    user: Annotated[User, Depends(get_current_user)],
) -> UserRead:
    target = await UserService(session, user.id).disable_login(user_id)
    return await _user_with_relations(session, target)


@router.post(
    "/users/{user_id}/enable-login",
    response_model=UserRead,
    dependencies=[Depends(require_permission_any(Permission.USER_LOGIN_MANAGE))],
)
async def enable_user_login(
    user_id: Annotated[uuid.UUID, Path()],
    session: Annotated[AsyncSession, Depends(get_session)],
    user: Annotated[User, Depends(get_current_user)],
) -> UserRead:
    target = await UserService(session, user.id).enable_login(user_id)
    return await _user_with_relations(session, target)


__all__ = ["router"]
