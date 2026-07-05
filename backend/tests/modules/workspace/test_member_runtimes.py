"""Integration tests for per-member runtime bindings (task-03).

Change 2026-07-01-collaborative-workspace. Covers AC-1..AC-6 + resolver
hit/miss through the FastAPI app, mirroring ``test_members_router.py``'s
hermetic per-test SQLite seeding (roles / users / workspace / membership +
``DaemonRuntime`` rows for the ownership-guard cases).
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest
from httpx import AsyncClient
from sqlalchemy import select

pytestmark = pytest.mark.asyncio


# ────────────────────────────────────────────────────────────────────────────
# Fixtures — mirror test_members_router.py, plus a DaemonRuntime factory.
# ────────────────────────────────────────────────────────────────────────────


@pytest.fixture()
async def role_seeder(db_session):
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


@pytest.fixture()
async def runtime_factory(db_session):
    """Create a ``DaemonRuntime`` owned by ``user_id`` (task-03 ownership guard)."""
    from app.modules.daemon.model import DaemonRuntime

    async def _make(owner_id: uuid.UUID, *, name: str = "rt") -> DaemonRuntime:
        rt = DaemonRuntime(
            id=uuid.uuid4(),
            user_id=owner_id,
            name=name,
            provider="claude",
            status="online",
            last_heartbeat_at=datetime.now(UTC),
        )
        db_session.add(rt)
        await db_session.commit()
        await db_session.refresh(rt)
        return rt

    return _make


def _bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _binding_rows(db_session, *, workspace_id):
    """Fresh SELECT of all binding rows for a workspace (bypass identity map)."""
    from app.modules.workspace.member_runtimes.model import WorkspaceMemberRuntime

    return list(
        (
            await db_session.execute(
                select(WorkspaceMemberRuntime).where(
                    WorkspaceMemberRuntime.workspace_id == workspace_id
                )
            )
        )
        .scalars()
        .all()
    )


# ────────────────────────────────────────────────────────────────────────────
# AC-2: GET /my-binding with no row → 200 + null
# ────────────────────────────────────────────────────────────────────────────


async def test_ac2_get_my_binding_missing_returns_null(
    client: AsyncClient,
    role_seeder,
    user_factory,
    ws_factory,
    member_factory,
):
    """AC-2: no binding row → 200 with JSON ``null`` (not 404/409)."""
    owner, owner_tok = await user_factory(email="owner@x.com", display_name="Owner")
    ws = await ws_factory(owner_id=owner.id)
    await member_factory(ws.id, owner.id, "workspace_owner", granted_by=owner.id)

    resp = await client.get(
        f"/api/workspaces/{ws.id}/my-binding",
        headers=_bearer(owner_tok),
    )
    assert resp.status_code == 200, resp.text
    assert resp.json() is None


# ────────────────────────────────────────────────────────────────────────────
# AC-5 + happy path: PUT /my-binding pins user to current_user.id
# ────────────────────────────────────────────────────────────────────────────


async def test_ac5_put_my_binding_creates_own_row(
    client: AsyncClient,
    db_session,
    role_seeder,
    user_factory,
    ws_factory,
    member_factory,
):
    """AC-5: PUT has no user_id param; server pins to current_user.id → 201.

    A member can only ever create/update their own row. Verifies the created
    row's user_id matches the caller and the 201 status on first insert.
    """
    dev, dev_tok = await user_factory(email="dev@x.com", display_name="Dev")
    ws = await ws_factory(owner_id=dev.id)
    await member_factory(ws.id, dev.id, "developer", granted_by=dev.id)

    resp = await client.put(
        f"/api/workspaces/{ws.id}/my-binding",
        headers=_bearer(dev_tok),
        json={
            "runtime_id": None,
            "root_path": "/home/dev/repo",
            "path_source": "server-local",
        },
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["user_id"] == str(dev.id)
    assert body["root_path"] == "/home/dev/repo"
    assert body["path_source"] == "server-local"
    assert body["runtime_id"] is None

    # Second PUT on the same row → 200 update, still the caller's row.
    resp2 = await client.put(
        f"/api/workspaces/{ws.id}/my-binding",
        headers=_bearer(dev_tok),
        json={
            "runtime_id": None,
            "root_path": "/home/dev/repo-v2",
            "path_source": "server-local",
        },
    )
    assert resp2.status_code == 200, resp2.text
    assert resp2.json()["root_path"] == "/home/dev/repo-v2"

    rows = await _binding_rows(db_session, workspace_id=ws.id)
    assert len(rows) == 1
    assert rows[0].user_id == dev.id


async def test_ac5_put_cannot_target_another_user(
    client: AsyncClient,
    db_session,
    role_seeder,
    user_factory,
    ws_factory,
    member_factory,
):
    """AC-5: even with a forged body there is no user_id field to set — the
    request body cannot name another user, so only the caller's row moves.
    """
    owner, owner_tok = await user_factory(email="owner@x.com", display_name="Owner")
    intruder, _ = await user_factory(email="intruder@x.com", display_name="Intruder")
    ws = await ws_factory(owner_id=owner.id)
    await member_factory(ws.id, owner.id, "workspace_owner", granted_by=owner.id)
    await member_factory(ws.id, intruder.id, "developer", granted_by=owner.id)

    # Body carries no user_id; an extra field is ignored by pydantic (default
    # extra=ignore) so the owner's PUT still lands on the owner's row.
    resp = await client.put(
        f"/api/workspaces/{ws.id}/my-binding",
        headers=_bearer(owner_tok),
        json={
            "runtime_id": None,
            "root_path": "/home/owner/repo",
            "path_source": "server-local",
            "user_id": str(intruder.id),  # ignored — no such schema field
        },
    )
    assert resp.status_code == 201, resp.text
    assert resp.json()["user_id"] == str(owner.id)

    rows = await _binding_rows(db_session, workspace_id=ws.id)
    assert len(rows) == 1
    assert rows[0].user_id == owner.id


# ────────────────────────────────────────────────────────────────────────────
# AC-1: PUT /my-binding binding another user's runtime → 403
# ────────────────────────────────────────────────────────────────────────────


async def test_ac1_put_my_binding_foreign_runtime_returns_403(
    client: AsyncClient,
    db_session,
    role_seeder,
    user_factory,
    ws_factory,
    member_factory,
    runtime_factory,
):
    """AC-1: a non-owner member binds a runtime_id owned by someone else → 403.

    The service-layer ownership guard refuses the bind; the router translates
    ``runtime_not_owned`` to 403 ``runtime_not_owned``. No binding row is
    persisted.
    """
    owner, _ = await user_factory(email="owner@x.com", display_name="Owner")
    dev, dev_tok = await user_factory(email="dev@x.com", display_name="Dev")
    ws = await ws_factory(owner_id=owner.id)
    await member_factory(ws.id, owner.id, "workspace_owner", granted_by=owner.id)
    await member_factory(ws.id, dev.id, "developer", granted_by=owner.id)

    # Runtime owned by owner — dev must not be allowed to bind it.
    owner_rt = await runtime_factory(owner.id, name="owner-rt")

    resp = await client.put(
        f"/api/workspaces/{ws.id}/my-binding",
        headers=_bearer(dev_tok),
        json={
            "runtime_id": str(owner_rt.id),
            "root_path": "/home/dev/repo",
            "path_source": "daemon-client",
        },
    )
    assert resp.status_code == 403, resp.text
    assert resp.json()["code"] == "runtime_not_owned"

    rows = await _binding_rows(db_session, workspace_id=ws.id)
    assert rows == []


async def test_ac1_put_my_binding_own_runtime_succeeds(
    client: AsyncClient,
    role_seeder,
    user_factory,
    ws_factory,
    member_factory,
    runtime_factory,
):
    """AC-1 complement: binding a runtime the caller owns → 201."""
    dev, dev_tok = await user_factory(email="dev@x.com", display_name="Dev")
    ws = await ws_factory(owner_id=dev.id)
    await member_factory(ws.id, dev.id, "developer", granted_by=dev.id)
    dev_rt = await runtime_factory(dev.id, name="dev-rt")

    resp = await client.put(
        f"/api/workspaces/{ws.id}/my-binding",
        headers=_bearer(dev_tok),
        json={
            "runtime_id": str(dev_rt.id),
            "root_path": "/home/dev/repo",
            "path_source": "daemon-client",
        },
    )
    assert resp.status_code == 201, resp.text
    assert resp.json()["runtime_id"] == str(dev_rt.id)


# ────────────────────────────────────────────────────────────────────────────
# AC-4: GET /members/bindings restricted to owner/admin
# ────────────────────────────────────────────────────────────────────────────


async def test_ac4_list_bindings_developer_returns_403(
    client: AsyncClient,
    role_seeder,
    user_factory,
    ws_factory,
    member_factory,
):
    """AC-4: developer (no WORKSPACE_MEMBER_MANAGE) → 403 at dependency layer."""
    owner, _ = await user_factory(email="owner@x.com", display_name="Owner")
    dev, dev_tok = await user_factory(email="dev@x.com", display_name="Dev")
    viewer, viewer_tok = await user_factory(email="viewer@x.com", display_name="Viewer")
    ws = await ws_factory(owner_id=owner.id)
    await member_factory(ws.id, owner.id, "workspace_owner", granted_by=owner.id)
    await member_factory(ws.id, dev.id, "developer", granted_by=owner.id)
    await member_factory(ws.id, viewer.id, "viewer", granted_by=owner.id)

    for tok in (dev_tok, viewer_tok):
        resp = await client.get(
            f"/api/workspaces/{ws.id}/members/bindings",
            headers=_bearer(tok),
        )
        assert resp.status_code == 403, resp.text


async def test_ac4_list_bindings_owner_returns_200(
    client: AsyncClient,
    db_session,
    role_seeder,
    user_factory,
    ws_factory,
    member_factory,
):
    """AC-4 complement: owner sees every member's binding row (FR-003)."""
    owner, owner_tok = await user_factory(email="owner@x.com", display_name="Owner")
    dev, _ = await user_factory(email="dev@x.com", display_name="Dev")
    ws = await ws_factory(owner_id=owner.id)
    await member_factory(ws.id, owner.id, "workspace_owner", granted_by=owner.id)
    await member_factory(ws.id, dev.id, "developer", granted_by=owner.id)

    # Seed two bindings directly via the service so the roster has rows.
    from app.modules.workspace.member_runtimes import service as binding_service

    await binding_service.upsert_my_binding(
        db_session,
        workspace_id=ws.id,
        user_id=owner.id,
        runtime_id=None,
        root_path="/home/owner/repo",
        path_source="server-local",
    )
    await binding_service.upsert_my_binding(
        db_session,
        workspace_id=ws.id,
        user_id=dev.id,
        runtime_id=None,
        root_path="/home/dev/repo",
        path_source="server-local",
    )
    await db_session.commit()

    resp = await client.get(
        f"/api/workspaces/{ws.id}/members/bindings",
        headers=_bearer(owner_tok),
    )
    assert resp.status_code == 200, resp.text
    items = resp.json()
    user_ids = {it["user_id"] for it in items}
    assert user_ids == {str(owner.id), str(dev.id)}


async def test_ac4_list_bindings_platform_admin_bypass(
    client: AsyncClient,
    role_seeder,
    user_factory,
    ws_factory,
    member_factory,
):
    """AC-4: platform admin (no UWR row) bypasses RBAC → 200."""
    owner, _ = await user_factory(email="owner@x.com", display_name="Owner")
    _admin, admin_tok = await user_factory(email="admin@x.com", is_admin=True, display_name="Admin")
    ws = await ws_factory(owner_id=owner.id)
    await member_factory(ws.id, owner.id, "workspace_owner", granted_by=owner.id)

    resp = await client.get(
        f"/api/workspaces/{ws.id}/members/bindings",
        headers=_bearer(admin_tok),
    )
    assert resp.status_code == 200, resp.text
    assert resp.json() == []


# ────────────────────────────────────────────────────────────────────────────
# AC-3: resolver raises MemberBindingNotFound (409) on miss, returns row on hit
# ────────────────────────────────────────────────────────────────────────────


async def test_ac3_resolver_missing_raises_member_binding_not_found(
    db_session,
    role_seeder,
    user_factory,
    ws_factory,
    member_factory,
):
    """AC-3: resolve_member_binding with no row → MemberBindingNotFound (409)."""
    from app.modules.workspace.member_runtimes import (
        MemberBindingNotFound,
        MemberBindingResolver,
    )

    owner, _ = await user_factory(email="owner@x.com", display_name="Owner")
    ws = await ws_factory(owner_id=owner.id)
    await member_factory(ws.id, owner.id, "workspace_owner", granted_by=owner.id)

    with pytest.raises(MemberBindingNotFound) as exc_info:
        await MemberBindingResolver.resolve_member_binding(
            db_session, workspace_id=ws.id, actor_user_id=owner.id
        )
    assert exc_info.value.http_status == 409
    assert exc_info.value.code == "member_binding_not_found"
    assert exc_info.value.details["workspace_id"] == str(ws.id)
    assert exc_info.value.details["user_id"] == str(owner.id)


async def test_ac3_resolver_hit_returns_row(
    db_session,
    role_seeder,
    user_factory,
    ws_factory,
    member_factory,
):
    """AC-3: resolve_member_binding returns the persisted row on hit."""
    from app.modules.workspace.member_runtimes import MemberBindingResolver
    from app.modules.workspace.member_runtimes import (
        service as binding_service,
    )

    owner, _ = await user_factory(email="owner@x.com", display_name="Owner")
    ws = await ws_factory(owner_id=owner.id)
    await member_factory(ws.id, owner.id, "workspace_owner", granted_by=owner.id)

    await binding_service.upsert_my_binding(
        db_session,
        workspace_id=ws.id,
        user_id=owner.id,
        runtime_id=None,
        root_path="/home/owner/repo",
        path_source="server-local",
    )
    await db_session.commit()

    row = await MemberBindingResolver.resolve_member_binding(
        db_session, workspace_id=ws.id, actor_user_id=owner.id
    )
    assert row.workspace_id == ws.id
    assert row.user_id == owner.id
    assert row.root_path == "/home/owner/repo"
