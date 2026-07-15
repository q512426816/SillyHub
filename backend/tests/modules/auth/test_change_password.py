"""用户自助修改密码端点测试。

覆盖 change ``2026-07-15-change-password`` AC-01~07:
- 成功改密 + password_hash 更新（AC-01）
- 旧密码错 → 401 PASSWORD_INCORRECT（AC-02）
- 新密码 <8 → 422（AC-03）
- 未带 token → 401（AC-04）
- 改后旧密码登录失败 / 新密码登录成功（AC-05）
- 改密撤销该用户其他设备会话（AC-06）
- 审计记录 user.password_change（AC-07）
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest
from httpx import AsyncClient
from sqlalchemy import func, select

from app.core.config import get_settings
from app.core.security import create_access_token, password_hasher
from app.modules.auth.model import Session as AuthSession
from app.modules.auth.model import User
from app.modules.workflow.model import AuditLog

OLD_PASSWORD = "OldPass1!"
NEW_PASSWORD = "NewPass1!"


@pytest.fixture
async def user_with_token(db_session):
    """建一个已知密码的 active user + 其 access token（供 change-password 鉴权）。"""
    settings = get_settings()
    password_hasher.configure(settings.auth_bcrypt_rounds)
    user = User(
        email="changer@example.com",
        username="changer",
        password_hash=password_hasher.hash(OLD_PASSWORD),
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


@pytest.mark.asyncio
async def test_change_password_success(client: AsyncClient, user_with_token):
    """AC-01：正确旧密码 + 合法新密码 → 204，密码已更新（新密码可登录）。"""
    _user, token = user_with_token
    resp = await client.post(
        "/api/auth/change-password",
        json={"old_password": OLD_PASSWORD, "new_password": NEW_PASSWORD},
        headers=_auth(token),
    )
    assert resp.status_code == 204, resp.text
    # 密码已更新：新密码可登录（端到端验证，绕过测试 DB session 与 HTTP session 的事务隔离）
    new_login = await client.post(
        "/api/auth/login",
        json={"account": "changer", "password": NEW_PASSWORD},
    )
    assert new_login.status_code == 200


@pytest.mark.asyncio
async def test_change_password_wrong_old(client: AsyncClient, user_with_token):
    _user, token = user_with_token
    resp = await client.post(
        "/api/auth/change-password",
        json={"old_password": "WrongOld1!", "new_password": NEW_PASSWORD},
        headers=_auth(token),
    )
    assert resp.status_code == 401
    assert resp.json()["code"].endswith("PASSWORD_INCORRECT")


@pytest.mark.asyncio
async def test_change_password_short_new(client: AsyncClient, user_with_token):
    _user, token = user_with_token
    resp = await client.post(
        "/api/auth/change-password",
        json={"old_password": OLD_PASSWORD, "new_password": "short"},
        headers=_auth(token),
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_change_password_no_token(client: AsyncClient):
    resp = await client.post(
        "/api/auth/change-password",
        json={"old_password": OLD_PASSWORD, "new_password": NEW_PASSWORD},
    )
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_change_password_then_old_login_fails(client: AsyncClient, user_with_token):
    _user, token = user_with_token
    resp = await client.post(
        "/api/auth/change-password",
        json={"old_password": OLD_PASSWORD, "new_password": NEW_PASSWORD},
        headers=_auth(token),
    )
    assert resp.status_code == 204
    # 旧密码登录 → 401
    old_login = await client.post(
        "/api/auth/login",
        json={"account": "changer", "password": OLD_PASSWORD},
    )
    assert old_login.status_code == 401
    # 新密码登录 → 200
    new_login = await client.post(
        "/api/auth/login",
        json={"account": "changer", "password": NEW_PASSWORD},
    )
    assert new_login.status_code == 200


@pytest.mark.asyncio
async def test_change_password_revokes_other_sessions(
    client: AsyncClient, db_session, user_with_token
):
    user, token = user_with_token
    now = datetime.now(UTC)
    # 造两个该用户的 active session（模拟其他设备）
    db_session.add_all(
        [
            AuthSession(
                id=uuid.uuid4(),
                user_id=user.id,
                refresh_token_hash="dummy1",
                created_at=now,
                expires_at=now,
            ),
            AuthSession(
                id=uuid.uuid4(),
                user_id=user.id,
                refresh_token_hash="dummy2",
                created_at=now,
                expires_at=now,
            ),
        ]
    )
    await db_session.commit()

    resp = await client.post(
        "/api/auth/change-password",
        json={"old_password": OLD_PASSWORD, "new_password": NEW_PASSWORD},
        headers=_auth(token),
    )
    assert resp.status_code == 204
    # 两个 session 均被撤销
    revoked = (
        await db_session.execute(
            select(func.count())
            .select_from(AuthSession)
            .where(
                AuthSession.user_id == user.id,
                AuthSession.revoked_at.is_not(None),
            )
        )
    ).scalar_one()
    assert revoked == 2


@pytest.mark.asyncio
async def test_change_password_audit(client: AsyncClient, db_session, user_with_token):
    user, token = user_with_token
    resp = await client.post(
        "/api/auth/change-password",
        json={"old_password": OLD_PASSWORD, "new_password": NEW_PASSWORD},
        headers=_auth(token),
    )
    assert resp.status_code == 204
    audit = (
        (
            await db_session.execute(
                select(AuditLog).where(
                    AuditLog.actor_id == user.id,
                    AuditLog.action == "user.password_change",
                )
            )
        )
        .scalars()
        .first()
    )
    assert audit is not None
    assert audit.resource_id == user.id
