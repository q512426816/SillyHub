"""用户自助头像端点测试（PATCH /api/auth/me/avatar）。

覆盖 change ``2026-09-10-account-avatar-upload`` task-03 四态 + 边界/辅助断言：
- 设置：值 → 200，响应与 users.avatar 列同值
- 清除：'' → 200，列置 NULL（永不存空串，审查 C-08，区别于群成员 PATCH 存 ''）
- 未带 token → 401
- 513 字符 → 422；恰好 512（列宽上限）→ 200 落库
- avatar 缺省（None）→ 不改库值
- GET /api/auth/me 带出 avatar（UserRead.from_attributes）
"""

from __future__ import annotations

import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.security import create_access_token, password_hasher
from app.modules.auth.model import User

PASSWORD = "Avatar1!"
AVATAR_URL = "/api/file/00000000-0000-0000-0000-000000000000"


@pytest.fixture
async def user_with_token(db_session):
    """建一个 active user + 其 access token（供 /me/avatar 鉴权）。"""
    settings = get_settings()
    password_hasher.configure(settings.auth_bcrypt_rounds)
    user = User(
        email="avatar@example.com",
        username="avatarer",
        password_hash=password_hasher.hash(PASSWORD),
        status="active",
        login_enabled=True,
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    token, _ = create_access_token(
        user_id=user.id,
        email=user.email,
        is_admin=False,
        settings=settings,
    )
    return user, token


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _avatar_col(db_session: AsyncSession, user_id: uuid.UUID) -> str | None:
    """直查 users.avatar 列值（选列而非实体，绕开 db_session 身份映射缓存，
    确保读到 HTTP 事务提交后的新值）。"""
    return (await db_session.execute(select(User.avatar).where(User.id == user_id))).scalar_one()


async def _set_avatar(client: AsyncClient, token: str, avatar: str | None) -> int:
    """PATCH /me/avatar 并返回状态码（测试内复用的设置/清除原语）。"""
    resp = await client.patch(
        "/api/auth/me/avatar",
        json={"avatar": avatar} if avatar is not None else {},
        headers=_auth(token),
    )
    return resp.status_code


@pytest.mark.asyncio
async def test_set_avatar(client: AsyncClient, db_session, user_with_token):
    """设置：值 → 200，响应与 users.avatar 列同值。"""
    user, token = user_with_token
    resp = await client.patch(
        "/api/auth/me/avatar",
        json={"avatar": AVATAR_URL},
        headers=_auth(token),
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["avatar"] == AVATAR_URL
    assert await _avatar_col(db_session, user.id) == AVATAR_URL


@pytest.mark.asyncio
async def test_clear_avatar_sets_null(client: AsyncClient, db_session, user_with_token):
    """清除：'' → 200，列置 NULL（不是空串，审查 C-08 语义铁律）。"""
    user, token = user_with_token
    assert await _set_avatar(client, token, AVATAR_URL) == 200
    resp = await client.patch(
        "/api/auth/me/avatar",
        json={"avatar": ""},
        headers=_auth(token),
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["avatar"] is None
    # 列必须为 NULL：`is None` 同时排除了存空串 '' 的错误实现
    assert await _avatar_col(db_session, user.id) is None


@pytest.mark.asyncio
async def test_avatar_no_token(client: AsyncClient):
    """未带 token → 401。"""
    resp = await client.patch(
        "/api/auth/me/avatar",
        json={"avatar": AVATAR_URL},
    )
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_avatar_too_long_rejected(client: AsyncClient, user_with_token):
    """513 字符（超 max_length=512 / 列宽）→ 422。"""
    _user, token = user_with_token
    resp = await client.patch(
        "/api/auth/me/avatar",
        json={"avatar": "x" * 513},
        headers=_auth(token),
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_avatar_boundary_512_ok(client: AsyncClient, db_session, user_with_token):
    """边界：恰好 512 字符（列宽上限）→ 200 落库。"""
    user, token = user_with_token
    url = "y" * 512
    resp = await client.patch(
        "/api/auth/me/avatar",
        json={"avatar": url},
        headers=_auth(token),
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["avatar"] == url
    assert await _avatar_col(db_session, user.id) == url


@pytest.mark.asyncio
async def test_avatar_missing_keeps_value(client: AsyncClient, db_session, user_with_token):
    """avatar 缺省（None）→ 不改库值（响应仍带当前值）。"""
    user, token = user_with_token
    assert await _set_avatar(client, token, AVATAR_URL) == 200
    resp = await client.patch(
        "/api/auth/me/avatar",
        json={},
        headers=_auth(token),
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["avatar"] == AVATAR_URL
    assert await _avatar_col(db_session, user.id) == AVATAR_URL


@pytest.mark.asyncio
async def test_me_returns_avatar(client: AsyncClient, user_with_token):
    """GET /api/auth/me 带出 avatar（UserRead.from_attributes）。"""
    _user, token = user_with_token
    assert await _set_avatar(client, token, AVATAR_URL) == 200
    me = await client.get("/api/auth/me", headers=_auth(token))
    assert me.status_code == 200, me.text
    assert me.json()["user"]["avatar"] == AVATAR_URL
