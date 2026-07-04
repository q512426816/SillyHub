"""Tests for GET /api/workspaces/my-bindings (批量端点, 遗留 1 daemon-entity-binding)。

Verifies:
- 未登录 → 401。
- 登录用户 → 200，返回该用户在所有工作区的 member binding（按 workspace_id 索引）。
- 不返回其他用户的 binding。
- 无任何 binding → 200 空列表。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest
from httpx import AsyncClient

pytestmark = pytest.mark.asyncio


@pytest.fixture()
async def role_seeder(db_session):
    from app.modules.auth.model import Role, RolePermission
    from app.modules.auth.permissions import Permission

    roles_spec = {
        "developer": (
            "Developer",
            [Permission.WORKSPACE_READ, Permission.WORKSPACE_WRITE],
        ),
    }
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
        for p in perms:
            db_session.add(RolePermission(role_id=role.id, permission=p.value))
    await db_session.commit()


@pytest.fixture()
async def user_factory(db_session):
    from app.core.config import get_settings
    from app.core.security import create_access_token, password_hasher
    from app.modules.auth.model import User

    async def _make(*, email: str | None = None) -> tuple[User, str]:
        u = User(
            id=uuid.uuid4(),
            email=email or f"u-{uuid.uuid4().hex[:8]}@example.com",
            password_hash=password_hasher.hash("Pass123!"),
            display_name="U",
            status="active",
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

    counter = {"i": 0}

    async def _make(owner_id: uuid.UUID) -> Workspace:
        # 每个工作区用独立 root_path（workspaces.root_path 唯一约束）。
        counter["i"] += 1
        ws = Workspace(
            id=uuid.uuid4(),
            name=f"W-{uuid.uuid4().hex[:8]}",
            slug=f"ws-{uuid.uuid4().hex[:8]}",
            root_path=str(tmp_path / f"ws-{counter['i']}"),
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

    async def _bind(ws_id: uuid.UUID, user_id: uuid.UUID) -> None:
        from app.modules.auth.model import Role

        role = (
            await db_session.execute(
                Role.__table__.select().where(Role.__table__.c.key == "developer")
            )
        ).first()
        row = UserWorkspaceRole(
            user_id=user_id,
            workspace_id=ws_id,
            role_id=role.id,
            granted_by=user_id,
            granted_at=datetime.now(UTC),
        )
        db_session.add(row)
        await db_session.commit()

    return _bind


def _bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _seed_binding(
    db_session,
    *,
    workspace_id: uuid.UUID,
    user_id: uuid.UUID,
    daemon_id: uuid.UUID | None,
    root_path: str,
) -> None:
    from app.modules.workspace.member_runtimes.model import WorkspaceMemberRuntime

    now = datetime.now(UTC)
    db_session.add(
        WorkspaceMemberRuntime(
            workspace_id=workspace_id,
            user_id=user_id,
            daemon_id=daemon_id,
            runtime_id=None,
            root_path=root_path,
            path_source="daemon-client",
            init_synced_at=None,
            init_synced_spec_version=None,
            created_at=now,
            updated_at=now,
        )
    )
    await db_session.commit()


async def test_my_bindings_requires_auth(client: AsyncClient):
    resp = await client.get("/api/workspaces/my-bindings")
    assert resp.status_code == 401


async def test_my_bindings_returns_empty_when_none(
    client: AsyncClient,
    user_factory,
):
    _user, tok = await user_factory()
    resp = await client.get("/api/workspaces/my-bindings", headers=_bearer(tok))
    assert resp.status_code == 200, resp.text
    assert resp.json() == []


async def test_my_bindings_returns_caller_rows_only(
    client: AsyncClient,
    db_session,
    user_factory,
    ws_factory,
    member_factory,
):
    """Returns caller's bindings across workspaces; excludes other users'."""
    from app.modules.daemon.model import DaemonInstance

    caller, caller_tok = await user_factory(email="caller@x.com")
    other, _other_tok = await user_factory(email="other@x.com")

    ws1 = await ws_factory(owner_id=caller.id)
    ws2 = await ws_factory(owner_id=caller.id)
    await member_factory(ws1.id, caller.id)
    await member_factory(ws2.id, caller.id)

    d1 = DaemonInstance(
        id=uuid.uuid4(),
        user_id=caller.id,
        hostname="host-1",
        server_url="http://localhost:8000",
        status="online",
    )
    d2 = DaemonInstance(
        id=uuid.uuid4(),
        user_id=other.id,
        hostname="host-2",
        server_url="http://localhost:8000",
        status="online",
    )
    db_session.add_all([d1, d2])
    await db_session.commit()

    await _seed_binding(
        db_session,
        workspace_id=ws1.id,
        user_id=caller.id,
        daemon_id=d1.id,
        root_path="/home/caller/proj1",
    )
    await _seed_binding(
        db_session,
        workspace_id=ws2.id,
        user_id=caller.id,
        daemon_id=None,
        root_path="/home/caller/proj2",
    )
    # other user's binding — must NOT appear in caller's response.
    await _seed_binding(
        db_session,
        workspace_id=ws2.id,
        user_id=other.id,
        daemon_id=d2.id,
        root_path="/home/other/secret",
    )

    resp = await client.get("/api/workspaces/my-bindings", headers=_bearer(caller_tok))
    assert resp.status_code == 200, resp.text
    body = resp.json()
    by_ws = {row["workspace_id"]: row for row in body}
    assert set(by_ws.keys()) == {str(ws1.id), str(ws2.id)}
    assert by_ws[str(ws1.id)]["daemon_id"] == str(d1.id)
    assert by_ws[str(ws1.id)]["root_path"] == "/home/caller/proj1"
    assert by_ws[str(ws2.id)]["daemon_id"] is None
    assert by_ws[str(ws2.id)]["root_path"] == "/home/caller/proj2"
    # No leakage of other user's path.
    assert "/home/other/secret" not in resp.text
