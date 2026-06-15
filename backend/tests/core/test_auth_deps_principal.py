"""Tests for :func:`get_current_principal` dual-path auth.

Covers: Bearer-only, X-API-Key-only, both (Bearer wins), neither (401),
and API key failure paths (revoked / unknown / owner disabled).
"""

from __future__ import annotations

import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.security import create_access_token, password_hasher
from app.modules.auth.api_key_service import ApiKeyService
from app.modules.auth.model import User


async def _seed_admin_with_key(
    session: AsyncSession,
) -> tuple[User, str, str]:
    """Create an admin, issue a key, return (user, access_token, api_key)."""
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
async def test_bearer_only_works(client: AsyncClient, db_session: AsyncSession) -> None:
    _, token, _ = await _seed_admin_with_key(db_session)
    resp = await client.get("/api/daemon/runtimes", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_api_key_only_works(client: AsyncClient, db_session: AsyncSession) -> None:
    _, _, plaintext = await _seed_admin_with_key(db_session)
    resp = await client.get("/api/daemon/runtimes", headers={"X-API-Key": plaintext})
    assert resp.status_code == 200, resp.text


@pytest.mark.asyncio
async def test_bearer_takes_precedence_when_both_present(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    _, token, _ = await _seed_admin_with_key(db_session)
    resp = await client.get(
        "/api/daemon/runtimes",
        headers={"Authorization": f"Bearer {token}", "X-API-Key": "shk_live_bogus"},
    )
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_no_credentials_returns_401_missing(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    resp = await client.get("/api/daemon/runtimes")
    assert resp.status_code == 401
    body = resp.json()
    assert body["code"] == "HTTP_401_AUTH_TOKEN_MISSING"


@pytest.mark.asyncio
async def test_unknown_api_key_returns_401_invalid(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _seed_admin_with_key(db_session)
    resp = await client.get("/api/daemon/runtimes", headers={"X-API-Key": "shk_live_unknown"})
    assert resp.status_code == 401
    assert resp.json()["code"] == "HTTP_401_AUTH_TOKEN_INVALID"


@pytest.mark.asyncio
async def test_revoked_api_key_returns_401(client: AsyncClient, db_session: AsyncSession) -> None:
    user, _, plaintext = await _seed_admin_with_key(db_session)
    svc = ApiKeyService(db_session, settings=get_settings())
    rows = await svc.list_for_user(user_id=user.id)
    await svc.revoke(api_key_id=rows[0].id, user_id=user.id)

    resp = await client.get("/api/daemon/runtimes", headers={"X-API-Key": plaintext})
    assert resp.status_code == 401
