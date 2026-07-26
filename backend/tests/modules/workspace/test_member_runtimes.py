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
async def daemon_factory(db_session):
    """Create a ``DaemonInstance`` owned by ``user_id``.

    daemon-entity-binding D-004：member binding 目标改为 daemon 实体（取代
    旧 runtime_id）。ownership guard 据此判定归属，故 AC-1 用 daemon 实体构造。
    """
    from app.modules.daemon.model import DaemonInstance

    async def _make(owner_id: uuid.UUID, *, hostname: str = "host") -> DaemonInstance:
        inst = DaemonInstance(
            id=uuid.uuid4(),
            user_id=owner_id,
            hostname=hostname,
            server_url="http://test.local",
        )
        db_session.add(inst)
        await db_session.commit()
        await db_session.refresh(inst)
        return inst

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


async def test_ac1_put_my_binding_foreign_daemon_returns_403(
    client: AsyncClient,
    db_session,
    role_seeder,
    user_factory,
    ws_factory,
    member_factory,
    daemon_factory,
):
    """AC-1: a non-owner member binds a daemon_id owned by someone else → 403.

    daemon-entity-binding D-004：绑定目标从 runtime 改 daemon 实体。
    ``service.upsert_my_binding`` 在 daemon 不归属调用方时抛
    ``AppError(http_status=403, code="daemon_not_owned")``，router 不 catch，
    全局处理器（``app/core/errors.py``）统一返 403 + 标准错误 body。无 binding 行落库。
    """
    owner, _ = await user_factory(email="owner@x.com", display_name="Owner")
    dev, dev_tok = await user_factory(email="dev@x.com", display_name="Dev")
    ws = await ws_factory(owner_id=owner.id)
    await member_factory(ws.id, owner.id, "workspace_owner", granted_by=owner.id)
    await member_factory(ws.id, dev.id, "developer", granted_by=owner.id)

    # Daemon owned by owner — dev must not be allowed to bind it.
    owner_daemon = await daemon_factory(owner.id, hostname="owner-host")

    resp = await client.put(
        f"/api/workspaces/{ws.id}/my-binding",
        headers=_bearer(dev_tok),
        json={
            "daemon_id": str(owner_daemon.id),
            "root_path": "/home/dev/repo",
            "path_source": "daemon-client",
        },
    )
    assert resp.status_code == 403, resp.text
    assert resp.json()["code"] == "daemon_not_owned"

    rows = await _binding_rows(db_session, workspace_id=ws.id)
    assert rows == []


async def test_ac1_put_my_binding_own_daemon_succeeds(
    client: AsyncClient,
    role_seeder,
    user_factory,
    ws_factory,
    member_factory,
    daemon_factory,
):
    """AC-1 complement: binding a daemon the caller owns → 201."""
    dev, dev_tok = await user_factory(email="dev@x.com", display_name="Dev")
    ws = await ws_factory(owner_id=dev.id)
    await member_factory(ws.id, dev.id, "developer", granted_by=dev.id)
    dev_daemon = await daemon_factory(dev.id, hostname="dev-host")

    resp = await client.put(
        f"/api/workspaces/{ws.id}/my-binding",
        headers=_bearer(dev_tok),
        json={
            "daemon_id": str(dev_daemon.id),
            "root_path": "/home/dev/repo",
            "path_source": "daemon-client",
        },
    )
    assert resp.status_code == 201, resp.text
    assert resp.json()["daemon_id"] == str(dev_daemon.id)


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
        daemon_id=None,
        root_path="/home/owner/repo",
        path_source="server-local",
    )
    await binding_service.upsert_my_binding(
        db_session,
        workspace_id=ws.id,
        user_id=dev.id,
        daemon_id=None,
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
    from app.modules.workspace.member_runtimes.exceptions import MemberBindingNotFound
    from app.modules.workspace.member_runtimes.resolver import MemberBindingResolver

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
    from app.modules.workspace.member_runtimes import (
        service as binding_service,
    )
    from app.modules.workspace.member_runtimes.resolver import MemberBindingResolver

    owner, _ = await user_factory(email="owner@x.com", display_name="Owner")
    ws = await ws_factory(owner_id=owner.id)
    await member_factory(ws.id, owner.id, "workspace_owner", granted_by=owner.id)

    await binding_service.upsert_my_binding(
        db_session,
        workspace_id=ws.id,
        user_id=owner.id,
        daemon_id=None,
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


# ────────────────────────────────────────────────────────────────────────────
# task-04: lender 共享标记 + owner 查询/撤销（D-003@v1 / FR-01 / FR-02）
# change 2026-07-25-daemon-borrow-for-business
# ────────────────────────────────────────────────────────────────────────────


async def _seed_shared_binding(
    db_session,
    *,
    workspace_id,
    user_id,
    daemon_id,
    shared: bool = False,
):
    """Helper：建一条 binding（可指定 shared），返回刷新后的行。

    注意 ``upsert_my_binding`` 返回 ``(row, created)`` tuple（service.py:30），
    必须解包——直接拿返回值赋给 row 会得到 tuple，后续 ``row.shared = True`` 报 AttributeError。
    """
    from app.modules.workspace.member_runtimes import service as binding_service

    row, _created = await binding_service.upsert_my_binding(
        db_session,
        workspace_id=workspace_id,
        user_id=user_id,
        daemon_id=daemon_id,
        root_path=f"/home/{user_id}/repo",
        path_source="daemon-client",
    )
    if shared:
        row.shared = True
        await db_session.commit()
    return row


async def test_t04_lender_mark_shared_returns_200_and_flag(
    client: AsyncClient,
    db_session,
    role_seeder,
    user_factory,
    ws_factory,
    member_factory,
    daemon_factory,
):
    """FR-01: lender PUT /my-binding/shared {shared:true} → 200, binding.shared=True."""
    dev, dev_tok = await user_factory(email="dev@x.com", display_name="Dev")
    ws = await ws_factory(owner_id=dev.id)
    await member_factory(ws.id, dev.id, "developer", granted_by=dev.id)
    dev_daemon = await daemon_factory(dev.id, hostname="dev-host")

    # 先建 binding（绑自己的 daemon）
    resp0 = await client.put(
        f"/api/workspaces/{ws.id}/my-binding",
        headers=_bearer(dev_tok),
        json={
            "daemon_id": str(dev_daemon.id),
            "root_path": "/home/dev/repo",
            "path_source": "daemon-client",
        },
    )
    assert resp0.status_code == 201, resp0.text

    resp = await client.put(
        f"/api/workspaces/{ws.id}/my-binding/shared",
        headers=_bearer(dev_tok),
        json={"shared": True},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["shared"] is True
    assert body["user_id"] == str(dev.id)


async def test_t04_lender_unmark_shared(
    client: AsyncClient,
    db_session,
    role_seeder,
    user_factory,
    ws_factory,
    member_factory,
    daemon_factory,
):
    """FR-01: lender PUT {shared:false} → shared=False（撤销自己共享）。"""
    dev, dev_tok = await user_factory(email="dev@x.com", display_name="Dev")
    ws = await ws_factory(owner_id=dev.id)
    await member_factory(ws.id, dev.id, "developer", granted_by=dev.id)
    dev_daemon = await daemon_factory(dev.id)
    await _seed_shared_binding(
        db_session,
        workspace_id=ws.id,
        user_id=dev.id,
        daemon_id=dev_daemon.id,
        shared=True,
    )

    resp = await client.put(
        f"/api/workspaces/{ws.id}/my-binding/shared",
        headers=_bearer(dev_tok),
        json={"shared": False},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["shared"] is False


async def test_t04_lender_mark_shared_without_binding_returns_409(
    client: AsyncClient,
    role_seeder,
    user_factory,
    ws_factory,
    member_factory,
):
    """FR-01: lender 未配 binding 标 shared → 409 member_binding_not_found。"""
    dev, dev_tok = await user_factory(email="dev@x.com", display_name="Dev")
    ws = await ws_factory(owner_id=dev.id)
    await member_factory(ws.id, dev.id, "developer", granted_by=dev.id)

    resp = await client.put(
        f"/api/workspaces/{ws.id}/my-binding/shared",
        headers=_bearer(dev_tok),
        json={"shared": True},
    )
    assert resp.status_code == 409, resp.text
    assert resp.json()["code"] == "member_binding_not_found"


async def test_t04_lender_can_only_touch_own_binding(
    client: AsyncClient,
    db_session,
    role_seeder,
    user_factory,
    ws_factory,
    member_factory,
    daemon_factory,
):
    """FR-01: 端点无 user_id 参数，钉死当前用户。dev 标自己 shared 不影响 owner。"""
    owner, _ = await user_factory(email="owner@x.com", display_name="Owner")
    dev, dev_tok = await user_factory(email="dev@x.com", display_name="Dev")
    ws = await ws_factory(owner_id=owner.id)
    await member_factory(ws.id, owner.id, "workspace_owner", granted_by=owner.id)
    await member_factory(ws.id, dev.id, "developer", granted_by=owner.id)
    owner_daemon = await daemon_factory(owner.id)
    dev_daemon = await daemon_factory(dev.id)
    await _seed_shared_binding(
        db_session, workspace_id=ws.id, user_id=owner.id, daemon_id=owner_daemon.id
    )
    await _seed_shared_binding(
        db_session, workspace_id=ws.id, user_id=dev.id, daemon_id=dev_daemon.id
    )

    resp = await client.put(
        f"/api/workspaces/{ws.id}/my-binding/shared",
        headers=_bearer(dev_tok),
        json={"shared": True},
    )
    assert resp.status_code == 200, resp.text

    from app.modules.workspace.member_runtimes import service as binding_service

    owner_row = await binding_service.get_my_binding(db_session, ws.id, owner.id)
    dev_row = await binding_service.get_my_binding(db_session, ws.id, dev.id)
    assert owner_row.shared is False  # owner 的 shared 未被波及
    assert dev_row.shared is True


async def test_t04_owner_list_shared_daemons(
    client: AsyncClient,
    db_session,
    role_seeder,
    user_factory,
    ws_factory,
    member_factory,
    daemon_factory,
):
    """FR-02: owner GET /shared-daemons 列出所有 shared=True 的 binding（含 lender/在线状态）。"""
    owner, owner_tok = await user_factory(email="owner@x.com", display_name="Owner")
    dev1, _ = await user_factory(email="dev1@x.com", display_name="Dev1")
    dev2, _ = await user_factory(email="dev2@x.com", display_name="Dev2")
    ws = await ws_factory(owner_id=owner.id)
    await member_factory(ws.id, owner.id, "workspace_owner", granted_by=owner.id)
    await member_factory(ws.id, dev1.id, "developer", granted_by=owner.id)
    await member_factory(ws.id, dev2.id, "developer", granted_by=owner.id)
    d1 = await daemon_factory(dev1.id, hostname="h1")
    d2 = await daemon_factory(dev2.id, hostname="h2")
    # dev1 标 shared，dev2 不标
    await _seed_shared_binding(
        db_session, workspace_id=ws.id, user_id=dev1.id, daemon_id=d1.id, shared=True
    )
    await _seed_shared_binding(
        db_session, workspace_id=ws.id, user_id=dev2.id, daemon_id=d2.id, shared=False
    )

    resp = await client.get(
        f"/api/workspaces/{ws.id}/shared-daemons",
        headers=_bearer(owner_tok),
    )
    assert resp.status_code == 200, resp.text
    items = resp.json()
    assert len(items) == 1, items
    it = items[0]
    assert it["lender_user_id"] == str(dev1.id)
    assert it["daemon_id"] == str(d1.id)
    assert it["daemon_status"] == "online"
    assert it["daemon_hostname"] == "h1"
    assert it["revocable"] is True


async def test_t04_owner_revoke_shared(
    client: AsyncClient,
    db_session,
    role_seeder,
    user_factory,
    ws_factory,
    member_factory,
    daemon_factory,
):
    """FR-02: owner DELETE /members/{user_id}/shared → shared=False, binding 行保留。"""
    owner, owner_tok = await user_factory(email="owner@x.com", display_name="Owner")
    dev, _ = await user_factory(email="dev@x.com", display_name="Dev")
    ws = await ws_factory(owner_id=owner.id)
    await member_factory(ws.id, owner.id, "workspace_owner", granted_by=owner.id)
    await member_factory(ws.id, dev.id, "developer", granted_by=owner.id)
    daemon = await daemon_factory(dev.id)
    await _seed_shared_binding(
        db_session, workspace_id=ws.id, user_id=dev.id, daemon_id=daemon.id, shared=True
    )

    resp = await client.delete(
        f"/api/workspaces/{ws.id}/members/{dev.id}/shared",
        headers=_bearer(owner_tok),
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["shared"] is False

    # binding 行仍在（未删），daemon_id 保留
    from app.modules.workspace.member_runtimes import service as binding_service

    row = await binding_service.get_my_binding(db_session, ws.id, dev.id)
    assert row is not None
    assert row.shared is False
    assert row.daemon_id == daemon.id


async def test_t04_owner_revoke_missing_binding_returns_409(
    client: AsyncClient,
    role_seeder,
    user_factory,
    ws_factory,
    member_factory,
):
    """FR-02: owner 撤销一个没配 binding 的成员 → 409 member_binding_not_found。"""
    owner, owner_tok = await user_factory(email="owner@x.com", display_name="Owner")
    dev, _ = await user_factory(email="dev@x.com", display_name="Dev")
    ws = await ws_factory(owner_id=owner.id)
    await member_factory(ws.id, owner.id, "workspace_owner", granted_by=owner.id)
    await member_factory(ws.id, dev.id, "developer", granted_by=owner.id)

    resp = await client.delete(
        f"/api/workspaces/{ws.id}/members/{dev.id}/shared",
        headers=_bearer(owner_tok),
    )
    assert resp.status_code == 409, resp.text
    assert resp.json()["code"] == "member_binding_not_found"


async def test_t04_non_owner_list_shared_daemons_returns_403(
    client: AsyncClient,
    role_seeder,
    user_factory,
    ws_factory,
    member_factory,
):
    """FR-02: developer（无 WORKSPACE_MEMBER_MANAGE）查 shared-daemons → 403。"""
    owner, _ = await user_factory(email="owner@x.com", display_name="Owner")
    dev, dev_tok = await user_factory(email="dev@x.com", display_name="Dev")
    ws = await ws_factory(owner_id=owner.id)
    await member_factory(ws.id, owner.id, "workspace_owner", granted_by=owner.id)
    await member_factory(ws.id, dev.id, "developer", granted_by=owner.id)

    resp = await client.get(
        f"/api/workspaces/{ws.id}/shared-daemons",
        headers=_bearer(dev_tok),
    )
    assert resp.status_code == 403, resp.text


async def test_t04_non_owner_revoke_returns_403(
    client: AsyncClient,
    db_session,
    role_seeder,
    user_factory,
    ws_factory,
    member_factory,
    daemon_factory,
):
    """FR-02: developer 撤销他人 shared → 403。"""
    owner, _ = await user_factory(email="owner@x.com", display_name="Owner")
    dev, dev_tok = await user_factory(email="dev@x.com", display_name="Dev")
    other, _ = await user_factory(email="other@x.com", display_name="Other")
    ws = await ws_factory(owner_id=owner.id)
    await member_factory(ws.id, owner.id, "workspace_owner", granted_by=owner.id)
    await member_factory(ws.id, dev.id, "developer", granted_by=owner.id)
    await member_factory(ws.id, other.id, "developer", granted_by=owner.id)
    daemon = await daemon_factory(other.id)
    await _seed_shared_binding(
        db_session, workspace_id=ws.id, user_id=other.id, daemon_id=daemon.id, shared=True
    )

    resp = await client.delete(
        f"/api/workspaces/{ws.id}/members/{other.id}/shared",
        headers=_bearer(dev_tok),
    )
    assert resp.status_code == 403, resp.text


async def test_t04_shared_defaults_false_zero_regression(
    client: AsyncClient,
    db_session,
    role_seeder,
    user_factory,
    ws_factory,
    member_factory,
    daemon_factory,
):
    """零回归：PUT /my-binding 建 binding 后 GET → shared=false（默认值，task-01 契约）。"""
    dev, dev_tok = await user_factory(email="dev@x.com", display_name="Dev")
    ws = await ws_factory(owner_id=dev.id)
    await member_factory(ws.id, dev.id, "developer", granted_by=dev.id)
    dev_daemon = await daemon_factory(dev.id)

    resp = await client.put(
        f"/api/workspaces/{ws.id}/my-binding",
        headers=_bearer(dev_tok),
        json={
            "daemon_id": str(dev_daemon.id),
            "root_path": "/r",
            "path_source": "daemon-client",
        },
    )
    assert resp.status_code == 201, resp.text
    assert resp.json()["shared"] is False

    resp2 = await client.get(
        f"/api/workspaces/{ws.id}/my-binding",
        headers=_bearer(dev_tok),
    )
    assert resp2.status_code == 200, resp2.text
    assert resp2.json()["shared"] is False
