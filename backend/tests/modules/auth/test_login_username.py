"""纯 username 登录契约测试。

覆盖 change ``2026-06-24-username-login`` task-08 / SC-3 / D-001@v1:
登录只认 ``username``,email 不再作为账号识别;大小写不敏感;
失败防枚举统一 401;disabled 用户登录被拒。
"""

from __future__ import annotations

import pytest
from httpx import AsyncClient

from app.core.config import get_settings
from app.core.security import password_hasher
from app.modules.auth.model import User


@pytest.fixture
async def alice(db_session):
    """建一个 active user(bcrypt rounds 已由 AuthService 构造时 configure)。"""
    settings = get_settings()
    password_hasher.configure(settings.auth_bcrypt_rounds)
    user = User(
        email="alice@example.com",
        username="alice",
        password_hash=password_hasher.hash("Xx1!abcd"),
        status="active",
        login_enabled=True,
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return user


@pytest.mark.asyncio
async def test_login_username_only(client: AsyncClient, alice):
    """SC-3 / D-001: username 登录 → 200,返回 access/refresh token。"""
    resp = await client.post(
        "/api/auth/login",
        json={"account": "alice", "password": "Xx1!abcd"},
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert "access_token" in data
    assert "refresh_token" in data


@pytest.mark.asyncio
async def test_login_username_case_insensitive(client: AsyncClient, alice):
    """SC-3: username 大小写不敏感(service strip+lower 归一)。"""
    resp = await client.post(
        "/api/auth/login",
        json={"account": "ALICE", "password": "Xx1!abcd"},
    )
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_login_email_rejected(client: AsyncClient, alice):
    """SC-3 / D-001: email 登录失效 → 401(纯 username 查询,防枚举统一)。"""
    resp = await client.post(
        "/api/auth/login",
        json={"account": "alice@example.com", "password": "Xx1!abcd"},
    )
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_login_wrong_password_enumeration_guard(client: AsyncClient, alice):
    """SC-3: 错误密码 → 401,code 以 AUTH_ 开头(与不存在用户同形)。"""
    resp = await client.post(
        "/api/auth/login",
        json={"account": "alice", "password": "wrong"},
    )
    assert resp.status_code == 401
    assert "AUTH_INVALID_CREDENTIALS" in resp.json()["code"]


@pytest.mark.asyncio
async def test_login_unknown_user(client: AsyncClient):
    """SC-3: 不存在的账号 → 401(与错密同形)。"""
    resp = await client.post(
        "/api/auth/login",
        json={"account": "ghost", "password": "Xx1!abcd"},
    )
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_login_disabled_user_blocked(client: AsyncClient, db_session):
    """SC-3: login_enabled=False 用户 username 登录 → 401 AUTH_USER_LOGIN_DISABLED。"""
    settings = get_settings()
    password_hasher.configure(settings.auth_bcrypt_rounds)
    user = User(
        email="blocked@example.com",
        username="blocked",
        password_hash=password_hasher.hash("Xx1!abcd"),
        status="active",
        login_enabled=False,
    )
    db_session.add(user)
    await db_session.commit()

    resp = await client.post(
        "/api/auth/login",
        json={"account": "blocked", "password": "Xx1!abcd"},
    )
    assert resp.status_code == 401
    assert resp.json()["code"].endswith("AUTH_USER_LOGIN_DISABLED")
