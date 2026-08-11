"""platform sync 端点鉴权依赖。

``Authorization: Bearer <token>`` 三路径分流，返回 ``(User, workspace_id|None)``：

- ``shpsync_`` 前缀 → :meth:`PlatformSyncTokenService.authenticate`（workspace 级同步
  token）；成功派生 ``(user=created_by, workspace_id=token 绑定工作区)``，未知/吊销
  → :class:`AuthTokenInvalid`（401）。
- ``shk_live_`` 前缀 → :meth:`ApiKeyService.authenticate`（长生命周期 API Key，过渡期
  保留）；返回 ``(user, None)``（R-02 过渡期 workspace_id=None，投影 join 不命中走 fallback）。
- 否则 → :func:`get_current_user`（JWT，浏览器 session）；返回 ``(user, None)``。

workspace_id 只取自 ``platform_sync_tokens.workspace_id``（token 派生唯一通道），绝不
从 body/header 取（G6）。

> ⚠️ **命名空间注脚**：本模块旧 docstring 引用的 ``D-002`` 是**另一变更**
> sillyhub-platform-sync 的决策（平台级聚合无 workspace 语义）；本变更
> 2026-08-11-change-progress-projection 的 ``D-001@v1`` 指 workspace 归属由 token 派生。
> 两者同名不同义，勿混（design §1.2）。

与 :func:`get_current_principal` 的区别：本依赖**接受 Bearer=APIKey/sync-token**（principal
只接受 ``X-API-Key=APIKey``，Bearer 一律走 JWT）——SillySpec 客户端固化为
``Authorization: Bearer``（``sync.js:296``），故后端必须接受该形态（Grill B-004）。
"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_deps import _extract_bearer, get_current_user
from app.core.config import Settings, get_settings
from app.core.db import get_session
from app.core.errors import AuthTokenInvalid, AuthTokenMissing
from app.modules.auth.api_key_service import API_KEY_PREFIX, ApiKeyService
from app.modules.auth.model import User
from app.modules.platform_sync.token_service import (
    PLATFORM_SYNC_TOKEN_PREFIX,
    PlatformSyncTokenService,
)


async def require_platform_sync(
    request: Request,
    session: Annotated[AsyncSession, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> tuple[User, uuid.UUID | None]:
    """Platform-sync 端点鉴权门控 + workspace 派生（Bearer 三路分流）。

    - 无 token → :class:`AuthTokenMissing`（401）
    - ``shpsync_`` 前缀 → :meth:`PlatformSyncTokenService.authenticate`；None（未知/吊销
      /owner 失效）→ :class:`AuthTokenInvalid`（401）；成功 → ``(created_by 用户,
      token 绑定 workspace_id)``
    - ``shk_live_`` 前缀 → :meth:`ApiKeyService.authenticate`；None →
      :class:`AuthTokenInvalid`（401）；成功 → ``(user, None)``（过渡期，R-02）
    - 否则 → :func:`get_current_user`（JWT 解码，失败自动 raise AuthToken* 401）→ ``(user, None)``

    workspace_id 非空时由 router 注入 service 做收件箱隔离（task-06/07）；为 None（shk_live_/
    JWT 过渡期）时 service 走全局聚合 fallback，不阻断。
    """
    token = _extract_bearer(request)
    if not token:
        raise AuthTokenMissing(
            "Bearer token is required.",
            details={"hint": "Send 'Authorization: Bearer <api_key_or_access_token>'."},
        )
    # shpsync_ 优先分流：workspace-scoped 同步 token，派生 (user, workspace_id)。
    if token.startswith(PLATFORM_SYNC_TOKEN_PREFIX):
        principal = await PlatformSyncTokenService(session, settings=settings).authenticate(
            plaintext=token
        )
        if principal is None:
            raise AuthTokenInvalid("Platform sync token is invalid or revoked.")
        return principal.user, principal.workspace_id
    # 显式 shk_live_ 前缀分流：避免把 JWT 误送进 ApiKeyService 的 O(n) bcrypt 扫库
    # （ApiKeyService.authenticate 内部 line 206 也有 startswith 兜底，但此处先判更省）。
    if token.startswith(API_KEY_PREFIX):
        user = await ApiKeyService(session, settings=settings).authenticate(plaintext=token)
        if user is None:
            raise AuthTokenInvalid("API key is invalid, expired, or revoked.")
        return user, None
    user = await get_current_user(request, session, settings)
    return user, None
