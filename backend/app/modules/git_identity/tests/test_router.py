"""HTTP-level tests for the git identity router."""

from __future__ import annotations

import json
import uuid

import pytest


async def test_list_empty(
    client, auth_headers: dict[str, str]
) -> None:
    resp = await client.get("/api/git/identities", headers=auth_headers)
    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] == 0
    assert body["items"] == []


async def test_create_identity(
    client, auth_headers: dict[str, str]
) -> None:
    resp = await client.post(
        "/api/git/identities",
        json={
            "provider": "github",
            "credential_type": "pat",
            "git_username": "testuser",
            "git_email": "test@example.com",
            "credential": "ghp_testsecret123",
            "allowed_repositories": ["org/repo-a"],
        },
        headers=auth_headers,
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["provider"] == "github"
    assert body["git_username"] == "testuser"
    assert "credential" not in body
    assert "encrypted_credential" not in body
    assert body["allowed_repositories"] == ["org/repo-a"]
    assert body["revoked_at"] is None


async def test_list_after_create(
    client, auth_headers: dict[str, str]
) -> None:
    await client.post(
        "/api/git/identities",
        json={
            "provider": "github",
            "credential_type": "pat",
            "credential": "ghp_test",
        },
        headers=auth_headers,
    )
    resp = await client.get("/api/git/identities", headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["total"] == 1


async def test_get_identity_detail(
    client, auth_headers: dict[str, str]
) -> None:
    create_resp = await client.post(
        "/api/git/identities",
        json={
            "provider": "github",
            "credential_type": "pat",
            "git_username": "detailuser",
            "credential": "ghp_detail",
        },
        headers=auth_headers,
    )
    identity_id = create_resp.json()["id"]

    resp = await client.get(
        f"/api/git/identities/{identity_id}",
        headers=auth_headers,
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["git_username"] == "detailuser"
    assert "credential" not in body
    assert "encrypted_credential" not in body


async def test_revoke_identity(
    client, auth_headers: dict[str, str]
) -> None:
    create_resp = await client.post(
        "/api/git/identities",
        json={
            "provider": "github",
            "credential_type": "pat",
            "credential": "ghp_revoke",
        },
        headers=auth_headers,
    )
    identity_id = create_resp.json()["id"]

    resp = await client.delete(
        f"/api/git/identities/{identity_id}",
        headers=auth_headers,
    )
    assert resp.status_code == 200
    assert resp.json()["revoked_at"] is not None


async def test_revoke_already_revoked(
    client, auth_headers: dict[str, str]
) -> None:
    create_resp = await client.post(
        "/api/git/identities",
        json={
            "provider": "github",
            "credential_type": "pat",
            "credential": "ghp_dblrevoke",
        },
        headers=auth_headers,
    )
    identity_id = create_resp.json()["id"]

    await client.delete(f"/api/git/identities/{identity_id}", headers=auth_headers)
    resp = await client.delete(f"/api/git/identities/{identity_id}", headers=auth_headers)
    assert resp.status_code == 400


async def test_cross_user_isolation(
    client, auth_headers: dict[str, str], db_session
) -> None:
    """User A cannot see User B's identities."""
    from app.core.security import create_access_token, password_hasher
    from app.core.config import get_settings
    from app.modules.auth.model import User

    settings = get_settings()
    user_b = User(
        id=uuid.uuid4(),
        email="other@example.com",
        password_hash=password_hasher.hash("Pass123!"),
        display_name="Other",
        status="active",
        is_platform_admin=False,
    )
    db_session.add(user_b)
    await db_session.commit()

    token_b, _ = create_access_token(
        user_id=user_b.id,
        email=user_b.email,
        is_admin=False,
        settings=settings,
    )
    headers_b = {"Authorization": f"Bearer {token_b}"}

    # User A creates identity
    await client.post(
        "/api/git/identities",
        json={"provider": "github", "credential_type": "pat", "credential": "ghp_a"},
        headers=auth_headers,
    )

    # User B sees nothing
    resp = await client.get("/api/git/identities", headers=headers_b)
    assert resp.status_code == 200
    assert resp.json()["total"] == 0


async def test_no_auth_returns_401(client) -> None:
    resp = await client.get("/api/git/identities")
    assert resp.status_code == 401


async def test_get_nonexistent_identity(
    client, auth_headers: dict[str, str]
) -> None:
    fake_id = str(uuid.uuid4())
    resp = await client.get(f"/api/git/identities/{fake_id}", headers=auth_headers)
    assert resp.status_code == 404


async def test_create_encrypts_credential(
    client, auth_headers: dict[str, str], db_session
) -> None:
    """Verify DB stores ciphertext, not plaintext."""
    from app.modules.git_identity.model import GitIdentity
    from sqlmodel import col
    from sqlalchemy import select

    await client.post(
        "/api/git/identities",
        json={
            "provider": "github",
            "credential_type": "pat",
            "credential": "ghp_secret_check",
        },
        headers=auth_headers,
    )

    stmt = select(GitIdentity).limit(1)
    row = (await db_session.execute(stmt)).scalars().first()
    assert row is not None
    assert row.encrypted_credential != b"ghp_secret_check"
    assert b"ghp_secret_check" not in row.encrypted_credential
    assert row.key_id == "v1"
