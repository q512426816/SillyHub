"""鉴权依赖的连接池安全回归（2026-08-25 SSE P0）。

背景：``get_session`` 是 yield 依赖，teardown（session.close 归还连接）要等
StreamingResponse 全部帧发送完才执行；而鉴权链里的 ``session.get(User, ...)`` /
``has_permission`` 会 autobegin 事务并 checkout 连接。不主动归还则每个 SSE 连接
在流存续期间钉死一条 PG 连接（pool 上限 50，全站请求挂起）。

修复：get_current_user / get_current_principal 在校验通过后 expunge + rollback
（分离对象保留已加载属性，避免 rollback 过期属性在 async 下触发
MissingGreenlet），require_permission(_any) 的 checker 在 has_permission 后
rollback。本文件钉死三件事：

1. 依赖返回后 ``session.in_transaction()`` 为 False（只读事务已结束、连接归还）；
2. 返回的 user 已加载属性仍可同步访问（expunge 防 MissingGreenlet）；
3. 同一 session 后续查询照常工作（SQLAlchemy 自动重新开事务，语义不变）。

夹具范式镜像 ``test_query_token_removed.py``（in-memory SQLite + 直接调依赖）。
"""

from __future__ import annotations

import uuid

from sqlalchemy.ext.asyncio import AsyncSession
from starlette.requests import Request

from app.core.auth_deps import (
    get_current_principal,
    get_current_user,
    require_permission_any,
)
from app.modules.auth.model import User
from app.modules.auth.permissions import Permission


async def _seed_user(db_session: AsyncSession, *, admin: bool = True) -> User:
    """建一个 active 用户（随机 email 避免跨用例撞唯一键）。"""
    from app.core.config import get_settings
    from app.core.security import password_hasher

    settings = get_settings()
    password_hasher.configure(settings.auth_bcrypt_rounds)
    user = User(
        id=uuid.uuid4(),
        email=f"authrelease-{uuid.uuid4().hex[:8]}@example.com",
        password_hash=password_hasher.hash("AuthRelease!1"),
        display_name="Auth Release Test",
        status="active",
        is_platform_admin=admin,
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return user


def _make_request(*, bearer: str | None = None, api_key: str | None = None) -> Request:
    """最小 starlette Request（只喂 headers，鉴权依赖只读 header）。"""
    raw_headers: list[tuple[bytes, bytes]] = []
    if bearer is not None:
        raw_headers.append((b"authorization", f"Bearer {bearer}".encode()))
    if api_key is not None:
        raw_headers.append((b"x-api-key", api_key.encode()))
    return Request(scope={"type": "http", "headers": raw_headers})


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
        name=f"auth-release-{uuid.uuid4().hex[:8]}",
        expires_at=None,
    )
    return plaintext


class TestAuthReleasesDbConnection:
    async def test_get_current_user_releases_transaction(self, db_session: AsyncSession) -> None:
        """JWT 路径：鉴权完成后 session 不在事务中（连接已归还池）。"""
        from app.core.config import get_settings

        user = await _seed_user(db_session)
        resolved = await get_current_user(
            _make_request(bearer=_make_jwt(user)), db_session, get_settings()
        )

        assert resolved.id == user.id
        assert db_session.in_transaction() is False
        # expunge 保证：分离对象的已加载属性可同步访问（不触发 MissingGreenlet）。
        assert resolved.status == "active"
        assert resolved.is_platform_admin is True

    async def test_get_current_user_session_reusable_after_release(
        self, db_session: AsyncSession
    ) -> None:
        """归还后同一 session 对象可继续查询（自动重开事务，语义不变）。"""
        from sqlalchemy import select

        from app.core.config import get_settings

        user = await _seed_user(db_session)
        await get_current_user(_make_request(bearer=_make_jwt(user)), db_session, get_settings())

        assert db_session.in_transaction() is False
        rows = (await db_session.execute(select(User.id))).scalars().all()
        assert user.id in rows

    async def test_get_current_principal_api_key_releases_transaction(
        self, db_session: AsyncSession
    ) -> None:
        """API key 路径：principal 解析完成后同样不在事务中。"""
        from app.core.config import get_settings

        user = await _seed_user(db_session)
        key = await _make_api_key(db_session, user)
        resolved = await get_current_principal(
            _make_request(api_key=key), db_session, get_settings()
        )

        assert resolved.id == user.id
        assert db_session.in_transaction() is False
        assert resolved.status == "active"

    async def test_require_permission_any_releases_transaction(
        self, db_session: AsyncSession
    ) -> None:
        """权限 checker：返回后不持有事务（鉴权链留下的只读事务被收口归还）。"""
        from sqlalchemy import select

        user = await _seed_user(db_session)
        # 镜像真实依赖链：get_current_principal 已 expunge user（detach 后
        # rollback 不会过期其属性），checker 拿到的是分离对象。
        db_session.expunge(user)
        # 模拟上游鉴权（get_current_principal）留下的开启中只读事务。
        await db_session.execute(select(User.id).where(User.id == user.id))
        assert db_session.in_transaction() is True

        checker = require_permission_any(Permission.PLATFORM_ADMIN)
        resolved = await checker(user=user, session=db_session)

        assert resolved.id == user.id
        assert db_session.in_transaction() is False
