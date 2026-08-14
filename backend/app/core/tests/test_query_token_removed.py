"""task-12（FR-10 / D-002@v1）：``?token=`` / ``?api_key=`` query 回退已删除。

query string 会被访问日志原样记录——接受 query 凭据等于把 JWT / API key
明文写进日志。本文件钉死删除行为（TDD 失败测试先行）：

- 仅带 query 凭据（无 Authorization / X-API-Key header）的请求必须 401
  （AuthTokenMissing），覆盖 ``get_current_user`` 与 ``get_current_principal``
  两条依赖路径；
- 等价 header 路径保持 200（回归护栏，证明拒绝源于 query 回退删除而非
  鉴权整体损坏）。

对齐 MCP 通道同类断言：
``app/modules/mcp_gateway/tests/test_auth.py::test_query_param_token_not_accepted``
（MCP 通道本就 header-only，本 task 不动它）。
"""

from __future__ import annotations

import uuid

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.auth.model import User


async def _seed_user(db_session: AsyncSession) -> User:
    """建一个 active 用户（随机 email 避免跨用例撞唯一键）。"""
    from app.core.config import get_settings
    from app.core.security import password_hasher

    settings = get_settings()
    password_hasher.configure(settings.auth_bcrypt_rounds)
    user = User(
        id=uuid.uuid4(),
        email=f"qt-{uuid.uuid4().hex[:8]}@example.com",
        password_hash=password_hasher.hash("QueryTokenRemoved!1"),
        display_name="Query Token Removed Test",
        status="active",
        is_platform_admin=True,
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return user


def _make_jwt(user: User) -> str:
    from app.core.config import get_settings
    from app.core.security import create_access_token

    token, _ = create_access_token(
        user_id=user.id,
        email=user.email,
        is_admin=user.is_platform_admin,
        settings=get_settings(),
    )
    return token


async def _make_api_key(db_session: AsyncSession, user: User) -> str:
    from app.core.config import get_settings
    from app.modules.auth.api_key_service import ApiKeyService

    _, plaintext = await ApiKeyService(db_session, settings=get_settings()).create(
        user_id=user.id,
        name=f"query-token-removed-{uuid.uuid4().hex[:8]}",
        expires_at=None,
    )
    return plaintext


class TestQueryTokenFallbackRemoved:
    """仅 query JWT（无 header）必须 401——get_current_user 路径。"""

    async def test_query_only_jwt_rejected(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        user = await _seed_user(db_session)
        resp = await client.get("/api/auth/me", params={"token": _make_jwt(user)})
        assert resp.status_code == 401
        assert resp.json()["code"] == "HTTP_401_AUTH_TOKEN_MISSING"

    async def test_query_only_jwt_on_principal_endpoint_rejected(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        """get_current_principal 的 bearer 分支同样只认 header。"""
        user = await _seed_user(db_session)
        resp = await client.get("/api/daemon/instances", params={"token": _make_jwt(user)})
        assert resp.status_code == 401
        assert resp.json()["code"] == "HTTP_401_AUTH_TOKEN_MISSING"

    async def test_query_only_api_key_rejected(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        """仅 query api_key（无 X-API-Key header）必须 401——principal API key 分支。"""
        user = await _seed_user(db_session)
        key = await _make_api_key(db_session, user)
        resp = await client.get("/api/daemon/instances", params={"api_key": key})
        assert resp.status_code == 401
        assert resp.json()["code"] == "HTTP_401_AUTH_TOKEN_MISSING"

    async def test_bearer_header_still_works(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        """header 回归护栏：Authorization Bearer 正常 200。"""
        user = await _seed_user(db_session)
        resp = await client.get(
            "/api/auth/me",
            headers={"Authorization": f"Bearer {_make_jwt(user)}"},
        )
        assert resp.status_code == 200

    async def test_api_key_header_still_works(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        """header 回归护栏：X-API-Key 正常 200。"""
        user = await _seed_user(db_session)
        key = await _make_api_key(db_session, user)
        resp = await client.get("/api/daemon/instances", headers={"X-API-Key": key})
        assert resp.status_code == 200
