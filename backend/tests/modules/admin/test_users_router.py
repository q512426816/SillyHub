"""User management router tests.

Covers change ``2026-06-16-admin-org-role-center`` task-06.
Validates the admin endpoints + the forwarded legacy
``/api/users/*`` endpoints + login-permission enforcement.
"""

from __future__ import annotations

import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.core.config import get_settings
from app.core.security import create_access_token, password_hasher
from app.modules.admin.model import Organization, UserOrganization
from app.modules.auth.model import Role, User
from app.modules.auth.model import Session as AuthSession


@pytest.fixture
async def target_user(db_session):
    """Insert a non-admin user for admin operations."""
    settings = get_settings()
    password_hasher.configure(settings.auth_bcrypt_rounds)
    user = User(
        email="target@example.com",
        password_hash=password_hasher.hash("Xx1!abcd"),
        is_platform_admin=False,
        login_enabled=True,
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return user


@pytest.fixture
async def non_admin_token(db_session):
    settings = get_settings()
    password_hasher.configure(settings.auth_bcrypt_rounds)
    user = User(
        email="normie@example.com",
        password_hash=password_hasher.hash("Xx1!abcd"),
        is_platform_admin=False,
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
    return token


@pytest.fixture
async def sample_org(db_session):
    org = Organization(name="Acme", code="acme", status="active")
    db_session.add(org)
    await db_session.commit()
    await db_session.refresh(org)
    return org


@pytest.fixture
async def sample_role(db_session):
    role = Role(key="custom_role", name="Custom", is_system=False, is_active=True)
    db_session.add(role)
    await db_session.commit()
    await db_session.refresh(role)
    return role


# ── Forward compatibility (legacy /api/users/* still works) ────────────


@pytest.mark.asyncio
async def test_legacy_list_users_forwards(client: AsyncClient, auth_headers):
    """AC-01: ``GET /api/users`` still works after the forward migration."""
    resp = await client.get("/api/users", headers=auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert "items" in data and "total" in data
    # Items now carry the new login_enabled + organizations + roles fields.
    if data["items"]:
        for item in data["items"]:
            assert "login_enabled" in item
            assert "organizations" in item
            assert "roles" in item


@pytest.mark.asyncio
async def test_legacy_create_user_forwards(client: AsyncClient, auth_headers, db_session):
    """Legacy POST /api/users still creates a user."""
    email = f"legacy-{uuid.uuid4().hex[:8]}@example.com"
    resp = await client.post(
        "/api/users",
        json={"email": email, "password": "Password123!"},
        headers=auth_headers,
    )
    assert resp.status_code == 201, resp.text
    assert resp.json()["email"] == email


@pytest.mark.asyncio
async def test_self_delete_rejected(client: AsyncClient, auth_headers, db_session):
    """AC-02: DELETE /api/users/{self} → 403 USER_SELF_DELETE_FORBIDDEN."""
    # auth_headers fixture uses admin@example.com; find its user id.
    from sqlalchemy import select as _sel

    admin_user = (
        (await db_session.execute(_sel(User).where(User.email == "admin@example.com")))
        .scalars()
        .first()
    )
    assert admin_user is not None

    resp = await client.delete(f"/api/users/{admin_user.id}", headers=auth_headers)
    assert resp.status_code == 403


# ── admin endpoints ────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_disable_login_revokes_sessions(
    client: AsyncClient, auth_headers, target_user, db_session
):
    """AC-03: POST /admin/users/{id}/disable-login → 200 + sessions revoked."""
    # Seed an active session for target.
    db_session.add(
        AuthSession(
            id=uuid.uuid4(),
            user_id=target_user.id,
            refresh_token_hash="dummy",
            created_at=__import__("datetime").datetime.now(__import__("datetime").UTC),
            expires_at=__import__("datetime").datetime.now(__import__("datetime").UTC),
        )
    )
    await db_session.commit()

    resp = await client.post(
        f"/api/admin/users/{target_user.id}/disable-login",
        headers=auth_headers,
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["login_enabled"] is False

    # Session must be revoked now — use a fresh query rather than
    # expire+lazy-load to avoid greenlet issues across the HTTP session.
    from sqlalchemy import func

    revoked_count = (
        await db_session.execute(
            select(func.count())
            .select_from(AuthSession)
            .where(
                AuthSession.user_id == target_user.id,
                AuthSession.revoked_at.is_not(None),
            )
        )
    ).scalar_one()
    assert revoked_count >= 1


@pytest.mark.asyncio
async def test_disable_login_self_rejected(client: AsyncClient, auth_headers, db_session):
    """AC-04: actor cannot disable own login."""
    from sqlalchemy import select as _sel

    admin_user = (
        (await db_session.execute(_sel(User).where(User.email == "admin@example.com")))
        .scalars()
        .first()
    )

    resp = await client.post(
        f"/api/admin/users/{admin_user.id}/disable-login",
        headers=auth_headers,
    )
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_enable_login(client: AsyncClient, auth_headers, target_user, db_session):
    """AC-05: POST /admin/users/{id}/enable-login → 200 + login_enabled=true."""
    target_user.login_enabled = False
    db_session.add(target_user)
    await db_session.commit()

    resp = await client.post(
        f"/api/admin/users/{target_user.id}/enable-login",
        headers=auth_headers,
    )
    assert resp.status_code == 200
    assert resp.json()["login_enabled"] is True


@pytest.mark.asyncio
async def test_last_admin_protected_from_demotion(client: AsyncClient, auth_headers, db_session):
    """AC-06: PATCH /admin/users/{sole admin} body is_platform_admin=false → 403."""
    from sqlalchemy import select as _sel

    admin_user = (
        (await db_session.execute(_sel(User).where(User.email == "admin@example.com")))
        .scalars()
        .first()
    )

    resp = await client.patch(
        f"/api/admin/users/{admin_user.id}",
        json={"is_platform_admin": False},
        headers=auth_headers,
    )
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_create_user_with_org_and_role_bindings(
    client: AsyncClient,
    auth_headers,
    sample_org,
    sample_role,
):
    """AC-07: POST /admin/users with organization_ids + role_ids binds both."""
    email = f"alice-{uuid.uuid4().hex[:8]}@example.com"
    resp = await client.post(
        "/api/admin/users",
        json={
            "email": email,
            "password": "Password123!",
            "organization_ids": [str(sample_org.id)],
            "role_ids": [str(sample_role.id)],
        },
        headers=auth_headers,
    )
    assert resp.status_code == 201, resp.text
    data = resp.json()
    assert len(data["organizations"]) == 1
    assert data["organizations"][0]["code"] == "acme"
    assert len(data["roles"]) == 1
    assert data["roles"][0]["key"] == "custom_role"


@pytest.mark.asyncio
async def test_update_user_organizations_rewrite(
    client: AsyncClient, auth_headers, db_session, sample_org
):
    """AC-08: PATCH organization_ids=[X] replaces prior set."""
    settings = get_settings()
    password_hasher.configure(settings.auth_bcrypt_rounds)
    user = User(
        email="rewrite@example.com",
        password_hash=password_hasher.hash("Xx1!abcd"),
    )
    db_session.add(user)
    await db_session.flush()

    other_org = Organization(name="Other", code="other_co", status="active")
    db_session.add(other_org)
    await db_session.flush()

    db_session.add_all(
        [
            UserOrganization(user_id=user.id, organization_id=other_org.id),
        ]
    )
    await db_session.commit()
    await db_session.refresh(user)

    resp = await client.patch(
        f"/api/admin/users/{user.id}",
        json={"organization_ids": [str(sample_org.id)]},
        headers=auth_headers,
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()
    codes = {o["code"] for o in data["organizations"]}
    assert codes == {"acme"}

    # DB: other_co binding gone
    bindings = (
        (
            await db_session.execute(
                select(UserOrganization).where(UserOrganization.user_id == user.id)
            )
        )
        .scalars()
        .all()
    )
    assert {(b.organization_id) for b in bindings} == {sample_org.id}


@pytest.mark.asyncio
async def test_create_user_unknown_org_rejected(client: AsyncClient, auth_headers):
    """AC-09: POST with bogus organization_ids → 422."""
    resp = await client.post(
        "/api/admin/users",
        json={
            "email": "bad@example.com",
            "password": "Password123!",
            "organization_ids": [str(uuid.uuid4())],
        },
        headers=auth_headers,
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_login_blocked_when_disabled(
    client: AsyncClient, auth_headers, target_user, db_session
):
    """AC-10: POST /api/auth/login with login_enabled=False → 401 AUTH_USER_LOGIN_DISABLED."""
    target_user.login_enabled = False
    db_session.add(target_user)
    await db_session.commit()

    resp = await client.post(
        "/api/auth/login",
        json={"email": target_user.email, "password": "Xx1!abcd"},
    )
    assert resp.status_code == 401
    assert resp.json()["code"].endswith("AUTH_USER_LOGIN_DISABLED")


@pytest.mark.asyncio
async def test_create_user_requires_permission(client: AsyncClient, non_admin_token):
    """AC-11: caller without USER_WRITE → 403."""
    resp = await client.post(
        "/api/admin/users",
        json={"email": "x@example.com", "password": "Password123!"},
        headers={"Authorization": f"Bearer {non_admin_token}"},
    )
    assert resp.status_code == 403
    assert resp.json()["code"].endswith("PERMISSION_DENIED")


@pytest.mark.asyncio
async def test_get_user_detail(client: AsyncClient, auth_headers, target_user):
    """AC-12: GET /admin/users/{id} returns UserRead with relations."""
    resp = await client.get(f"/api/admin/users/{target_user.id}", headers=auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["email"] == target_user.email
    assert "organizations" in data
    assert "roles" in data


@pytest.mark.asyncio
async def test_user_detail_includes_workspace_scoped_roles(
    client: AsyncClient, auth_headers, db_session, target_user, sample_role
):
    """Workspace-scoped bindings (user_workspace_roles) also surface in UserRead.roles.

    Regression for ql-20260617-006: bootstrap seeds admin via
    UserWorkspaceRole, so /admin/users used to show empty roles for admin
    while /admin/roles/{id}/users correctly listed admin. The two views must
    agree.
    """
    from app.modules.auth.model import UserWorkspaceRole
    from app.modules.workspace.model import Workspace

    slug = f"ws-{uuid.uuid4().hex[:6]}"
    ws = Workspace(name="WS", slug=slug, root_path=f"/tmp/{slug}")
    db_session.add(ws)
    await db_session.flush()
    db_session.add(
        UserWorkspaceRole(
            user_id=target_user.id,
            workspace_id=ws.id,
            role_id=sample_role.id,
        )
    )
    await db_session.commit()

    resp = await client.get(f"/api/admin/users/{target_user.id}", headers=auth_headers)
    assert resp.status_code == 200
    role_keys = {r["key"] for r in resp.json()["roles"]}
    assert "custom_role" in role_keys


@pytest.mark.asyncio
async def test_user_list_includes_workspace_scoped_roles(
    client: AsyncClient, auth_headers, db_session, target_user, sample_role
):
    """GET /admin/users (list) also shows workspace-scoped roles per user."""
    from app.modules.auth.model import UserWorkspaceRole
    from app.modules.workspace.model import Workspace

    slug = f"ws2-{uuid.uuid4().hex[:6]}"
    ws = Workspace(name="WS2", slug=slug, root_path=f"/tmp/{slug}")
    db_session.add(ws)
    await db_session.flush()
    db_session.add(
        UserWorkspaceRole(
            user_id=target_user.id,
            workspace_id=ws.id,
            role_id=sample_role.id,
        )
    )
    await db_session.commit()

    resp = await client.get("/api/admin/users", headers=auth_headers)
    assert resp.status_code == 200
    target_item = next(
        (it for it in resp.json()["items"] if it["email"] == target_user.email),
        None,
    )
    assert target_item is not None
    role_keys = {r["key"] for r in target_item["roles"]}
    assert "custom_role" in role_keys
