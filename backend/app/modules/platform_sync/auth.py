"""platform sync 端点鉴权依赖。

``Authorization: Bearer <token>`` 双路径：
- ``shk_live_`` 前缀 → :class:`ApiKeyService.authenticate`（长生命周期 API Key）
- 否则 → :func:`get_current_user`（JWT，浏览器 session）

**不做 workspace 权限检查**（平台级聚合无 workspace 语义，design D-002）。

与 :func:`get_current_principal` 的区别：本依赖**接受 Bearer=APIKey**（principal
只接受 ``X-API-Key=APIKey``，Bearer 一律走 JWT）——SillySpec 客户端固化为
``Authorization: Bearer``（``sync.js:296``），故后端必须接受该形态（Grill B-004）。
"""

from __future__ import annotations

from typing import Annotated

from fastapi import Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_deps import _extract_bearer, get_current_user
from app.core.config import Settings, get_settings
from app.core.db import get_session
from app.core.errors import AuthTokenInvalid, AuthTokenMissing
from app.modules.auth.api_key_service import API_KEY_PREFIX, ApiKeyService
from app.modules.auth.model import User


async def require_platform_sync(
    request: Request,
    session: Annotated[AsyncSession, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> User:
    """Platform-sync 端点鉴权门控（Bearer=APIKey 优先 / JWT 回退）。

    - 无 token → :class:`AuthTokenMissing`（401）
    - ``shk_live_`` 前缀 → :meth:`ApiKeyService.authenticate`；None（未知/吊销/
      过期/owner 失效）→ :class:`AuthTokenInvalid`（401）
    - 否则 → :func:`get_current_user`（JWT 解码，失败自动 raise AuthToken* 401）

    返回 ``User``；router 不一定消费返回值，鉴权副作用即门控。
    不调 ``has_permission``、不查 workspace（平台级聚合，D-002）。
    """
    token = _extract_bearer(request)
    if not token:
        raise AuthTokenMissing(
            "Bearer token is required.",
            details={"hint": "Send 'Authorization: Bearer <api_key_or_access_token>'."},
        )
    # 显式前缀分流：避免把 JWT 误送进 ApiKeyService 的 O(n) bcrypt 扫库
    # （ApiKeyService.authenticate 内部 line 206 也有 startswith 兜底，但此处先判更省）。
    if token.startswith(API_KEY_PREFIX):
        user = await ApiKeyService(session, settings=settings).authenticate(plaintext=token)
        if user is None:
            raise AuthTokenInvalid("API key is invalid, expired, or revoked.")
        return user
    return await get_current_user(request, session, settings)
