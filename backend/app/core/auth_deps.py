"""FastAPI dependencies that pull the current user / enforce permissions.

Routes opt into auth by calling ``Depends(get_current_user)`` directly or
``Depends(require_permission(Permission.X))``. There is *no* global middleware
that injects identity: every protected route states what it needs.

``get_current_principal`` is the dual-path dependency: it tries JWT first
(``Authorization: Bearer …``) and falls back to API key
(``X-API-Key: …``). Use it on routes that must accept long-lived daemon
credentials in addition to browser sessions.

task-12（FR-10 / D-002@v1）：凭据**只认 header**——历史上的
``?token=`` / ``?api_key=`` query 回退已删除：query string 会被访问日志
原样记录，接受 query 凭据等于把 JWT / API key 明文写进日志。钉死该行为的
测试见 ``app/core/tests/test_query_token_removed.py``。
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
    """Read the ``Authorization: Bearer <jwt>`` header (case-insensitive).

    task-12：header-only——``?token=`` query 回退已删除（query 进访问日志明文
    泄漏，见模块 docstring）。header 缺失即返回 None，不做任何回退。
    """
    raw = request.headers.get("authorization") or request.headers.get("Authorization")
    if raw:
        parts = raw.split()
        if len(parts) == 2 and parts[0].lower() == "bearer":
            return parts[1].strip() or None
    return None


def _extract_api_key(request: Request) -> str | None:
    """Read the ``X-API-Key`` header (case-insensitive).

    task-12：header-only——``?api_key=`` query 回退已删除（query 进访问日志
    明文泄漏，见模块 docstring）。header 缺失即返回 None，不做任何回退。
    """
    raw = request.headers.get("x-api-key") or request.headers.get("X-API-Key")
    if raw:
        return raw.strip() or None
    return None


async def get_current_user(
    request: Request,
    session: Annotated[AsyncSession, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> User:
    """Required-auth dependency. Raises 401 if the request is unauthenticated."""
    token = _extract_bearer(request)
    if not token:
        raise AuthTokenMissing(
            "登录状态已失效，请重新登录。",
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
        raise AuthUserInactive("该账号已被停用，请联系管理员。")
    if not getattr(user, "login_enabled", True):
        raise AuthUserLoginDisabled(
            "该账号的登录权限已被禁用。",
            details={"user_id": str(user.id)},
        )
    return user


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
                "无权执行此操作。",
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
                "无权执行此操作。",
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
            "该操作需要平台管理员权限，请联系管理员。",
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
            "登录状态已失效，请重新登录。",
            details={
                "hint": "Send 'Authorization: Bearer <access_token>' or 'X-API-Key: <api_key>'."
            },
        )

    user = await ApiKeyService(session, settings=settings).authenticate(plaintext=plaintext)
    if user is None:
        raise AuthTokenInvalid("API 密钥无效、已过期或已被吊销，请检查后重试。")
    return user
