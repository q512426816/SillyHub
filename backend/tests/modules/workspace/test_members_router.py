"""Integration tests for the workspace members API.

Covers change ``2026-06-16-workspace-members`` FR-01..06 end-to-end through
the FastAPI app (task-05). Each test seeds its own roles / users / workspace
inside the per-test in-memory SQLite engine — see ``backend/conftest.py``
``db_engine`` fixture. No alembic, no live Postgres / Redis.

The 20 cases below map 1-to-1 onto the GWT blocks of the requirements doc
(see task-05 blueprint §3.2 for the mapping table).
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest
from httpx import AsyncClient
from sqlalchemy import select

pytestmark = pytest.mark.asyncio


# ────────────────────────────────────────────────────────────────────────────
# Fixtures — keep each test hermetic inside the per-test SQLite engine.
# ────────────────────────────────────────────────────────────────────────────


@pytest.fixture()
async def role_seeder(db_session):
    """Seed the 7 standard roles + their RolePermission rows.

    The test engine skips alembic (see ``backend/conftest.py`` ``db_engine``),
    so ``roles`` / ``role_permissions`` are empty by default — every test that
    walks the RBAC chain needs this seed first.
    """
    from app.modules.auth.model import Role, RolePermission
    from app.modules.auth.permissions import Permission

    roles_spec = {
        "workspace_owner": (
            "Workspace Owner",
            [
                Permission.WORKSPACE_READ,
                Permission.WORKSPACE_WRITE,
                Permission.WORKSPACE_ADMIN,
                Permission.WORKSPACE_MEMBER_MANAGE,
            ],
        ),
        "developer": (
            "Developer",
            [
                Permission.WORKSPACE_READ,
                Permission.WORKSPACE_WRITE,
                Permission.TASK_CREATE,
                Permission.TASK_RUN_AGENT,
            ],
        ),
        "viewer": ("Viewer", [Permission.WORKSPACE_READ]),
        "reviewer": ("Reviewer", [Permission.WORKSPACE_READ]),
        "qa": ("QA", [Permission.WORKSPACE_READ]),
        "component_lead": ("Component Lead", [Permission.WORKSPACE_READ]),
        "platform_admin": ("Platform Admin", [Permission.PLATFORM_ADMIN]),
    }
    ids: dict[str, uuid.UUID] = {}
    for key, (name, perms) in roles_spec.items():
        role = Role(
            id=uuid.uuid4(),
            key=key,
            name=name,
            description=name,
            is_system=True,
        )
        db_session.add(role)
        await db_session.flush()
        ids[key] = role.id
        for p in perms:
            db_session.add(RolePermission(role_id=role.id, permission=p.value))
    await db_session.commit()
    return ids


@pytest.fixture()
async def user_factory(db_session):
    """Create a user + matching access token; ``is_admin=False`` by default."""
    from app.core.config import get_settings
    from app.core.security import create_access_token, password_hasher
    from app.modules.auth.model import User

    async def _make(
        *,
        email: str | None = None,
        display_name: str = "U",
        is_admin: bool = False,
        status: str = "active",
    ) -> tuple[User, str]:
        u = User(
            id=uuid.uuid4(),
            email=email or f"u-{uuid.uuid4().hex[:8]}@example.com",
            password_hash=password_hasher.hash("Pass123!"),
            display_name=display_name,
            status=status,
            is_platform_admin=is_admin,
        )
        db_session.add(u)
        await db_session.commit()
        await db_session.refresh(u)
        token, _ = create_access_token(
            user_id=u.id,
            email=u.email,
            is_admin=u.is_platform_admin,
            settings=get_settings(),
        )
        return u, token

    return _make


@pytest.fixture()
async def ws_factory(db_session, tmp_path):
    """Create a workspace row rooted at pytest's per-test ``tmp_path``."""
    from app.modules.workspace.model import Workspace

    async def _make(name: str = "W", owner_id: uuid.UUID | None = None) -> Workspace:
        ws = Workspace(
            id=uuid.uuid4(),
            name=name,
            slug=f"ws-{uuid.uuid4().hex[:8]}",
            root_path=str(tmp_path),
            status="active",
            created_by=owner_id,
        )
        db_session.add(ws)
        await db_session.commit()
        await db_session.refresh(ws)
        return ws

    return _make


@pytest.fixture()
async def member_factory(db_session, role_seeder):
    """Bind a user to ``role_key`` inside a workspace."""
    from app.modules.auth.model import UserWorkspaceRole

    async def _bind(
        ws_id: uuid.UUID,
        user_id: uuid.UUID,
        role_key: str = "developer",
        granted_by: uuid.UUID | None = None,
    ) -> UserWorkspaceRole:
        row = UserWorkspaceRole(
            user_id=user_id,
            workspace_id=ws_id,
            role_id=role_seeder[role_key],
            granted_by=granted_by,
            granted_at=datetime.now(UTC),
        )
        db_session.add(row)
        await db_session.commit()
        await db_session.refresh(row)
        return row

    return _bind


def _bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _uwr_rows(db_session, *, user_id, workspace_id):
    """Return all UWR rows for ``(user_id, workspace_id)`` from a fresh read.

    SQLAlchemy's identity-map can cache rows the test itself inserted; calling
    ``expire_all`` then accessing ``.id`` on an expired ORM object triggers a
    synchronous lazy-load which async sessions forbid (``MissingGreenlet``).
    Instead we issue a new SELECT scoped by UUID values the caller already
    captured before the mutation — a brand-new query always hits the DB.
    """
    from app.modules.auth.model import UserWorkspaceRole

    return (
        (
            await db_session.execute(
                select(UserWorkspaceRole).where(
                    UserWorkspaceRole.user_id == user_id,
                    UserWorkspaceRole.workspace_id == workspace_id,
                )
            )
        )
        .scalars()
        .all()
    )


# ────────────────────────────────────────────────────────────────────────────
# FR-01 — GET /members
# ────────────────────────────────────────────────────────────────────────────


async def test_fr01_list_members_by_owner_returns_200(
    client: AsyncClient,
    db_session,
    role_seeder,
    user_factory,
    ws_factory,
    member_factory,
):
    """FR-01.a: owner lists members → 200; platform_admin bypass also 200."""
    owner, owner_tok = await user_factory(email="owner@x.com", display_name="Owner")
    dev, _ = await user_factory(email="dev@x.com", display_name="Dev")
    viewer, _ = await user_factory(email="viewer@x.com", display_name="Viewer")

    ws = await ws_factory(owner_id=owner.id)
    await member_factory(ws.id, owner.id, "workspace_owner", granted_by=owner.id)
    await member_factory(ws.id, dev.id, "developer", granted_by=owner.id)
    await member_factory(ws.id, viewer.id, "viewer", granted_by=owner.id)

    resp = await client.get(
        f"/api/workspaces/{ws.id}/members",
        headers=_bearer(owner_tok),
    )
    assert resp.status_code == 200, resp.text
    items = resp.json()["items"]
    # 3 rows seeded; ordering is by granted_at asc.
    role_keys = {it["role_key"] for it in items}
    assert role_keys == {"workspace_owner", "developer", "viewer"}
    # Field contract (FR-01 §3 验收).
    sample = next(it for it in items if it["role_key"] == "workspace_owner")
    assert sample["user_id"] == str(owner.id)
    assert sample["email"] == "owner@x.com"
    assert sample["role_name"] == "Workspace Owner"
    assert sample["is_current_user"] is True

    # Platform-admin bypass (rbac.has_permission line 55 short-circuits).
    _admin, admin_tok = await user_factory(email="admin@x.com", is_admin=True, display_name="Admin")
    # NOTE: admin has NO UserWorkspaceRole row — bypass must still allow.
    resp_admin = await client.get(
        f"/api/workspaces/{ws.id}/members",
        headers=_bearer(admin_tok),
    )
    assert resp_admin.status_code == 200, resp_admin.text
    assert len(resp_admin.json()["items"]) == 3


async def test_fr01_list_members_by_developer_returns_200(
    client: AsyncClient,
    role_seeder,
    user_factory,
    ws_factory,
    member_factory,
):
    """FR-01.b: developer (only WORKSPACE_READ) lists members → 200."""
    owner, _ = await user_factory(email="o@x.com")
    dev, dev_tok = await user_factory(email="dev@x.com")
    ws = await ws_factory(owner_id=owner.id)
    await member_factory(ws.id, owner.id, "workspace_owner")
    await member_factory(ws.id, dev.id, "developer")

    resp = await client.get(
        f"/api/workspaces/{ws.id}/members",
        headers=_bearer(dev_tok),
    )
    assert resp.status_code == 200, resp.text
    assert len(resp.json()["items"]) == 2


async def test_fr01_list_members_by_non_member_returns_403(
    client: AsyncClient,
    role_seeder,
    user_factory,
    ws_factory,
    member_factory,
):
    """FR-01.c: a user with no role in this ws → 403."""
    owner, _ = await user_factory(email="o@x.com")
    _stranger, stranger_tok = await user_factory(email="stranger@x.com")
    ws = await ws_factory(owner_id=owner.id)
    await member_factory(ws.id, owner.id, "workspace_owner")

    resp = await client.get(
        f"/api/workspaces/{ws.id}/members",
        headers=_bearer(stranger_tok),
    )
    assert resp.status_code == 403, resp.text
    assert resp.json()["code"] == "HTTP_403_PERMISSION_DENIED"


# ────────────────────────────────────────────────────────────────────────────
# FR-02 — GET /members/search
# ────────────────────────────────────────────────────────────────────────────


async def test_fr02_search_excludes_existing_members(
    client: AsyncClient,
    role_seeder,
    user_factory,
    ws_factory,
    member_factory,
):
    """FR-02.a: search by email fragment; existing members excluded."""
    owner, owner_tok = await user_factory(email="owner@x.com")
    alice, _ = await user_factory(email="alice@x.com", display_name="Alice")
    _bob, _ = await user_factory(email="bob@example.com", display_name="Bob")
    _cathy, _ = await user_factory(email="cathy@x.com", display_name="Cathy")

    ws = await ws_factory(owner_id=owner.id)
    await member_factory(ws.id, owner.id, "workspace_owner")
    # alice already a member → must be filtered out.
    await member_factory(ws.id, alice.id, "developer")

    resp = await client.get(
        f"/api/workspaces/{ws.id}/members/search",
        params={"q": "ali"},
        headers=_bearer(owner_tok),
    )
    assert resp.status_code == 200, resp.text
    items = resp.json()["items"]
    user_ids = {it["user_id"] for it in items}
    assert str(alice.id) not in user_ids  # existing member excluded
    # 'ali' should not match bob or cathy either.
    assert items == []


async def test_fr02_search_matches_email_and_excludes_correctly(
    client: AsyncClient,
    role_seeder,
    user_factory,
    ws_factory,
    member_factory,
):
    """FR-02.a (extra): non-member matching ``q`` IS returned."""
    owner, owner_tok = await user_factory(email="owner@x.com")
    alice, _ = await user_factory(email="alice@x.com", display_name="Alice")
    cathy, _ = await user_factory(email="cathy@x.com", display_name="Cathy")
    _bob, _ = await user_factory(email="bob@example.com", display_name="Bob")

    ws = await ws_factory(owner_id=owner.id)
    await member_factory(ws.id, owner.id, "workspace_owner")
    await member_factory(ws.id, alice.id, "developer")  # member → excluded

    resp = await client.get(
        f"/api/workspaces/{ws.id}/members/search",
        params={"q": "cath"},
        headers=_bearer(owner_tok),
    )
    assert resp.status_code == 200, resp.text
    items = resp.json()["items"]
    assert len(items) == 1
    assert items[0]["user_id"] == str(cathy.id)
    assert items[0]["email"] == "cathy@x.com"
    assert items[0]["is_member"] is False


async def test_fr02_search_q_too_short_returns_422(
    client: AsyncClient,
    role_seeder,
    user_factory,
    ws_factory,
    member_factory,
):
    """FR-02.b: ``q='a'`` (len<2) → 422 from FastAPI Query validator."""
    owner, owner_tok = await user_factory(email="o@x.com")
    ws = await ws_factory(owner_id=owner.id)
    await member_factory(ws.id, owner.id, "workspace_owner")

    resp = await client.get(
        f"/api/workspaces/{ws.id}/members/search",
        params={"q": "a"},
        headers=_bearer(owner_tok),
    )
    assert resp.status_code == 422, resp.text


async def test_fr02_search_excludes_disabled_users(
    client: AsyncClient,
    role_seeder,
    user_factory,
    ws_factory,
    member_factory,
):
    """FR-02.c: a ``status='disabled'`` user whose email matches ``q`` is excluded."""
    owner, owner_tok = await user_factory(email="owner@x.com")
    bad, _ = await user_factory(email="badboy@x.com", display_name="Bad", status="disabled")
    good, _ = await user_factory(email="goodboy@x.com", display_name="Good")

    ws = await ws_factory(owner_id=owner.id)
    await member_factory(ws.id, owner.id, "workspace_owner")

    resp = await client.get(
        f"/api/workspaces/{ws.id}/members/search",
        params={"q": "boy"},
        headers=_bearer(owner_tok),
    )
    assert resp.status_code == 200, resp.text
    items = resp.json()["items"]
    user_ids = {it["user_id"] for it in items}
    assert str(bad.id) not in user_ids  # disabled excluded
    assert str(good.id) in user_ids


async def test_fr02_search_by_viewer_returns_403(
    client: AsyncClient,
    role_seeder,
    user_factory,
    ws_factory,
    member_factory,
):
    """FR-02.d: viewer lacks WORKSPACE_MEMBER_MANAGE → 403."""
    owner, _ = await user_factory(email="o@x.com")
    viewer, viewer_tok = await user_factory(email="v@x.com")
    ws = await ws_factory(owner_id=owner.id)
    await member_factory(ws.id, owner.id, "workspace_owner")
    await member_factory(ws.id, viewer.id, "viewer")

    resp = await client.get(
        f"/api/workspaces/{ws.id}/members/search",
        params={"q": "abc"},
        headers=_bearer(viewer_tok),
    )
    assert resp.status_code == 403, resp.text


# ────────────────────────────────────────────────────────────────────────────
# FR-03 — POST /members
# ────────────────────────────────────────────────────────────────────────────


async def test_fr03_add_new_member_returns_201(
    client: AsyncClient,
    db_session,
    role_seeder,
    user_factory,
    ws_factory,
    member_factory,
):
    """FR-03.a: owner adds a brand-new member → 201 + DB row inserted."""
    owner, owner_tok = await user_factory(email="o@x.com")
    new_user, _ = await user_factory(email="new@x.com")
    ws = await ws_factory(owner_id=owner.id)
    await member_factory(ws.id, owner.id, "workspace_owner")

    resp = await client.post(
        f"/api/workspaces/{ws.id}/members",
        json={"user_id": str(new_user.id), "role_key": "developer"},
        headers=_bearer(owner_tok),
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["user_id"] == str(new_user.id)
    assert body["role_key"] == "developer"
    assert body["is_current_user"] is False  # owner != new_user

    # DB side-effect — exactly one UWR row for (new_user, ws).
    rows = await _uwr_rows(db_session, user_id=new_user.id, workspace_id=ws.id)
    assert len(rows) == 1
    assert rows[0].role_id == role_seeder["developer"]


async def test_fr03_add_existing_member_is_idempotent_200(
    client: AsyncClient,
    db_session,
    role_seeder,
    user_factory,
    ws_factory,
    member_factory,
):
    """FR-03.b: POST on an existing member → 200 + role swapped in place."""
    owner, owner_tok = await user_factory(email="o@x.com")
    existing, _ = await user_factory(email="existing@x.com")
    ws = await ws_factory(owner_id=owner.id)
    await member_factory(ws.id, owner.id, "workspace_owner")
    # existing starts as viewer.
    await member_factory(ws.id, existing.id, "viewer")

    resp = await client.post(
        f"/api/workspaces/{ws.id}/members",
        json={"user_id": str(existing.id), "role_key": "developer"},
        headers=_bearer(owner_tok),
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["role_key"] == "developer"

    # DB side-effect — exactly one UWR row, role_id now developer.
    rows = await _uwr_rows(db_session, user_id=existing.id, workspace_id=ws.id)
    assert len(rows) == 1
    assert rows[0].role_id == role_seeder["developer"]


async def test_fr03_add_with_platform_admin_role_returns_400(
    client: AsyncClient,
    role_seeder,
    user_factory,
    ws_factory,
    member_factory,
):
    """FR-03.c: ``role_key='platform_admin'`` → 400 invalid_role_key."""
    owner, owner_tok = await user_factory(email="o@x.com")
    target, _ = await user_factory(email="t@x.com")
    ws = await ws_factory(owner_id=owner.id)
    await member_factory(ws.id, owner.id, "workspace_owner")

    resp = await client.post(
        f"/api/workspaces/{ws.id}/members",
        json={"user_id": str(target.id), "role_key": "platform_admin"},
        headers=_bearer(owner_tok),
    )
    assert resp.status_code == 400, resp.text
    assert resp.json()["code"] == "invalid_role_key"


async def test_fr03_add_nonexistent_user_returns_404(
    client: AsyncClient,
    role_seeder,
    user_factory,
    ws_factory,
    member_factory,
):
    """FR-03.d: ``user_id`` that does not exist → 404 user_not_found."""
    owner, owner_tok = await user_factory(email="o@x.com")
    ws = await ws_factory(owner_id=owner.id)
    await member_factory(ws.id, owner.id, "workspace_owner")

    resp = await client.post(
        f"/api/workspaces/{ws.id}/members",
        json={"user_id": str(uuid.uuid4()), "role_key": "developer"},
        headers=_bearer(owner_tok),
    )
    assert resp.status_code == 404, resp.text
    assert resp.json()["code"] == "HTTP_404_USER_NOT_FOUND"


async def test_fr03_add_by_viewer_returns_403(
    client: AsyncClient,
    role_seeder,
    user_factory,
    ws_factory,
    member_factory,
):
    """FR-03.e: viewer (no member:manage) → 403."""
    owner, _ = await user_factory(email="o@x.com")
    viewer, viewer_tok = await user_factory(email="v@x.com")
    target, _ = await user_factory(email="t@x.com")
    ws = await ws_factory(owner_id=owner.id)
    await member_factory(ws.id, owner.id, "workspace_owner")
    await member_factory(ws.id, viewer.id, "viewer")

    resp = await client.post(
        f"/api/workspaces/{ws.id}/members",
        json={"user_id": str(target.id), "role_key": "developer"},
        headers=_bearer(viewer_tok),
    )
    assert resp.status_code == 403, resp.text


# ────────────────────────────────────────────────────────────────────────────
# FR-04 — PATCH /members/{user_id}
# ────────────────────────────────────────────────────────────────────────────


async def test_fr04_patch_member_role_returns_200(
    client: AsyncClient,
    db_session,
    role_seeder,
    user_factory,
    ws_factory,
    member_factory,
):
    """FR-04.a: owner patches developer→viewer → 200, role swapped."""
    owner, owner_tok = await user_factory(email="o@x.com")
    dev, _ = await user_factory(email="dev@x.com")
    ws = await ws_factory(owner_id=owner.id)
    await member_factory(ws.id, owner.id, "workspace_owner")
    await member_factory(ws.id, dev.id, "developer")

    resp = await client.patch(
        f"/api/workspaces/{ws.id}/members/{dev.id}",
        json={"role_key": "viewer"},
        headers=_bearer(owner_tok),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["user_id"] == str(dev.id)
    assert body["role_key"] == "viewer"

    rows = await _uwr_rows(db_session, user_id=dev.id, workspace_id=ws.id)
    assert len(rows) == 1
    assert rows[0].role_id == role_seeder["viewer"]


async def test_fr04_patch_last_owner_returns_400(
    client: AsyncClient,
    role_seeder,
    user_factory,
    ws_factory,
    member_factory,
):
    """FR-04.b: demoting the only owner → 400 cannot_remove_last_owner."""
    owner, owner_tok = await user_factory(email="o@x.com")
    ws = await ws_factory(owner_id=owner.id)
    await member_factory(ws.id, owner.id, "workspace_owner")

    resp = await client.patch(
        f"/api/workspaces/{ws.id}/members/{owner.id}",
        json={"role_key": "developer"},
        headers=_bearer(owner_tok),
    )
    assert resp.status_code == 400, resp.text
    assert resp.json()["code"] == "cannot_remove_last_owner"


async def test_fr04_patch_by_viewer_returns_403(
    client: AsyncClient,
    role_seeder,
    user_factory,
    ws_factory,
    member_factory,
):
    """FR-04.c: viewer calling PATCH → 403."""
    owner, _ = await user_factory(email="o@x.com")
    viewer, viewer_tok = await user_factory(email="v@x.com")
    dev, _ = await user_factory(email="dev@x.com")
    ws = await ws_factory(owner_id=owner.id)
    await member_factory(ws.id, owner.id, "workspace_owner")
    await member_factory(ws.id, viewer.id, "viewer")
    await member_factory(ws.id, dev.id, "developer")

    resp = await client.patch(
        f"/api/workspaces/{ws.id}/members/{dev.id}",
        json={"role_key": "viewer"},
        headers=_bearer(viewer_tok),
    )
    assert resp.status_code == 403, resp.text


# ────────────────────────────────────────────────────────────────────────────
# FR-05 — DELETE /members/{user_id}
# ────────────────────────────────────────────────────────────────────────────


async def test_fr05_delete_member_returns_204(
    client: AsyncClient,
    db_session,
    role_seeder,
    user_factory,
    ws_factory,
    member_factory,
):
    """FR-05.a: owner removes a developer (another owner remains) → 204."""
    owner, owner_tok = await user_factory(email="o@x.com")
    other_owner, _ = await user_factory(email="oo@x.com")
    dev, _ = await user_factory(email="dev@x.com")
    ws = await ws_factory(owner_id=owner.id)
    await member_factory(ws.id, owner.id, "workspace_owner")
    await member_factory(ws.id, other_owner.id, "workspace_owner")
    await member_factory(ws.id, dev.id, "developer")

    resp = await client.delete(
        f"/api/workspaces/{ws.id}/members/{dev.id}",
        headers=_bearer(owner_tok),
    )
    assert resp.status_code == 204, resp.text

    # DB side-effect — no UWR row for (dev, ws).
    rows = await _uwr_rows(db_session, user_id=dev.id, workspace_id=ws.id)
    assert rows == []


async def test_fr05_delete_last_owner_returns_400(
    client: AsyncClient,
    role_seeder,
    user_factory,
    ws_factory,
    member_factory,
):
    """FR-05.b: removing the last owner → 400 cannot_remove_last_owner."""
    owner, owner_tok = await user_factory(email="o@x.com")
    ws = await ws_factory(owner_id=owner.id)
    await member_factory(ws.id, owner.id, "workspace_owner")

    resp = await client.delete(
        f"/api/workspaces/{ws.id}/members/{owner.id}",
        headers=_bearer(owner_tok),
    )
    assert resp.status_code == 400, resp.text
    assert resp.json()["code"] == "cannot_remove_last_owner"


async def test_fr05_delete_non_member_returns_404(
    client: AsyncClient,
    role_seeder,
    user_factory,
    ws_factory,
    member_factory,
):
    """FR-05.c: ``user_id`` not a member → 404 member_not_found."""
    owner, owner_tok = await user_factory(email="o@x.com")
    stranger, _ = await user_factory(email="s@x.com")
    ws = await ws_factory(owner_id=owner.id)
    await member_factory(ws.id, owner.id, "workspace_owner")

    resp = await client.delete(
        f"/api/workspaces/{ws.id}/members/{stranger.id}",
        headers=_bearer(owner_tok),
    )
    assert resp.status_code == 404, resp.text
    assert resp.json()["code"] == "HTTP_404_MEMBER_NOT_FOUND"


# ────────────────────────────────────────────────────────────────────────────
# FR-06 — POST /members/{user_id}/transfer-ownership
# ────────────────────────────────────────────────────────────────────────────


async def test_fr06_transfer_ownership_returns_200(
    client: AsyncClient,
    db_session,
    role_seeder,
    user_factory,
    ws_factory,
    member_factory,
):
    """FR-06.a: owner transfers to developer → 200; target→owner, caller→dev."""
    current, current_tok = await user_factory(email="cur@x.com")
    target, _ = await user_factory(email="tgt@x.com")
    ws = await ws_factory(owner_id=current.id)
    await member_factory(ws.id, current.id, "workspace_owner")
    await member_factory(ws.id, target.id, "developer")

    resp = await client.post(
        f"/api/workspaces/{ws.id}/members/{target.id}/transfer-ownership",
        headers=_bearer(current_tok),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["new_owner"] == str(target.id)
    assert body["demoted"] == str(current.id)

    # DB side-effect: target.role → owner; current.role → developer.
    target_rows = await _uwr_rows(db_session, user_id=target.id, workspace_id=ws.id)
    current_rows = await _uwr_rows(db_session, user_id=current.id, workspace_id=ws.id)
    assert len(target_rows) == 1
    assert target_rows[0].role_id == role_seeder["workspace_owner"]
    assert len(current_rows) == 1
    assert current_rows[0].role_id == role_seeder["developer"]


async def test_fr06_transfer_by_developer_returns_403(
    client: AsyncClient,
    role_seeder,
    user_factory,
    ws_factory,
    member_factory,
):
    """FR-06.c: developer (no member:manage) calling transfer → 403.

    FR-06 design leaves the permission gate at WORKSPACE_MEMBER_MANAGE (the
    same as PATCH / DELETE) — only owners pass it in practice. A developer
    is blocked at the dependency layer before the service runs.
    """
    owner, _ = await user_factory(email="o@x.com")
    dev, dev_tok = await user_factory(email="dev@x.com")
    other, _ = await user_factory(email="other@x.com")
    ws = await ws_factory(owner_id=owner.id)
    await member_factory(ws.id, owner.id, "workspace_owner")
    await member_factory(ws.id, dev.id, "developer")
    await member_factory(ws.id, other.id, "viewer")

    resp = await client.post(
        f"/api/workspaces/{ws.id}/members/{other.id}/transfer-ownership",
        headers=_bearer(dev_tok),
    )
    assert resp.status_code == 403, resp.text


async def test_fr06_transfer_non_member_target_returns_404(
    client: AsyncClient,
    role_seeder,
    user_factory,
    ws_factory,
    member_factory,
):
    """FR-06 (extra): target not a member → 404 member_not_found."""
    owner, owner_tok = await user_factory(email="o@x.com")
    stranger, _ = await user_factory(email="s@x.com")
    ws = await ws_factory(owner_id=owner.id)
    await member_factory(ws.id, owner.id, "workspace_owner")

    resp = await client.post(
        f"/api/workspaces/{ws.id}/members/{stranger.id}/transfer-ownership",
        headers=_bearer(owner_tok),
    )
    assert resp.status_code == 404, resp.text
    assert resp.json()["code"] == "HTTP_404_MEMBER_NOT_FOUND"


# ────────────────────────────────────────────────────────────────────────────
# FR-06.b — concurrent transfer (skipped on SQLite, see task-05 §3.2 #21)
# ────────────────────────────────────────────────────────────────────────────


@pytest.mark.skip(
    reason=(
        "SQLite + aiosqlite serialises writes; SELECT ... FOR UPDATE is a "
        "no-op, so concurrent-transfer races cannot be reproduced in the "
        "in-memory test engine. Covered in production by Postgres row locks "
        "(see members_service.transfer_ownership)."
    )
)
async def test_fr06_transfer_concurrent_only_one_succeeds(
    client: AsyncClient,
    role_seeder,
    user_factory,
    ws_factory,
    member_factory,
):
    """FR-06.b: two concurrent transfers cannot both demote the same owner."""
    import asyncio

    current, current_tok = await user_factory(email="cur@x.com")
    t1, _ = await user_factory(email="t1@x.com")
    t2, _ = await user_factory(email="t2@x.com")
    ws = await ws_factory(owner_id=current.id)
    await member_factory(ws.id, current.id, "workspace_owner")
    await member_factory(ws.id, t1.id, "developer")
    await member_factory(ws.id, t2.id, "developer")

    r1, r2 = await asyncio.gather(
        client.post(
            f"/api/workspaces/{ws.id}/members/{t1.id}/transfer-ownership",
            headers=_bearer(current_tok),
        ),
        client.post(
            f"/api/workspaces/{ws.id}/members/{t2.id}/transfer-ownership",
            headers=_bearer(current_tok),
        ),
    )
    # At most one of the two may succeed (200); the other must fail. Both
    # succeeding would have left the workspace with 3 owners, violating R-01.
    ok = [r for r in (r1, r2) if r.status_code == 200]
    assert len(ok) <= 1
