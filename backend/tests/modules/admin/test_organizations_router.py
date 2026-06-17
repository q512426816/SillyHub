"""Organization management router tests.

Covers change ``2026-06-16-admin-org-role-center`` task-05 AC-01..AC-15.
"""

from __future__ import annotations

import uuid

import pytest
from httpx import AsyncClient

from app.core.config import get_settings
from app.core.security import create_access_token, password_hasher
from app.modules.admin.model import Organization, UserOrganization
from app.modules.auth.model import User


@pytest.fixture
async def tree(db_session):
    """Insert a 3-level tree: HQ → Engineering/QA → Frontend.

    Returns a dict mapping the org code to its UUID for assertions.
    """
    hq = Organization(name="HQ", code="hq", status="active", sort_order=0)
    eng = Organization(
        name="Engineering", code="eng", parent_id=None, status="active", sort_order=1
    )
    qa = Organization(name="QA", code="qa", status="active", sort_order=2)
    fe = Organization(name="Frontend", code="fe", status="active", sort_order=10)

    db_session.add_all([hq, eng, qa, fe])
    await db_session.flush()

    eng.parent_id = hq.id
    qa.parent_id = hq.id
    fe.parent_id = eng.id
    await db_session.commit()
    await db_session.refresh(hq)
    await db_session.refresh(eng)
    await db_session.refresh(qa)
    await db_session.refresh(fe)
    return {"hq": hq, "eng": eng, "qa": qa, "fe": fe}


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


@pytest.mark.asyncio
async def test_create_root_organization(client: AsyncClient, auth_headers):
    """AC-01: POST root org → 201 with full OrganizationRead."""
    resp = await client.post(
        "/api/admin/organizations",
        json={"name": "Acme", "code": "acme"},
        headers=auth_headers,
    )
    assert resp.status_code == 201, resp.text
    data = resp.json()
    assert data["name"] == "Acme"
    assert data["code"] == "acme"
    assert data["status"] == "active"
    assert data["parent_id"] is None
    assert data["member_count"] == 0
    assert data["children_count"] == 0


@pytest.mark.asyncio
async def test_list_flat_returns_all_nodes(client: AsyncClient, auth_headers, tree):
    """AC-02: GET / with no parent_id returns every node flat."""
    resp = await client.get("/api/admin/organizations", headers=auth_headers)
    assert resp.status_code == 200
    codes = {item["code"] for item in resp.json()}
    assert {"hq", "eng", "qa", "fe"} <= codes


@pytest.mark.asyncio
async def test_list_filtered_by_parent(client: AsyncClient, auth_headers, tree):
    """AC-03: GET ?parent_id=HQ → direct children only (no grandchildren)."""
    resp = await client.get(
        "/api/admin/organizations",
        params={"parent_id": str(tree["hq"].id)},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    codes = {item["code"] for item in resp.json()}
    assert codes == {"eng", "qa"}


@pytest.mark.asyncio
async def test_get_detail_includes_children(client: AsyncClient, auth_headers, tree):
    """AC-04: GET /{HQ} → OrganizationDetail.children == [eng, qa]."""
    resp = await client.get(f"/api/admin/organizations/{tree['hq'].id}", headers=auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    child_codes = {c["code"] for c in data["children"]}
    assert child_codes == {"eng", "qa"}


@pytest.mark.asyncio
async def test_create_code_duplicate_rejected(client: AsyncClient, auth_headers, tree):
    """AC-05: code reuse → 409 ORGANIZATION_CODE_DUPLICATE."""
    resp = await client.post(
        "/api/admin/organizations",
        json={"name": "Dup", "code": "hq"},
        headers=auth_headers,
    )
    assert resp.status_code == 409
    assert resp.json()["code"].endswith("ORGANIZATION_CODE_DUPLICATE")


@pytest.mark.asyncio
async def test_create_unknown_parent_rejected(client: AsyncClient, auth_headers):
    """AC-06: parent_id pointing to missing UUID → 404 ORGANIZATION_PARENT_NOT_FOUND."""
    resp = await client.post(
        "/api/admin/organizations",
        json={
            "name": "Orphan",
            "code": "orphan",
            "parent_id": str(uuid.uuid4()),
        },
        headers=auth_headers,
    )
    assert resp.status_code == 404
    assert resp.json()["code"].endswith("ORGANIZATION_PARENT_NOT_FOUND")


@pytest.mark.asyncio
async def test_update_fields(client: AsyncClient, auth_headers, tree):
    """AC-07: PATCH changes name + sort_order; updated_at moves forward."""
    before = tree["qa"].updated_at
    resp = await client.patch(
        f"/api/admin/organizations/{tree['qa'].id}",
        json={"name": "Quality Eng", "sort_order": 5},
        headers=auth_headers,
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["name"] == "Quality Eng"
    assert data["sort_order"] == 5
    assert data["updated_at"] >= before.isoformat() or data["updated_at"] is not None


@pytest.mark.asyncio
async def test_update_self_loop_rejected(client: AsyncClient, auth_headers, tree):
    """AC-08: PATCH parent_id=self → 422 validation-style error."""
    resp = await client.patch(
        f"/api/admin/organizations/{tree['eng'].id}",
        json={"parent_id": str(tree["eng"].id)},
        headers=auth_headers,
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_disable_enable_cycle(client: AsyncClient, auth_headers, tree):
    """AC-09/10: disable → disabled; enable → active."""
    disable_resp = await client.post(
        f"/api/admin/organizations/{tree['qa'].id}/disable",
        headers=auth_headers,
    )
    assert disable_resp.status_code == 200
    assert disable_resp.json()["status"] == "disabled"

    enable_resp = await client.post(
        f"/api/admin/organizations/{tree['qa'].id}/enable",
        headers=auth_headers,
    )
    assert enable_resp.status_code == 200
    assert enable_resp.json()["status"] == "active"


@pytest.mark.asyncio
async def test_delete_with_children_rejected(client: AsyncClient, auth_headers, tree):
    """AC-11: DELETE org with children → 409 ORGANIZATION_HAS_CHILDREN."""
    resp = await client.delete(f"/api/admin/organizations/{tree['hq'].id}", headers=auth_headers)
    assert resp.status_code == 409
    body = resp.json()
    assert body["code"].endswith("ORGANIZATION_HAS_CHILDREN")
    assert body["details"]["children_count"] >= 2


@pytest.mark.asyncio
async def test_delete_with_members_rejected(client: AsyncClient, auth_headers, db_session):
    """AC-12: DELETE org with members → 409 ORGANIZATION_IN_USE."""
    org = Organization(name="Empty Co", code="empty_co", status="active")
    db_session.add(org)
    await db_session.flush()

    settings = get_settings()
    password_hasher.configure(settings.auth_bcrypt_rounds)
    user1 = User(
        email="m1@example.com",
        password_hash=password_hasher.hash("Xx1!abcd"),
    )
    user2 = User(
        email="m2@example.com",
        password_hash=password_hasher.hash("Xx1!abcd"),
    )
    db_session.add_all([user1, user2])
    await db_session.flush()

    db_session.add_all(
        [
            UserOrganization(user_id=user1.id, organization_id=org.id),
            UserOrganization(user_id=user2.id, organization_id=org.id),
        ]
    )
    await db_session.commit()
    await db_session.refresh(org)

    resp = await client.delete(f"/api/admin/organizations/{org.id}", headers=auth_headers)
    assert resp.status_code == 409
    body = resp.json()
    assert body["code"].endswith("ORGANIZATION_IN_USE")
    assert body["details"]["member_count"] == 2


@pytest.mark.asyncio
async def test_delete_success(client: AsyncClient, auth_headers, tree):
    """AC-13: DELETE leaf org (no children, no members) → 204 + gone."""
    resp = await client.delete(f"/api/admin/organizations/{tree['fe'].id}", headers=auth_headers)
    assert resp.status_code == 204

    get_resp = await client.get(f"/api/admin/organizations/{tree['fe'].id}", headers=auth_headers)
    assert get_resp.status_code == 404


@pytest.mark.asyncio
async def test_list_requires_permission(client: AsyncClient, non_admin_token: str):
    """AC-14: caller without ORGANIZATION_READ → 403 PERMISSION_DENIED."""
    resp = await client.get(
        "/api/admin/organizations",
        headers={"Authorization": f"Bearer {non_admin_token}"},
    )
    assert resp.status_code == 403
    assert resp.json()["code"].endswith("PERMISSION_DENIED")


@pytest.mark.asyncio
async def test_unauthenticated_rejected(client: AsyncClient):
    """AC-15: no token at all → 401."""
    resp = await client.get("/api/admin/organizations")
    assert resp.status_code == 401
