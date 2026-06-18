"""``/api/auth`` HTTP shell over :class:`AuthService`."""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Path, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_deps import get_current_user, require_permission_any
from app.core.config import Settings, get_settings
from app.core.db import get_session
from app.core.errors import ApiKeyNotFound
from app.modules.auth.api_key_schema import (
    ApiKeyCreated,
    ApiKeyCreateRequest,
    ApiKeyListResponse,
    ApiKeyRead,
)
from app.modules.auth.api_key_service import ApiKeyService
from app.modules.auth.model import User
from app.modules.auth.permissions import Permission
from app.modules.auth.rbac import collect_permissions_everywhere, list_user_workspace_roles
from app.modules.auth.schema import (
    LoginRequest,
    MeResponse,
    RefreshRequest,
    TokenPair,
    UserRead,
    WorkspaceRoleAssignment,
)
from app.modules.auth.service import AuthService

router = APIRouter(prefix="/auth", tags=["auth"])

SessionDep = Annotated[AsyncSession, Depends(get_session)]
SettingsDep = Annotated[Settings, Depends(get_settings)]


def _client_metadata(request: Request) -> tuple[str | None, str | None]:
    ua = request.headers.get("user-agent")
    ip = request.client.host if request.client else None
    return ua, ip


@router.post("/login", response_model=TokenPair)
async def login(
    payload: LoginRequest,
    request: Request,
    session: SessionDep,
    settings: SettingsDep,
) -> TokenPair:
    ua, ip = _client_metadata(request)
    _, pair = await AuthService(session, settings=settings).login(
        email=payload.email, password=payload.password, user_agent=ua, ip=ip
    )
    return pair


@router.post("/refresh", response_model=TokenPair)
async def refresh(
    payload: RefreshRequest,
    request: Request,
    session: SessionDep,
    settings: SettingsDep,
) -> TokenPair:
    ua, ip = _client_metadata(request)
    _, pair = await AuthService(session, settings=settings).refresh(
        refresh_token=payload.refresh_token, user_agent=ua, ip=ip
    )
    return pair


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(
    payload: RefreshRequest,
    session: SessionDep,
    settings: SettingsDep,
    _user: Annotated[User, Depends(get_current_user)],
) -> None:
    """Revoke the current session.

    Caller must present both the bearer access token (proves it's *this* user
    asking) and the refresh token (identifies the exact session to drop).
    """
    await AuthService(session, settings=settings).logout_session_by_refresh(
        refresh_token=payload.refresh_token
    )


@router.get("/me", response_model=MeResponse)
async def me(
    session: SessionDep,
    user: Annotated[User, Depends(get_current_user)],
) -> MeResponse:
    rows = await list_user_workspace_roles(session, user_id=user.id)
    perms = await collect_permissions_everywhere(session, user_id=user.id)
    return MeResponse(
        user=UserRead.model_validate(user),
        workspaces=[
            WorkspaceRoleAssignment(workspace_id=wid, role_key=key, role_name=name)
            for wid, key, name in rows
        ],
        permissions=sorted(perms),
    )


# ── API Keys (settings:admin-only) ─────────────────────────────────────


ApiKeyAdminUser = Annotated[User, Depends(require_permission_any(Permission.API_KEY_ADMIN))]


@router.post(
    "/api-keys",
    response_model=ApiKeyCreated,
    status_code=status.HTTP_201_CREATED,
)
async def create_api_key(
    payload: ApiKeyCreateRequest,
    session: SessionDep,
    settings: SettingsDep,
    user: ApiKeyAdminUser,
) -> ApiKeyCreated:
    """Issue a new long-lived API key for the daemon.

    Plaintext is returned **only** here; subsequent GETs will only expose
    ``key_prefix``. ``api_key:admin``-gated.
    """
    row, plaintext = await ApiKeyService(session, settings=settings).create(
        user_id=user.id,
        name=payload.name,
        expires_at=payload.expires_at,
    )
    return ApiKeyCreated(
        id=row.id,
        name=row.name,
        key_prefix=row.key_prefix,
        last_used_at=row.last_used_at,
        expires_at=row.expires_at,
        created_at=row.created_at,
        revoked_at=row.revoked_at,
        plaintext=plaintext,
    )


@router.get("/api-keys", response_model=ApiKeyListResponse)
async def list_api_keys(
    session: SessionDep,
    settings: SettingsDep,
    user: ApiKeyAdminUser,
) -> ApiKeyListResponse:
    """List the caller's API keys (plaintext never included)."""
    rows = await ApiKeyService(session, settings=settings).list_for_user(user_id=user.id)
    return ApiKeyListResponse(items=[ApiKeyRead.model_validate(r) for r in rows])


@router.delete(
    "/api-keys/{api_key_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def revoke_api_key(
    api_key_id: Annotated[uuid.UUID, Path(...)],
    session: SessionDep,
    settings: SettingsDep,
    user: ApiKeyAdminUser,
) -> None:
    """Revoke an API key. Idempotent for unknown / already-revoked ids → 404."""
    updated = await ApiKeyService(session, settings=settings).revoke(
        api_key_id=api_key_id,
        user_id=user.id,
    )
    if not updated:
        raise ApiKeyNotFound("API key not found or already revoked.")
