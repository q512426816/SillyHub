"""Backend tests for platform-admin global daemon runtime management.

Change ``2026-06-25-admin-global-daemon-workspace-management`` — daemon side.
Covers FR-01/FR-02/FR-03/FR-04/FR-06:

- platform admin sees every owner's runtime via ``GET /api/daemon/runtimes/page``
  with nested ``owner`` DTO; normal account passing ``user_id`` stays scoped
- ``q/type/status/limit/offset`` server-side filter + pagination (total ≠ page)
- ``PATCH /api/daemon/runtimes/{runtime_id}`` display_alias set/clear without
  touching ``name``/``provider``
- platform-admin cross-owner disable/enable/delete; bound active workspace
  delete still 409
- ``/runtimes/page`` fixed route not captured by ``{runtime_id}``
- legacy ``GET /api/daemon/runtimes`` keeps array shape

TDD note: these tests are expected to fail until task-03 lands the
``display_alias`` column and task-04 lands the ``/runtimes/page`` endpoint,
the PATCH endpoint and the ``is_platform_admin`` cross-owner branches. The
failure must point at the missing capability, never at a fixture typo.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.security import create_access_token, password_hasher
from app.modules.auth.model import Role, RolePermission, User, UserWorkspaceRole
from app.modules.auth.permissions import Permission
from app.modules.daemon.model import DaemonRuntime
from app.modules.workspace.model import Workspace

# ── helpers ─────────────────────────────────────────────────────────────────


async def _create_user(
    session: AsyncSession,
    *,
    is_platform_admin: bool = False,
    email: str | None = None,
    display_name: str | None = None,
) -> User:
    uid = uuid.uuid4()
    user = User(
        id=uid,
        email=email or f"user-{uid}@example.com",
        password_hash="irrelevant",
        display_name=display_name or f"User-{str(uid)[:4]}",
        status="active",
        is_platform_admin=is_platform_admin,
    )
    session.add(user)
    await session.commit()
    await session.refresh(user)
    return user


def _token_for(user: User) -> str:
    settings = get_settings()
    password_hasher.configure(settings.auth_bcrypt_rounds)
    token, _ = create_access_token(
        user_id=user.id,
        email=user.email,
        is_admin=user.is_platform_admin,
        settings=settings,
    )
    return token


def _headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _grant_platform_permission(
    session: AsyncSession, user_id: uuid.UUID, permission: Permission
) -> None:
    """Grant a platform-level permission through ``admin.UserRole``."""
    from app.modules.admin.model import UserRole

    role = Role(
        id=uuid.uuid4(),
        key=f"test-plat-{permission.value}-{uuid.uuid4().hex[:6]}",
        name=f"test {permission.value}",
    )
    session.add(role)
    await session.flush()
    session.add(RolePermission(role_id=role.id, permission=permission.value))
    session.add(UserRole(user_id=user_id, role_id=role.id))
    await session.commit()


async def _grant_workspace_permission(
    session: AsyncSession,
    user_id: uuid.UUID,
    workspace_id: uuid.UUID,
    permission: Permission,
) -> None:
    role = Role(
        id=uuid.uuid4(),
        key=f"test-ws-{permission.value}-{uuid.uuid4().hex[:6]}",
        name=f"test ws {permission.value}",
    )
    session.add(role)
    await session.flush()
    session.add(RolePermission(role_id=role.id, permission=permission.value))
    session.add(UserWorkspaceRole(user_id=user_id, workspace_id=workspace_id, role_id=role.id))
    await session.commit()


async def _create_runtime(
    session: AsyncSession,
    user_id: uuid.UUID,
    *,
    name: str = "test-daemon",
    provider: str = "claude",
    status: str = "online",
    version: str | None = None,
) -> DaemonRuntime:
    rt = DaemonRuntime(
        id=uuid.uuid4(),
        user_id=user_id,
        name=name,
        provider=provider,
        status=status,
        version=version,
        last_heartbeat_at=datetime.now(UTC),
    )
    session.add(rt)
    await session.commit()
    await session.refresh(rt)
    return rt


async def _create_workspace_row(
    session: AsyncSession,
    *,
    created_by: uuid.UUID,
    name: str = "bound-ws",
    daemon_runtime_id: uuid.UUID | None = None,
) -> Workspace:
    ws = Workspace(
        id=uuid.uuid4(),
        name=name,
        slug=f"slug-{uuid.uuid4().hex[:8]}",
        root_path=f"/tmp/{uuid.uuid4().hex[:8]}",
        path_source="server-local",
        status="active",
        created_by=created_by,
        daemon_runtime_id=daemon_runtime_id,
    )
    session.add(ws)
    await session.commit()
    await session.refresh(ws)
    return ws


async def _bootstrap_admin_and_normal_users(
    session: AsyncSession,
) -> tuple[User, User, User]:
    """Return (platform_admin, normal_user_a, normal_user_b).

    Both normal users receive the platform-level ``runtime:admin`` permission
    so they can reach the runtime management endpoints — the test then
    asserts the *owner* scoping, not a 403 that masks it.
    """
    admin = await _create_user(
        session, is_platform_admin=True, email="admin-runtime@example.com", display_name="Admin"
    )
    user_a = await _create_user(session, email="user-a@example.com", display_name="User A")
    user_b = await _create_user(session, email="user-b@example.com", display_name="User B")
    await _grant_platform_permission(session, user_a.id, Permission.RUNTIME_ADMIN)
    await _grant_platform_permission(session, user_b.id, Permission.RUNTIME_ADMIN)
    return admin, user_a, user_b


# ── route order + legacy shape ──────────────────────────────────────────────


@pytest.mark.asyncio
async def test_runtime_page_route_order_not_captured_by_runtime_id(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    admin, _, _ = await _bootstrap_admin_and_normal_users(db_session)
    resp = await client.get(
        "/api/daemon/runtimes/page?limit=1&offset=0", headers=_headers(_token_for(admin))
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert isinstance(body, dict)
    assert {"items", "total", "limit", "offset"} <= set(body.keys())
    assert body["limit"] == 1
    assert body["offset"] == 0


@pytest.mark.asyncio
async def test_legacy_runtimes_endpoint_keeps_array_shape(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    admin, user_a, _ = await _bootstrap_admin_and_normal_users(db_session)
    await _create_runtime(db_session, user_a.id, name="legacy-rt")
    resp = await client.get("/api/daemon/runtimes", headers=_headers(_token_for(admin)))
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert isinstance(body, list), "legacy /runtimes must stay an array (FR-06)"
    assert all("id" in item for item in body)


# ── platform-admin global view + owner DTO ──────────────────────────────────


@pytest.mark.asyncio
async def test_platform_admin_sees_all_owners_with_owner_dto(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    admin, user_a, user_b = await _bootstrap_admin_and_normal_users(db_session)
    await _create_runtime(db_session, user_a.id, name="rt-a", provider="claude")
    await _create_runtime(db_session, user_b.id, name="rt-b", provider="codex")

    resp = await client.get(
        "/api/daemon/runtimes/page?limit=10&offset=0",
        headers=_headers(_token_for(admin)),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["total"] >= 2
    by_name = {item["name"]: item for item in body["items"]}
    assert {"rt-a", "rt-b"} <= set(by_name.keys())

    for item in body["items"]:
        assert "owner" in item
        owner = item["owner"]
        assert owner is not None
        assert "user_id" in owner
        assert "email" in owner
        assert "display_name" in owner

    assert by_name["rt-a"]["owner"]["email"] == "user-a@example.com"
    assert by_name["rt-b"]["owner"]["email"] == "user-b@example.com"


@pytest.mark.asyncio
async def test_normal_user_with_other_user_id_still_scoped_to_own_runtimes(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    _admin, user_a, user_b = await _bootstrap_admin_and_normal_users(db_session)
    await _create_runtime(db_session, user_a.id, name="rt-a-owner")
    await _create_runtime(db_session, user_b.id, name="rt-b-owner")

    resp = await client.get(
        f"/api/daemon/runtimes/page?user_id={user_b.id}&limit=10&offset=0",
        headers=_headers(_token_for(user_a)),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    names = {item["name"] for item in body["items"]}
    assert names == {"rt-a-owner"}, "normal account user_id must not enlarge scope"


@pytest.mark.asyncio
async def test_platform_admin_user_id_filter_returns_only_that_owner(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    admin, user_a, user_b = await _bootstrap_admin_and_normal_users(db_session)
    await _create_runtime(db_session, user_a.id, name="rt-a")
    await _create_runtime(db_session, user_b.id, name="rt-b")

    resp = await client.get(
        f"/api/daemon/runtimes/page?user_id={user_b.id}&limit=10&offset=0",
        headers=_headers(_token_for(admin)),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    names = {item["name"] for item in body["items"]}
    assert names == {"rt-b"}


# ── q / type / status / limit / offset ───────────────────────────────────────


@pytest.mark.asyncio
async def test_page_filter_q_type_status_limit_offset(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    admin, user_a, _ = await _bootstrap_admin_and_normal_users(db_session)
    # Three runtimes: different provider/status/name; one has uppercase name to
    # exercise case-insensitive ``q``.
    await _create_runtime(
        db_session, user_a.id, name="Alpha-RT", provider="claude", status="online"
    )
    await _create_runtime(
        db_session, user_a.id, name="beta-rt", provider="codex", status="disabled"
    )
    await _create_runtime(
        db_session, user_a.id, name="gamma-rt", provider="claude", status="offline"
    )

    # type filter: only claude providers
    resp = await client.get(
        "/api/daemon/runtimes/page?type=claude&limit=10&offset=0",
        headers=_headers(_token_for(admin)),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["total"] == 2
    assert all(item["provider"] == "claude" for item in body["items"])

    # status filter: only disabled
    resp = await client.get(
        "/api/daemon/runtimes/page?status=disabled&limit=10&offset=0",
        headers=_headers(_token_for(admin)),
    )
    body = resp.json()
    assert body["total"] == 1
    assert body["items"][0]["status"] == "disabled"

    # q filter: case-insensitive name match
    resp = await client.get(
        "/api/daemon/runtimes/page?q=ALPHA&limit=10&offset=0",
        headers=_headers(_token_for(admin)),
    )
    body = resp.json()
    assert body["total"] == 1
    assert body["items"][0]["name"] == "Alpha-RT"

    # limit/offset: 3 matches, limit=1 offset=1 → 1 item, total still 3
    resp = await client.get(
        "/api/daemon/runtimes/page?limit=1&offset=1",
        headers=_headers(_token_for(admin)),
    )
    body = resp.json()
    assert body["total"] >= 3
    assert len(body["items"]) == 1
    assert body["limit"] == 1
    assert body["offset"] == 1


# ── PATCH display_alias ─────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_patch_runtime_display_alias_set_and_clear(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    admin, user_a, _ = await _bootstrap_admin_and_normal_users(db_session)
    rt = await _create_runtime(db_session, user_a.id, name="orig-name", provider="claude")

    # set alias
    resp = await client.patch(
        f"/api/daemon/runtimes/{rt.id}",
        json={"display_alias": "  生产环境主 daemon  "},
        headers=_headers(_token_for(admin)),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["display_alias"] == "生产环境主 daemon"  # stripped
    assert body["name"] == "orig-name"  # original name untouched
    assert body["provider"] == "claude"

    # clear alias with null
    resp = await client.patch(
        f"/api/daemon/runtimes/{rt.id}",
        json={"display_alias": None},
        headers=_headers(_token_for(admin)),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["display_alias"] is None
    assert body["name"] == "orig-name"


# ── cross-owner management ───────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_platform_admin_cross_owner_disable_enable_delete(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    admin, _user_a, user_b = await _bootstrap_admin_and_normal_users(db_session)
    rt = await _create_runtime(db_session, user_b.id, name="rt-b", status="online")

    # admin disables user_b's runtime
    resp = await client.post(
        f"/api/daemon/runtimes/{rt.id}/disable",
        headers=_headers(_token_for(admin)),
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "disabled"

    # admin re-enables
    resp = await client.post(
        f"/api/daemon/runtimes/{rt.id}/enable",
        headers=_headers(_token_for(admin)),
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] in {"online", "offline"}

    # admin deletes (no bound workspace)
    resp = await client.delete(f"/api/daemon/runtimes/{rt.id}", headers=_headers(_token_for(admin)))
    assert resp.status_code == 204, resp.text


@pytest.mark.asyncio
async def test_normal_user_cross_owner_actions_return_not_found(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    _admin, user_a, user_b = await _bootstrap_admin_and_normal_users(db_session)
    rt = await _create_runtime(db_session, user_b.id, name="rt-b")

    # user_a tries to operate user_b's runtime → 404, not 403
    resp = await client.post(
        f"/api/daemon/runtimes/{rt.id}/disable",
        headers=_headers(_token_for(user_a)),
    )
    assert resp.status_code == 404, resp.text

    resp = await client.delete(
        f"/api/daemon/runtimes/{rt.id}", headers=_headers(_token_for(user_a))
    )
    assert resp.status_code == 404, resp.text


@pytest.mark.asyncio
async def test_platform_admin_delete_bound_runtime_returns_409(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    admin, _user_a, user_b = await _bootstrap_admin_and_normal_users(db_session)
    rt = await _create_runtime(db_session, user_b.id, name="rt-bound")
    # active (non-soft-deleted) workspace bound to this runtime
    await _create_workspace_row(
        db_session, created_by=user_b.id, name="ws-bound", daemon_runtime_id=rt.id
    )

    resp = await client.delete(f"/api/daemon/runtimes/{rt.id}", headers=_headers(_token_for(admin)))
    assert resp.status_code == 409, resp.text
    body = resp.json()
    # DaemonRuntimeInUse details surface the bound workspaces
    assert "workspaces" in body.get("details", {})
