"""platform sync 端点鉴权依赖。

``Authorization: Bearer <token>`` 三路径分流：

- ``shpsync_`` 前缀 → :meth:`PlatformSyncTokenService.authenticate`（workspace 级同步
  token）；成功派生 ``(user=created_by, workspace_id=token 绑定工作区)``，未知/吊销
  → :class:`AuthTokenInvalid`（401）。**写端点唯一可写通道**（D-004@v1，逐字不动）。
- ``shk_live_`` 前缀 → :meth:`ApiKeyService.authenticate`（长生命周期 API Key，过渡期
  保留）；返回读并集 scope（R-02 过渡期 workspace_id=None 全局聚合，security-audit
  -remediation task-06 起收紧为 CHANGE_READ 并集 + NULL 桶）。
- 否则 → :func:`get_current_user`（JWT，浏览器 session）；返回读并集 scope。

workspace_id 只取自 ``platform_sync_tokens.workspace_id``（token 派生唯一通道），绝不
从 body/header 取（G6 / D-004@v1——写端点路径与 body 均无 workspace_id，不从 body 补）。

> ⚠️ **命名空间注脚**：本模块旧 docstring 引用的 ``D-002`` 是**另一变更**
> sillyhub-platform-sync 的决策（平台级聚合无 workspace 语义）；本变更
> 2026-08-11-change-progress-projection 的 ``D-001@v1`` 指 workspace 归属由 token 派生。
> 两者同名不同义，勿混（design §1.2）。

与 :func:`get_current_principal` 的区别：本依赖**接受 Bearer=APIKey/sync-token**（principal
只接受 ``X-API-Key=APIKey``，Bearer 一律走 JWT）——SillySpec 客户端固化为
``Authorization: Bearer``（``sync.js:296``），故后端必须接受该形态（Grill B-004）。

security-audit-remediation task-06（D-004@v1）：三 POST 端点（progress/documents/
approval）改用 :func:`require_platform_sync_write`——``shk_live_``/JWT 凭据**有效也
403**（:class:`PermissionDenied`，写通道仅 shpsync_ 开放）；读端点用
:func:`require_platform_sync` 返回 ``(user, PlatformSyncAuthScope)``，shk_live_/JWT
分支从全局桶改为 ``allowed_workspace_ids(user, CHANGE_READ)`` 并集聚合（platform_admin
= 全 workspace 并集），NULL 桶存量行走并集聚合只读保留（兼容策略）。
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from typing import Annotated

from fastapi import Depends, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import col

from app.core.auth_deps import _extract_bearer, get_current_user
from app.core.config import Settings, get_settings
from app.core.db import get_session
from app.core.errors import AuthTokenInvalid, AuthTokenMissing, PermissionDenied
from app.modules.auth.api_key_service import API_KEY_PREFIX, ApiKeyService
from app.modules.auth.model import User
from app.modules.auth.permissions import Permission
from app.modules.auth.rbac import allowed_workspace_ids
from app.modules.platform_sync.token_service import (
    PLATFORM_SYNC_TOKEN_PREFIX,
    PlatformSyncTokenService,
)
from app.modules.workspace.model import Workspace


@dataclass(frozen=True, slots=True)
class PlatformSyncAuthScope:
    """读端点 workspace 聚合 scope。

    task-06 前读路径只有两种形态：shpsync_ 单 workspace / None 全局桶。收紧后
    ``shk_live_``/JWT 读路径是「有 CHANGE_READ 权限的 workspace 集合 + NULL 桶」，
    ``workspace_id: UUID | None`` 表达不了「多 workspace 并集」，用 scope 承载：

    - ``workspace_id is not None``（shpsync_）：收件箱隔离单 workspace（原语义不变），
      此时 ``allowed_workspace_ids_`` 为空（router 只读 workspace_id）。
    - ``workspace_id is None`` 且 ``allowed_workspace_ids_`` 为空集（写端点唯一入参
      形态，或占位）：不表示全局——读端点在该形态下退化为仅 NULL 桶（不再全局）。
      注意：全局聚合语义已在本变更**移除**（旧 ``workspace_id=None`` 全局读改并集）。

    命名带尾下划线避免与 ``auth/rbac.allowed_workspace_ids`` 函数重名混淆。
    """

    workspace_id: uuid.UUID | None = None
    allowed_workspace_ids_: frozenset[uuid.UUID] = field(default_factory=frozenset)


_WRITE_FORBIDDEN_MESSAGE = (
    "Platform-sync write endpoints only accept shpsync_ workspace sync tokens; "
    "JWT/API-key write path is closed."
)


async def _union_read_scope(session: AsyncSession, user: User) -> PlatformSyncAuthScope:
    """shk_live_/JWT 读路径：CHANGE_READ workspace 并集（platform_admin = 全 workspace）。

    - ``is_platform_admin`` → 全 workspace id（与 RBAC「平台管理员豁免」口径一致，
      admin 没有 user_workspace_roles 行也能看全部）。
    - NULL 桶存量行由 service 层并入（不在此处展开）。
    """
    if user.is_platform_admin:
        rows = (await session.execute(select(col(Workspace.id)))).scalars().all()
        return PlatformSyncAuthScope(allowed_workspace_ids_=frozenset(rows))
    allowed = await allowed_workspace_ids(
        session, user_id=user.id, permission=Permission.CHANGE_READ
    )
    return PlatformSyncAuthScope(allowed_workspace_ids_=frozenset(allowed))


async def _authenticate_platform_sync(
    request: Request,
    session: AsyncSession,
    settings: Settings,
    *,
    write: bool,
) -> tuple[User, PlatformSyncAuthScope]:
    """三路径分流共用实现（read / write 两个依赖仅 ``write`` 语义不同）。

    - 无 token → :class:`AuthTokenMissing`（401）
    - ``shpsync_`` 前缀 → :meth:`PlatformSyncTokenService.authenticate`；None（未知/吊销
      /owner 失效）→ :class:`AuthTokenInvalid`（401）；成功 → ``(created_by 用户,
      token 绑定 workspace_id)``（write=True/False 均放行——唯一写通道，CLI 契约）
    - ``shk_live_`` 前缀 → :meth:`ApiKeyService.authenticate`；None →
      :class:`AuthTokenInvalid`（401）；成功且 ``write`` → :class:`PermissionDenied`
      （403，凭据有效但写通道关闭）；读 → CHANGE_READ 并集 scope
    - 否则 → :func:`get_current_user`（JWT 解码，失败自动 raise AuthToken* 401）；
      ``write`` 时同样 403；读 → CHANGE_READ 并集 scope

    401/403 边界（constraints）：401 = 无凭据或凭据无效；403 = 凭据有效但写通道关闭。
    """
    token = _extract_bearer(request)
    if not token:
        raise AuthTokenMissing(
            "Bearer token is required.",
            details={"hint": "Send 'Authorization: Bearer <api_key_or_access_token>'."},
        )
    # shpsync_ 优先分流：workspace-scoped 同步 token，派生 (user, workspace_id)。
    # 逐字不动（task-06 constraints：CLI sync.js 固化 Bearer shpsync_）。
    if token.startswith(PLATFORM_SYNC_TOKEN_PREFIX):
        principal = await PlatformSyncTokenService(session, settings=settings).authenticate(
            plaintext=token
        )
        if principal is None:
            raise AuthTokenInvalid("Platform sync token is invalid or revoked.")
        return principal.user, PlatformSyncAuthScope(workspace_id=principal.workspace_id)
    # 显式 shk_live_ 前缀分流：避免把 JWT 误送进 ApiKeyService 的 O(n) bcrypt 扫库
    # （ApiKeyService.authenticate 内部 line 206 也有 startswith 兜底，但此处先判更省）。
    if token.startswith(API_KEY_PREFIX):
        user = await ApiKeyService(session, settings=settings).authenticate(plaintext=token)
        if user is None:
            raise AuthTokenInvalid("API key is invalid, expired, or revoked.")
        if write:
            raise PermissionDenied(_WRITE_FORBIDDEN_MESSAGE)
        return user, await _union_read_scope(session, user)
    user = await get_current_user(request, session, settings)
    if write:
        raise PermissionDenied(_WRITE_FORBIDDEN_MESSAGE)
    return user, await _union_read_scope(session, user)


async def require_platform_sync(
    request: Request,
    session: Annotated[AsyncSession, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> tuple[User, PlatformSyncAuthScope]:
    """读端点鉴权门控（Bearer 三路分流 → 读 scope）。

    shpsync_ → ``(user, token 绑定 workspace_id)`` 收件箱隔离；shk_live_/JWT →
    ``(user, CHANGE_READ workspace 并集 + NULL 桶)``，不再全局聚合（D-004@v1）。
    """
    return await _authenticate_platform_sync(request, session, settings, write=False)


async def require_platform_sync_write(
    request: Request,
    session: Annotated[AsyncSession, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> tuple[User, PlatformSyncAuthScope]:
    """写端点鉴权门控（progress/documents/approval 三个 POST）。

    仅 shpsync_ token 可写（token 派生 workspace_id 是唯一写归属通道）；
    shk_live_/JWT 凭据有效 → :class:`PermissionDenied`（403）。
    """
    return await _authenticate_platform_sync(request, session, settings, write=True)
