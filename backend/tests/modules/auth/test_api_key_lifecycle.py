"""End-to-end API Key lifecycle test.

Issue → daemon hits /api/daemon/register with X-API-Key → revoke → next call 401.
"""

from __future__ import annotations

import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import password_hasher
from app.modules.auth.model import User


async def _make_admin_with_key(
    session: AsyncSession,
) -> tuple[User, str, str]:
    from app.core.config import get_settings
    from app.core.security import create_access_token
    from app.modules.auth.api_key_service import ApiKeyService

    user = User(
        id=uuid.uuid4(),
        email=f"admin-{uuid.uuid4().hex[:6]}@example.com",
        password_hash=password_hasher.hash("x"),
        status="active",
        is_platform_admin=True,
    )
    session.add(user)
    await session.commit()
    await session.refresh(user)

    settings = get_settings()
    token, _ = create_access_token(
        user_id=user.id,
        email=user.email,
        is_admin=user.is_platform_admin,
        settings=settings,
    )
    _, plaintext = await ApiKeyService(session, settings=settings).create(
        user_id=user.id, name="daemon", expires_at=None
    )
    return user, token, plaintext


@pytest.mark.asyncio
async def test_api_key_end_to_end_lifecycle(client: AsyncClient, db_session: AsyncSession) -> None:
    _, admin_token, plaintext = await _make_admin_with_key(db_session)
    admin_h = {"Authorization": f"Bearer {admin_token}"}
    key_h = {"X-API-Key": plaintext}

    # 1. Daemon registers with API key
    # daemon-entity-binding D-006：register body 从 {name, provider} 改为
    # per-daemon 上报（daemon_local_id + 机器级字段 + providers[]）。
    register_resp = await client.post(
        "/api/daemon/register",
        headers=key_h,
        json={
            "daemon_local_id": str(uuid.uuid4()),
            "server_url": "http://test.local",
            "hostname": "test-host",
            "providers": [{"provider": "claude"}],
        },
    )
    assert register_resp.status_code == 201, register_resp.text
    runtime_id = register_resp.json()["runtimes"][0]["runtime_id"]

    # 2. Daemon lists its runtimes with API key
    list_resp = await client.get("/api/daemon/runtimes", headers=key_h)
    assert list_resp.status_code == 200
    assert any(r["id"] == runtime_id for r in list_resp.json())

    # 3. Admin revokes the key
    keys = await client.get("/api/auth/api-keys", headers=admin_h)
    key_id = keys.json()["items"][0]["id"]
    revoke_resp = await client.delete(f"/api/auth/api-keys/{key_id}", headers=admin_h)
    assert revoke_resp.status_code == 204

    # 4. Daemon's next call is now 401
    after_resp = await client.get("/api/daemon/runtimes", headers=key_h)
    assert after_resp.status_code == 401
    assert after_resp.json()["code"] == "HTTP_401_AUTH_TOKEN_INVALID"


@pytest.mark.asyncio
async def test_daemon_still_works_with_bearer_token(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """Regression: existing --token daemon flow must keep working unchanged."""
    _, admin_token, _ = await _make_admin_with_key(db_session)
    h = {"Authorization": f"Bearer {admin_token}"}

    resp = await client.post(
        "/api/daemon/register",
        headers=h,
        json={
            "daemon_local_id": str(uuid.uuid4()),
            "server_url": "http://test.local",
            "hostname": "bearer-host",
            "providers": [{"provider": "claude"}],
        },
    )
    assert resp.status_code == 201
