"""Backend tests for platform-admin global workspace management.

Change ``2026-06-25-admin-global-daemon-workspace-management`` — workspace side.
Covers FR-01/FR-02/FR-03/FR-04/FR-06:

- platform admin sees every owner's non-deleted workspace via
  ``GET /api/workspaces`` with nested ``owner`` DTO and ``display_alias``
- ``user_id`` filter only effective for platform admin; normal account passing
  someone else's ``user_id`` still only sees ``allowed_workspace_ids`` scope
- ``q/type/status/limit/offset`` server-side filter + pagination, response
  keeps ``{items, total}`` shape
- ``PATCH /api/workspaces/{workspace_id}`` display_alias set/clear without
  touching ``name``/``slug``/``root_path``
- owner DTO is nested (``owner.user_id/email/display_name``), never flat

TDD note: expected to fail until task-03 adds the ``display_alias`` column and
task-05 extends the workspace DTO/list query/PATCH. The workspace rows are
inserted directly to avoid the filesystem scan dependency.
"""

from __future__ import annotations

import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.security import create_access_token, password_hasher
from app.modules.auth.model import Role, RolePermission, User, UserWorkspaceRole
from app.modules.auth.permissions import Permission
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


async def _create_workspace_row(
    session: AsyncSession,
    *,
    created_by: uuid.UUID,
    name: str = "ws",
    slug: str | None = None,
    status: str = "active",
    ws_type: str | None = None,
) -> Workspace:
    ws = Workspace(
        id=uuid.uuid4(),
        name=name,
        slug=slug or f"slug-{uuid.uuid4().hex[:8]}",
        root_path=f"/tmp/{uuid.uuid4().hex[:8]}",
        status=status,
        type=ws_type,
        created_by=created_by,
    )
    session.add(ws)
    await session.commit()
    await session.refresh(ws)
    return ws


async def _bootstrap_admin_and_normal_users(
    session: AsyncSession,
) -> tuple[User, User, User]:
    admin = await _create_user(
        session, is_platform_admin=True, email="admin-ws@example.com", display_name="Admin"
    )
    user_a = await _create_user(session, email="ws-a@example.com", display_name="WS User A")
    user_b = await _create_user(session, email="ws-b@example.com", display_name="WS User B")
    return admin, user_a, user_b


# ── platform-admin global view + owner DTO ──────────────────────────────────


@pytest.mark.asyncio
async def test_platform_admin_sees_all_owners_with_owner_dto(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    admin, user_a, user_b = await _bootstrap_admin_and_normal_users(db_session)
    await _create_workspace_row(db_session, created_by=user_a.id, name="ws-a")
    await _create_workspace_row(db_session, created_by=user_b.id, name="ws-b")

    resp = await client.get("/api/workspaces", headers=_headers(_token_for(admin)))
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert {"items", "total"} <= set(body.keys())
    assert body["total"] >= 2
    by_name = {item["name"]: item for item in body["items"]}
    assert {"ws-a", "ws-b"} <= set(by_name.keys())

    for item in body["items"]:
        assert "display_alias" in item
        owner = item["owner"]
        assert owner is None or {
            "user_id",
            "email",
            "display_name",
        } <= set(owner.keys())

    assert by_name["ws-a"]["owner"]["email"] == "ws-a@example.com"
    assert by_name["ws-b"]["owner"]["email"] == "ws-b@example.com"


@pytest.mark.asyncio
async def test_platform_admin_user_id_filter_returns_only_that_owner(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    admin, user_a, user_b = await _bootstrap_admin_and_normal_users(db_session)
    await _create_workspace_row(db_session, created_by=user_a.id, name="ws-a")
    await _create_workspace_row(db_session, created_by=user_b.id, name="ws-b")

    resp = await client.get(
        f"/api/workspaces?user_id={user_b.id}", headers=_headers(_token_for(admin))
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    names = {item["name"] for item in body["items"]}
    assert names == {"ws-b"}


# ── normal account scope (FR-02) ─────────────────────────────────────────────


@pytest.mark.asyncio
async def test_normal_account_with_other_user_id_stays_in_allowed_scope(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    _admin, user_a, user_b = await _bootstrap_admin_and_normal_users(db_session)
    ws_a = await _create_workspace_row(db_session, created_by=user_a.id, name="ws-a-owned")
    await _create_workspace_row(db_session, created_by=user_b.id, name="ws-b-owned")
    # user_a only has read on ws_a, NOT ws_b
    await _grant_workspace_permission(db_session, user_a.id, ws_a.id, Permission.WORKSPACE_READ)

    # passing user_b's id must NOT leak ws_b
    resp = await client.get(
        f"/api/workspaces?user_id={user_b.id}", headers=_headers(_token_for(user_a))
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    names = {item["name"] for item in body["items"]}
    assert names == {"ws-a-owned"}
    assert "ws-b-owned" not in names


@pytest.mark.asyncio
async def test_normal_account_without_permission_sees_empty(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    _admin, user_a, user_b = await _bootstrap_admin_and_normal_users(db_session)
    # user_a has platform-level workspace:read (so the endpoint dependency does
    # not 403) but no workspace-scoped role → allowed_workspace_ids() is empty
    # and the list returns 200 with an empty page (FR-02 boundary).
    await _grant_platform_permission(db_session, user_a.id, Permission.WORKSPACE_READ)
    await _create_workspace_row(db_session, created_by=user_b.id, name="ws-b-only")

    resp = await client.get("/api/workspaces", headers=_headers(_token_for(user_a)))
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["total"] == 0
    assert body["items"] == []


# ── q / type / status / limit / offset ───────────────────────────────────────


@pytest.mark.asyncio
async def test_list_filter_q_type_status_limit_offset(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    admin, user_a, _ = await _bootstrap_admin_and_normal_users(db_session)
    await _create_workspace_row(
        db_session, created_by=user_a.id, name="Alpha-WS", ws_type="web", status="active"
    )
    await _create_workspace_row(
        db_session, created_by=user_a.id, name="beta-ws", ws_type="api", status="active"
    )

    # q case-insensitive
    resp = await client.get("/api/workspaces?q=ALPHA", headers=_headers(_token_for(admin)))
    body = resp.json()
    assert body["total"] == 1
    assert body["items"][0]["name"] == "Alpha-WS"

    # type=daemon-client 是已删除的 path_source 值（task-01 删 workspace.path_source），
    # list_with_owner 不再按 path_source 分流；前端旧值传入时静默忽略，无命中（R-06）。
    resp = await client.get(
        "/api/workspaces?type=daemon-client", headers=_headers(_token_for(admin))
    )
    body = resp.json()
    assert body["total"] == 0

    # type=web matches Workspace.type
    resp = await client.get("/api/workspaces?type=web", headers=_headers(_token_for(admin)))
    body = resp.json()
    assert body["total"] == 1
    assert body["items"][0]["name"] == "Alpha-WS"

    # limit/offset: 2 matches, page size 1 offset 1
    resp = await client.get("/api/workspaces?limit=1&offset=1", headers=_headers(_token_for(admin)))
    body = resp.json()
    assert body["total"] >= 2
    assert len(body["items"]) == 1

    # status filter
    resp = await client.get("/api/workspaces?status=active", headers=_headers(_token_for(admin)))
    body = resp.json()
    assert all(item["status"] == "active" for item in body["items"])


@pytest.mark.asyncio
async def test_list_response_keeps_items_total_shape(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    admin, user_a, _ = await _bootstrap_admin_and_normal_users(db_session)
    await _create_workspace_row(db_session, created_by=user_a.id, name="shape-ws")

    resp = await client.get("/api/workspaces", headers=_headers(_token_for(admin)))
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert isinstance(body, dict)
    assert set(body.keys()) >= {"items", "total"}
    # FR-06: no top-level limit/offset added to the workspace response
    assert "limit" not in body
    assert "offset" not in body


# ── PATCH display_alias ─────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_patch_workspace_display_alias_set_and_clear(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    admin, user_a, _ = await _bootstrap_admin_and_normal_users(db_session)
    ws = await _create_workspace_row(
        db_session, created_by=user_a.id, name="orig-ws", slug="orig-slug"
    )

    resp = await client.patch(
        f"/api/workspaces/{ws.id}",
        json={"display_alias": "主平台研发工作区"},
        headers=_headers(_token_for(admin)),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["display_alias"] == "主平台研发工作区"
    assert body["name"] == "orig-ws"
    assert body["slug"] == "orig-slug"

    resp = await client.patch(
        f"/api/workspaces/{ws.id}",
        json={"display_alias": None},
        headers=_headers(_token_for(admin)),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["display_alias"] is None
    assert body["name"] == "orig-ws"
    assert body["slug"] == "orig-slug"


# ── owner DTO is nested, not flat ────────────────────────────────────────────


@pytest.mark.asyncio
async def test_owner_dto_is_nested_not_flat(client: AsyncClient, db_session: AsyncSession) -> None:
    admin, user_a, _ = await _bootstrap_admin_and_normal_users(db_session)
    await _create_workspace_row(db_session, created_by=user_a.id, name="nested-ws")

    resp = await client.get("/api/workspaces", headers=_headers(_token_for(admin)))
    body = resp.json()
    target = next(item for item in body["items"] if item["name"] == "nested-ws")
    # nested owner object, no flat owner_* fields
    assert isinstance(target["owner"], dict)
    assert "owner_email" not in target
    assert "owner_display_name" not in target
