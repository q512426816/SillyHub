"""``/api/settings`` and ``/api/users`` — platform configuration & user management.

``/api/users/*`` handlers forward to :class:`app.modules.admin.users_service.UserService`
(change ``2026-06-16-admin-org-role-center`` task-06). Signatures, response
shape, and ``require_platform_admin`` permission are preserved so existing
clients keep working.
"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_deps import get_current_user, require_permission_any, require_platform_admin
from app.core.db import get_session
from app.core.logging import get_logger
from app.modules.auth.model import User
from app.modules.auth.permissions import Permission
from app.modules.settings.model import PlatformSetting
from app.modules.settings.schema import (
    AuditLogRead,
    ResetPasswordRequest,
    ResetPasswordResponse,
    RevokeAllResponse,
    SettingRead,
    SettingsBulkRead,
    SettingsUpdateRequest,
    SettingsUpdateResponse,
    UserCreateRequest,
    UserListResponse,
    UserRead,
    UserSessionRead,
    UserUpdateRequest,
    UserWorkspaceRead,
)

log = get_logger(__name__)
router = APIRouter(tags=["settings"])

SessionDep = Annotated[AsyncSession, Depends(get_session)]
CurrentUser = Annotated[User, Depends(get_current_user)]
AdminUser = Annotated[User, Depends(require_platform_admin)]
SettingsAdminUser = Annotated[User, Depends(require_permission_any(Permission.SETTINGS_ADMIN))]


def _svc(session: AsyncSession, actor_id: uuid.UUID):
    """Lazy import to avoid the settings↔admin circular reference at module load."""
    from app.modules.admin.users_service import UserService

    return UserService(session, actor_id)


async def _enrich(session: AsyncSession, user: User) -> UserRead:
    """Reuse the admin router's relations helper without importing it eagerly."""
    from app.modules.admin.router import _user_with_relations

    return await _user_with_relations(session, user)


# ── Platform settings ──────────────────────────────────────────────────


@router.get("/settings", response_model=SettingsBulkRead)
async def list_settings(
    session: SessionDep,
    _user: SettingsAdminUser,
) -> SettingsBulkRead:
    rows = (await session.execute(select(PlatformSetting))).scalars().all()
    return SettingsBulkRead(
        settings=[SettingRead(key=r.key, value=r.value, updated_at=r.updated_at) for r in rows],
    )


@router.put("/settings", response_model=SettingsUpdateResponse)
async def update_settings(
    payload: SettingsUpdateRequest,
    session: SessionDep,
    user: SettingsAdminUser,
) -> SettingsUpdateResponse:
    from datetime import UTC, datetime

    now = datetime.now(UTC)
    updated: list[str] = []
    for key, value in payload.settings.items():
        existing = await session.get(PlatformSetting, key)
        if existing is not None:
            existing.value = value
            existing.updated_by = user.id
            existing.updated_at = now
            session.add(existing)
        else:
            session.add(
                PlatformSetting(
                    key=key,
                    value=value,
                    updated_by=user.id,
                    updated_at=now,
                )
            )
        updated.append(key)
    await session.commit()
    return SettingsUpdateResponse(updated=updated)


# ── User management — forwarded to admin.users_service ────────────────


@router.get("/users", response_model=UserListResponse)
async def list_users(
    session: SessionDep,
    user: AdminUser,
    q: str | None = Query(None),
    status_filter: str | None = Query(None, alias="status"),
    role: str | None = Query(None),
    sort: str = Query("created_at"),
    order: str = Query("desc"),
    limit: int = Query(20, ge=1, le=200),
    offset: int = Query(0, ge=0),
) -> UserListResponse:
    svc = _svc(session, user.id)
    rows, total = await svc.list_users(
        q=q,
        status=status_filter,
        role=role,
        sort=sort,
        order=order,
        limit=limit,
        offset=offset,
    )
    items = [await _enrich(session, u) for u in rows]
    return UserListResponse(items=items, total=total)


@router.post("/users", response_model=UserRead, status_code=status.HTTP_201_CREATED)
async def create_user(
    payload: UserCreateRequest,
    session: SessionDep,
    user: AdminUser,
) -> UserRead:
    svc = _svc(session, user.id)
    target = await svc.create_user(
        email=payload.email,
        password=payload.password,
        display_name=payload.display_name,
        is_platform_admin=payload.is_platform_admin,
        login_enabled=payload.login_enabled,
        organization_ids=payload.organization_ids or None,
        role_ids=payload.role_ids or None,
    )
    return await _enrich(session, target)


@router.patch("/users/{user_id}", response_model=UserRead)
async def update_user(
    user_id: str,
    payload: UserUpdateRequest,
    session: SessionDep,
    user: AdminUser,
) -> UserRead:
    svc = _svc(session, user.id)
    target = await svc.update_user(
        uuid.UUID(user_id),
        display_name=payload.display_name,
        is_platform_admin=payload.is_platform_admin,
        status=payload.status,
        login_enabled=payload.login_enabled,
        organization_ids=payload.organization_ids,
        role_ids=payload.role_ids,
    )
    return await _enrich(session, target)


@router.delete("/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_user(
    user_id: str,
    session: SessionDep,
    user: AdminUser,
) -> None:
    svc = _svc(session, user.id)
    await svc.delete_user(uuid.UUID(user_id))


# ── User detail endpoints ──────────────────────────────────────────────


@router.get("/users/{user_id}/sessions", response_model=list[UserSessionRead])
async def list_user_sessions(
    user_id: str,
    session: SessionDep,
    _user: AdminUser,
) -> list[UserSessionRead]:
    svc = _svc(session, _user.id)
    rows = await svc.list_sessions(uuid.UUID(user_id))
    return [UserSessionRead.model_validate(s) for s in rows]


@router.delete("/users/{user_id}/sessions/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_user_session(
    user_id: str,
    session_id: str,
    session: SessionDep,
    _user: AdminUser,
) -> None:
    svc = _svc(session, _user.id)
    await svc.revoke_session(uuid.UUID(user_id), uuid.UUID(session_id))


@router.post("/users/{user_id}/sessions/revoke-all", response_model=RevokeAllResponse)
async def revoke_all_user_sessions(
    user_id: str,
    session: SessionDep,
    _user: AdminUser,
) -> RevokeAllResponse:
    svc = _svc(session, _user.id)
    count = await svc.revoke_all_sessions(uuid.UUID(user_id))
    return RevokeAllResponse(revoked_count=count)


@router.get("/users/{user_id}/audit", response_model=list[AuditLogRead])
async def list_user_audit(
    user_id: str,
    session: SessionDep,
    _user: AdminUser,
) -> list[AuditLogRead]:
    svc = _svc(session, _user.id)
    rows = await svc.list_audit_logs(uuid.UUID(user_id))
    return [AuditLogRead.model_validate(a) for a in rows]


@router.get("/users/{user_id}/workspaces", response_model=list[UserWorkspaceRead])
async def list_user_workspaces(
    user_id: str,
    session: SessionDep,
    _user: AdminUser,
) -> list[UserWorkspaceRead]:
    svc = _svc(session, _user.id)
    return await svc.list_workspaces(uuid.UUID(user_id))


@router.post("/users/{user_id}/reset-password", response_model=ResetPasswordResponse)
async def reset_user_password(
    user_id: str,
    payload: ResetPasswordRequest,
    session: SessionDep,
    _user: AdminUser,
) -> ResetPasswordResponse:
    svc = _svc(session, _user.id)
    plaintext = await svc.reset_password(
        uuid.UUID(user_id),
        payload.new_password,
        force_change_on_next_login=payload.force_change_on_next_login,
    )
    return ResetPasswordResponse(plaintext_password=plaintext)
