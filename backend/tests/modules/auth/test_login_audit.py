"""登录三分支手工审计测试。

覆盖 change ``2026-08-14-audit-system-completion`` task-03 AC-01~04:
- 成功登录 → 1 条 AuditLog（action=auth.login.success / resource_id=真实 id）
- 密码错 → 1 条（占位 id + reason=invalid_credentials），AuthInvalidCredentials 照常抛
- 禁登 → 1 条（reason=login_disabled）
- 审计写失败（mock commit 抛错）→ 原登录错误仍正常抛出（R-03）
"""

from __future__ import annotations

import json
from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.core.config import get_settings
from app.core.errors import AuthInvalidCredentials
from app.core.security import password_hasher
from app.modules.auth.model import User
from app.modules.auth.service import AuthService
from app.modules.workflow.model import (
    AUDIT_PLACEHOLDER_ID,
    AUTH_LOGIN_FAILED,
    AUTH_LOGIN_SUCCESS,
    AuditLog,
)

PASSWORD = "Xx1!abcd"


@pytest.fixture
async def audit_user(db_session):
    """建一个已知密码的 active user（bcrypt rounds 已由 AuthService 构造时 configure）。"""
    settings = get_settings()
    password_hasher.configure(settings.auth_bcrypt_rounds)
    user = User(
        email="auditlogin@example.com",
        username="auditlogin",
        password_hash=password_hasher.hash(PASSWORD),
        status="active",
        login_enabled=True,
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return user


async def _fetch_audit(db_session, *actions: str) -> list[AuditLog]:
    return list(
        (await db_session.execute(select(AuditLog).where(AuditLog.action.in_(actions))))
        .scalars()
        .all()
    )


@pytest.mark.asyncio
async def test_login_success_audit(client: AsyncClient, db_session, audit_user):
    """AC-01：成功登录 → 恰 1 条 auth.login.success，actor/resource_id=真实 id。"""
    resp = await client.post(
        "/api/auth/login",
        json={"account": "AuditLogin", "password": PASSWORD},  # 大小写归一后仍审计 normalized
        headers={"User-Agent": "pytest-agent", "X-Forwarded-For": "203.0.113.9"},
    )
    assert resp.status_code == 200, resp.text

    rows = await _fetch_audit(db_session, AUTH_LOGIN_SUCCESS)
    assert len(rows) == 1
    audit = rows[0]
    assert audit.actor_id == audit_user.id
    assert audit.resource_type == "user"
    assert audit.resource_id == audit_user.id
    assert audit.workspace_id is None
    details = json.loads(audit.details_json or "{}")
    assert details["account"] == "auditlogin"  # strip+lower 归一值
    assert details["user_agent"] == "pytest-agent"


@pytest.mark.asyncio
async def test_login_wrong_password_audit(client: AsyncClient, db_session, audit_user):
    """AC-02：密码错 → 401 照常 + 恰 1 条占位 id / reason=invalid_credentials 审计。"""
    resp = await client.post(
        "/api/auth/login",
        json={"account": "auditlogin", "password": "wrong-pass"},
    )
    assert resp.status_code == 401
    assert "AUTH_INVALID_CREDENTIALS" in resp.json()["code"]

    rows = await _fetch_audit(db_session, AUTH_LOGIN_FAILED)
    assert len(rows) == 1
    audit = rows[0]
    assert audit.actor_id is None
    assert audit.resource_id == AUDIT_PLACEHOLDER_ID
    details = json.loads(audit.details_json or "{}")
    assert details["account"] == "auditlogin"
    assert details["reason"] == "invalid_credentials"


@pytest.mark.asyncio
async def test_login_disabled_audit(client: AsyncClient, db_session, audit_user):
    """AC-03：禁登 → 401 AUTH_USER_LOGIN_DISABLED + 1 条 reason=login_disabled 审计。"""
    audit_user.login_enabled = False
    db_session.add(audit_user)
    await db_session.commit()

    resp = await client.post(
        "/api/auth/login",
        json={"account": "auditlogin", "password": PASSWORD},
    )
    assert resp.status_code == 401
    assert resp.json()["code"].endswith("AUTH_USER_LOGIN_DISABLED")

    rows = await _fetch_audit(db_session, AUTH_LOGIN_FAILED)
    assert len(rows) == 1
    audit = rows[0]
    # 禁登分支 user 已解析 → actor_id 为真实 id（task-03 实现要点 3）
    assert audit.actor_id == audit_user.id
    assert audit.resource_id == AUDIT_PLACEHOLDER_ID
    details = json.loads(audit.details_json or "{}")
    assert details["reason"] == "login_disabled"


class _CommitFailsDB:
    """add 收集对象、commit 固定抛错的假 session（R-03 实证用）。"""

    def __init__(self) -> None:
        self.added: list[Any] = []

    def add(self, obj: Any) -> None:
        self.added.append(obj)

    async def commit(self) -> None:
        raise RuntimeError("simulated audit commit failure")


@pytest.mark.asyncio
async def test_login_audit_write_failure_does_not_mask_error(monkeypatch):
    """AC-04：审计 commit 抛错被吞掉，原 AuthInvalidCredentials 照常抛出（R-03）。"""
    settings = get_settings()
    password_hasher.configure(settings.auth_bcrypt_rounds)
    user = User(
        email="mockdb@example.com",
        username="mockdb",
        password_hash=password_hasher.hash(PASSWORD),
        status="active",
        login_enabled=True,
    )

    async def _fake_lookup(self: AuthService, username: str) -> User | None:
        assert username == "mockdb"
        return user

    monkeypatch.setattr(AuthService, "_lookup_active_user_by_username", _fake_lookup)

    service = AuthService(_CommitFailsDB(), settings=settings)  # type: ignore[arg-type]
    with pytest.raises(AuthInvalidCredentials):
        await service.login(account="mockdb", password="wrong", user_agent=None, ip=None)

    # 审计对象已 add（仅 commit 失败），action 正确
    audit_rows = [o for o in service._db.added if isinstance(o, AuditLog)]
    assert len(audit_rows) == 1
    assert audit_rows[0].action == AUTH_LOGIN_FAILED
