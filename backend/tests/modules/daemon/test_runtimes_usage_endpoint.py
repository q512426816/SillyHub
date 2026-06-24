"""Tests for GET /api/daemon/runtimes/usage (task-10 / FR-03).

Covers: default/override window, 422 on invalid window, response structure,
empty-list, admin auth (403 non-admin / 401 unauthenticated), and the route
ordering guarantee (static /usage is not shadowed by /{runtime_id}).
"""

from __future__ import annotations

import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.security import create_access_token, password_hasher
from app.modules.auth.model import User


async def _seed_admin(session: AsyncSession) -> tuple[User, str]:
    """Create a platform admin + Bearer token (auto-grants RUNTIME_ADMIN)."""
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
    token, _ = create_access_token(
        user_id=user.id,
        email=user.email,
        is_admin=user.is_platform_admin,
        settings=get_settings(),
    )
    return user, token


async def _seed_non_admin(session: AsyncSession) -> tuple[User, str]:
    """Create a plain user with no permissions (-> 403 on RUNTIME_ADMIN)."""
    user = User(
        id=uuid.uuid4(),
        email=f"user-{uuid.uuid4().hex[:6]}@example.com",
        password_hash=password_hasher.hash("x"),
        status="active",
        is_platform_admin=False,
    )
    session.add(user)
    await session.commit()
    await session.refresh(user)
    token, _ = create_access_token(
        user_id=user.id,
        email=user.email,
        is_admin=user.is_platform_admin,
        settings=get_settings(),
    )
    return user, token


@pytest.mark.asyncio
async def test_get_runtimes_usage_default_window(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    _, token = await _seed_admin(db_session)
    resp = await client.get(
        "/api/daemon/runtimes/usage",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["window"] == "7d"
    assert isinstance(body["runtimes"], list)


@pytest.mark.asyncio
async def test_get_runtimes_usage_window_1d(client: AsyncClient, db_session: AsyncSession) -> None:
    _, token = await _seed_admin(db_session)
    resp = await client.get(
        "/api/daemon/runtimes/usage?window=1d",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["window"] == "1d"


@pytest.mark.asyncio
async def test_get_runtimes_usage_window_30d(client: AsyncClient, db_session: AsyncSession) -> None:
    _, token = await _seed_admin(db_session)
    resp = await client.get(
        "/api/daemon/runtimes/usage?window=30d",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["window"] == "30d"


@pytest.mark.asyncio
async def test_get_runtimes_usage_invalid_window_422(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    _, token = await _seed_admin(db_session)
    resp = await client.get(
        "/api/daemon/runtimes/usage?window=2d",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_get_runtimes_usage_empty_returns_empty_list(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    _, token = await _seed_admin(db_session)
    resp = await client.get(
        "/api/daemon/runtimes/usage",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["window"] == "7d"
    assert body["runtimes"] == []


@pytest.mark.asyncio
async def test_get_runtimes_usage_requires_admin_non_admin_403(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    _, token = await _seed_non_admin(db_session)
    resp = await client.get(
        "/api/daemon/runtimes/usage",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_get_runtimes_usage_unauthenticated_401(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    resp = await client.get("/api/daemon/runtimes/usage")
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_route_not_shadowed_by_runtime_id(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """Static /usage must win over /{runtime_id}; a 200, not a 422 UUID parse."""
    _, token = await _seed_admin(db_session)
    resp = await client.get(
        "/api/daemon/runtimes/usage",
        headers={"Authorization": f"Bearer {token}"},
    )
    # If shadowed, "usage" fails uuid.UUID parse -> 422. A 200 proves the static
    # route matched first (FastAPI honors declaration order).
    assert resp.status_code == 200, resp.text
