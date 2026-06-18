"""FastAPI dependencies that pull the current user / enforce permissions.

Routes opt into auth by calling ``Depends(get_current_user)`` directly or
``Depends(require_permission(Permission.X))``. There is *no* global middleware
that injects identity: every protected route states what it needs.

``get_current_principal`` is the dual-path dependency: it tries JWT first
(``Authorization: Bearer …``) and falls back to API key
(``X-API-Key: …``). Use it on routes that must accept long-lived daemon
credentials in addition to browser sessions.
"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import Depends, Path, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, get_settings
from app.core.db import get_session
from app.core.errors import (
    AuthTokenExpired,
    AuthTokenInvalid,
    AuthTokenMissing,
    AuthUserInactive,
    AuthUserLoginDisabled,
    PermissionDenied,
)
from app.core.security import AccessTokenError, decode_access_token
from app.modules.auth.api_key_service import ApiKeyService
from app.modules.auth.model import User
from app.modules.auth.permissions import Permission
from app.modules.auth.rbac import has_permission


def _extract_bearer(request: Request) -> str | None:
    raw = request.headers.get("authorization") or request.headers.get("Authorization")
    if raw:
        parts = raw.split()
        if len(parts) == 2 and parts[0].lower() == "bearer":
            return parts[1].strip() or None
    return request.query_params.get("token")


def _extract_api_key(request: Request) -> str | None:
    """Read the ``X-API-Key`` header (case-insensitive). Falls back to the
    ``api_key`` query param so daemon logs can stay header-free."""
    raw = request.headers.get("x-api-key") or request.headers.get("X-API-Key")
    if raw:
        return raw.strip() or None
    return request.query_params.get("api_key")


async def get_current_user(
    request: Request,
    session: Annotated[AsyncSession, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> User:
    """Required-auth dependency. Raises 401 if the request is unauthenticated."""
    token = _extract_bearer(request)
    if not token:
        raise AuthTokenMissing(
            "Bearer token is required.",
            details={"hint": "Send 'Authorization: Bearer <access_token>'."},
        )
    try:
        payload = decode_access_token(token, settings=settings)
    except AccessTokenError as exc:
        if exc.code == "token_expired":
            raise AuthTokenExpired(exc.message) from exc
        raise AuthTokenInvalid(exc.message, details={"reason": exc.code}) from exc

    user = await session.get(User, payload.sub)
    if user is None or user.deleted_at is not None or user.status != "active":
        raise AuthUserInactive("User account is no longer active.")
    if not getattr(user, "login_enabled", True):
        raise AuthUserLoginDisabled(
            "该账号的登录权限已被禁用。",
            details={"user_id": str(user.id)},
        )
    return user


async def get_optional_user(
    request: Request,
    session: Annotated[AsyncSession, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> User | None:
    """Like :func:`get_current_user` but returns ``None`` instead of 401."""
    if _extract_bearer(request) is None:
        return None
    try:
        return await get_current_user(request, session, settings)
    except (AuthTokenMissing, AuthTokenInvalid, AuthTokenExpired, AuthUserInactive):
        return None


def require_permission(permission: Permission):
    """Return a dependency that enforces ``permission`` inside ``{workspace_id}``."""

    async def _checker(
        user: Annotated[User, Depends(get_current_principal)],
        session: Annotated[AsyncSession, Depends(get_session)],
        workspace_id: Annotated[uuid.UUID, Path(...)],
    ) -> User:
        ok = await has_permission(
            session, user=user, permission=permission, workspace_id=workspace_id
        )
        if not ok:
            raise PermissionDenied(
                f"User lacks {permission.value} on this workspace.",
                details={
                    "permission": permission.value,
                    "workspace_id": str(workspace_id),
                },
            )
        return user

    return _checker


def require_permission_any(permission: Permission):
    """Enforce permission across *any* workspace (used by APIs without ws_id)."""

    async def _checker(
        user: Annotated[User, Depends(get_current_principal)],
        session: Annotated[AsyncSession, Depends(get_session)],
    ) -> User:
        ok = await has_permission(session, user=user, permission=permission, workspace_id=None)
        if not ok:
            raise PermissionDenied(
                f"User lacks {permission.value} on any workspace.",
                details={"permission": permission.value},
            )
        return user

    return _checker


async def require_platform_admin(
    user: Annotated[User, Depends(get_current_user)],
) -> User:
    """Require the current user to be a platform admin."""
    if not user.is_platform_admin:
        raise PermissionDenied(
            "Platform admin required.",
            details={"user_id": str(user.id)},
        )
    return user


async def get_current_principal(
    request: Request,
    session: Annotated[AsyncSession, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> User:
    """Dual-path required-auth dependency.

    Precedence:
    1. ``Authorization: Bearer <jwt>`` → ``get_current_user`` (identical
       behaviour to existing browser-session routes).
    2. ``X-API-Key: <plaintext>`` → :class:`ApiKeyService.authenticate`.

    Raises ``AuthTokenMissing`` if neither header is present,
    ``AuthTokenInvalid`` for any API-key failure path (unknown / revoked /
    expired / owner-disabled — the message is uniform on purpose).
    """
    if _extract_bearer(request) is not None:
        return await get_current_user(request, session, settings)

    plaintext = _extract_api_key(request)
    if not plaintext:
        raise AuthTokenMissing(
            "Bearer token or API key is required.",
            details={
                "hint": "Send 'Authorization: Bearer <access_token>' or 'X-API-Key: <api_key>'."
            },
        )

    user = await ApiKeyService(session, settings=settings).authenticate(plaintext=plaintext)
    if user is None:
        raise AuthTokenInvalid("API key is invalid, expired, or revoked.")
    return user
