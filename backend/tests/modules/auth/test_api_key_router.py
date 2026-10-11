"""Tests for ``/api/auth/api-keys`` router.

Covers admin-only access, plaintext-only-on-create, list/revoke semantics,
and 404-on-unknown-revoke.
"""

from __future__ import annotations

import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import create_access_token, password_hasher
from app.modules.auth.model import User


async def _make_user(session: AsyncSession, *, admin: bool) -> tuple[User, str]:
    from app.core.config import get_settings

    user = User(
        id=uuid.uuid4(),
        email=f"user-{uuid.uuid4().hex[:6]}@example.com",
        password_hash=password_hasher.hash("x"),
        status="active",
        is_platform_admin=admin,
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
async def test_admin_can_create_and_plaintext_returned_only_once(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    _, token = await _make_user(db_session, admin=True)
    h = {"Authorization": f"Bearer {token}"}

    resp = await client.post(
        "/api/auth/api-keys",
        headers=h,
        json={"name": "my-daemon", "expires_at": None},
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["name"] == "my-daemon"
    assert "plaintext" in body
    assert body["plaintext"].startswith("shk_live_")
    assert body["key_prefix"]
    assert body["revoked_at"] is None

    # GET must NOT include plaintext
    listing = await client.get("/api/auth/api-keys", headers=h)
    assert listing.status_code == 200
    items = listing.json()["items"]
    assert len(items) == 1
    assert items[0]["id"] == body["id"]
    assert "plaintext" not in items[0]


@pytest.mark.asyncio
async def test_non_admin_cannot_create(client: AsyncClient, db_session: AsyncSession) -> None:
    _, token = await _make_user(db_session, admin=False)
    resp = await client.post(
        "/api/auth/api-keys",
        headers={"Authorization": f"Bearer {token}"},
        json={"name": "x", "expires_at": None},
    )
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_non_admin_cannot_list(client: AsyncClient, db_session: AsyncSession) -> None:
    _, token = await _make_user(db_session, admin=False)
    resp = await client.get(
        "/api/auth/api-keys",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_create_validation_requires_name(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    _, token = await _make_user(db_session, admin=True)
    resp = await client.post(
        "/api/auth/api-keys",
        headers={"Authorization": f"Bearer {token}"},
        json={"name": "", "expires_at": None},
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_revoke_endpoint_returns_204_then_404(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    _, token = await _make_user(db_session, admin=True)
    h = {"Authorization": f"Bearer {token}"}

    created = await client.post(
        "/api/auth/api-keys",
        headers=h,
        json={"name": "k", "expires_at": None},
    )
    kid = created.json()["id"]

    revoked = await client.delete(f"/api/auth/api-keys/{kid}", headers=h)
    assert revoked.status_code == 204

    # idempotent 404 on second call
    revoked2 = await client.delete(f"/api/auth/api-keys/{kid}", headers=h)
    assert revoked2.status_code == 404


@pytest.mark.asyncio
async def test_revoke_unknown_id_returns_404(client: AsyncClient, db_session: AsyncSession) -> None:
    _, token = await _make_user(db_session, admin=True)
    resp = await client.delete(
        f"/api/auth/api-keys/{uuid.uuid4()}",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 404


# ── 2026-10-11-apikey-mcp-copy-delete：plaintext 端点 + hard 删除 ─────────


async def _create_key(client: AsyncClient, h: dict, name: str = "k") -> dict:
    resp = await client.post(
        "/api/auth/api-keys", headers=h, json={"name": name, "expires_at": None}
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _insert_legacy_key(db_session: AsyncSession, user: User) -> str:
    """模拟存量 hash-only 行：不经 service.create（无加密列）。"""
    from datetime import UTC, datetime

    from app.modules.auth.model import ApiKey

    legacy = ApiKey(
        id=uuid.uuid4(),
        user_id=user.id,
        name="legacy",
        key_prefix="shk_live_leg",
        key_hash="not-bcrypt-legacy",
        encrypted_key=None,
        expires_at=None,
        created_at=datetime.now(UTC),
        revoked_at=None,
    )
    db_session.add(legacy)
    await db_session.commit()
    return str(legacy.id)


@pytest.mark.asyncio
async def test_plaintext_endpoint_roundtrip_and_404_after_revoke(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    _, token = await _make_user(db_session, admin=True)
    h = {"Authorization": f"Bearer {token}"}
    created = await _create_key(client, h, name="copyable")

    got = await client.get(f"/api/auth/api-keys/{created['id']}/plaintext", headers=h)
    assert got.status_code == 200, got.text
    assert got.json()["plaintext"] == created["plaintext"]

    revoked = await client.delete(f"/api/auth/api-keys/{created['id']}", headers=h)
    assert revoked.status_code == 204
    gone = await client.get(f"/api/auth/api-keys/{created['id']}/plaintext", headers=h)
    assert gone.status_code == 404


@pytest.mark.asyncio
async def test_plaintext_endpoint_legacy_row_returns_409(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user, token = await _make_user(db_session, admin=True)
    h = {"Authorization": f"Bearer {token}"}
    kid = await _insert_legacy_key(db_session, user)

    resp = await client.get(f"/api/auth/api-keys/{kid}/plaintext", headers=h)
    assert resp.status_code == 409
    assert "新建" in resp.json()["message"]


@pytest.mark.asyncio
async def test_list_carries_plaintext_recoverable_flag(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user, token = await _make_user(db_session, admin=True)
    h = {"Authorization": f"Bearer {token}"}
    await _create_key(client, h, name="new")
    await _insert_legacy_key(db_session, user)

    items = (await client.get("/api/auth/api-keys", headers=h)).json()["items"]
    by_name = {it["name"]: it for it in items}
    assert by_name["new"]["plaintext_recoverable"] is True
    assert by_name["legacy"]["plaintext_recoverable"] is False


@pytest.mark.asyncio
async def test_hard_delete_revoked_row_204_and_removed(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    _, token = await _make_user(db_session, admin=True)
    h = {"Authorization": f"Bearer {token}"}
    created = await _create_key(client, h, name="doomed")

    await client.delete(f"/api/auth/api-keys/{created['id']}", headers=h)
    resp = await client.delete(f"/api/auth/api-keys/{created['id']}?hard=true", headers=h)
    assert resp.status_code == 204

    items = (await client.get("/api/auth/api-keys", headers=h)).json()["items"]
    assert all(it["id"] != created["id"] for it in items)


@pytest.mark.asyncio
async def test_hard_delete_active_row_returns_409(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    _, token = await _make_user(db_session, admin=True)
    h = {"Authorization": f"Bearer {token}"}
    created = await _create_key(client, h, name="alive")

    resp = await client.delete(f"/api/auth/api-keys/{created['id']}?hard=true", headers=h)
    assert resp.status_code == 409
    assert "吊销" in resp.json()["message"]

    items = (await client.get("/api/auth/api-keys", headers=h)).json()["items"]
    mine = next(it for it in items if it["id"] == created["id"])
    assert mine["revoked_at"] is None  # 原吊销语义不受影响


@pytest.mark.asyncio
async def test_hard_delete_unknown_id_returns_404(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    _, token = await _make_user(db_session, admin=True)
    resp = await client.delete(
        f"/api/auth/api-keys/{uuid.uuid4()}?hard=true",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 404
