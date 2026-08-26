"""HTTP-level tests for Incident router."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from pathlib import Path

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import password_hasher
from app.modules.auth.model import Role, RolePermission, User, UserWorkspaceRole
from app.modules.workspace.model import Workspace


async def _make_user(db_session, *, name: str, is_platform_admin: bool = False) -> User:
    uid = uuid.uuid4()
    user = User(
        id=uid,
        email=f"{name}-{uid.hex[:8]}@example.com",
        password_hash=password_hasher.hash("Pass123!"),
        display_name=name,
        status="active",
        is_platform_admin=is_platform_admin,
    )
    db_session.add(user)
    return user


async def _grant_ws_permission(
    db_session: AsyncSession, *, user: User, workspace_id: uuid.UUID, permission: str
) -> None:
    """给用户在指定 workspace 授一个只含单权限的角色（test_mission_access_control 同款）。"""
    role_id = uuid.uuid4()
    db_session.add(
        Role(
            id=role_id,
            key=f"role-{role_id.hex[:8]}",
            name=f"Role {role_id.hex[:8]}",
            description="test role",
        )
    )
    db_session.add(RolePermission(role_id=role_id, permission=permission))
    db_session.add(
        UserWorkspaceRole(
            user_id=user.id,
            workspace_id=workspace_id,
            role_id=role_id,
            granted_by=None,
            granted_at=datetime.now(UTC),
        )
    )


def _token_for(user: User) -> str:
    from app.core.config import get_settings
    from app.core.security import create_access_token

    token, _ = create_access_token(
        user_id=user.id,
        email=user.email,
        is_admin=bool(user.is_platform_admin),
        settings=get_settings(),
    )
    return token


async def _setup(db_session, tmp_path: Path) -> dict:
    ws_id = uuid.uuid4()
    ws = Workspace(
        id=ws_id,
        name="Test WS",
        slug=f"test-ws-{ws_id.hex[:8]}",
        root_path=str(tmp_path),
        status="active",
    )
    db_session.add(ws)

    user_id = uuid.uuid4()
    user = User(
        id=user_id,
        email=f"test-{user_id.hex[:8]}@example.com",
        password_hash=password_hasher.hash("Pass123!"),
        display_name="Test",
        status="active",
        is_platform_admin=True,
    )
    db_session.add(user)
    await db_session.commit()

    from app.core.config import get_settings
    from app.core.security import create_access_token

    settings = get_settings()
    token, _ = create_access_token(
        user_id=user.id,
        email=user.email,
        is_admin=True,
        settings=settings,
    )
    return {"ws_id": ws_id, "user_id": user_id, "token": token}


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def test_create_incident(client, db_session, tmp_path):
    refs = await _setup(db_session, tmp_path)
    resp = await client.post(
        f"/api/workspaces/{refs['ws_id']}/incidents",
        json={"title": "DB timeout", "severity": "high"},
        headers=_auth(refs["token"]),
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["title"] == "DB timeout"
    assert body["severity"] == "high"
    assert body["status"] == "open"


async def test_list_incidents(client, db_session, tmp_path):
    refs = await _setup(db_session, tmp_path)
    await client.post(
        f"/api/workspaces/{refs['ws_id']}/incidents",
        json={"title": "Inc A"},
        headers=_auth(refs["token"]),
    )
    await client.post(
        f"/api/workspaces/{refs['ws_id']}/incidents",
        json={"title": "Inc B"},
        headers=_auth(refs["token"]),
    )

    resp = await client.get(
        f"/api/workspaces/{refs['ws_id']}/incidents",
        headers=_auth(refs["token"]),
    )
    assert resp.status_code == 200
    assert len(resp.json()) == 2


async def test_get_incident(client, db_session, tmp_path):
    refs = await _setup(db_session, tmp_path)
    create_resp = await client.post(
        f"/api/workspaces/{refs['ws_id']}/incidents",
        json={"title": "Fetch me"},
        headers=_auth(refs["token"]),
    )
    incident_id = create_resp.json()["id"]

    resp = await client.get(
        f"/api/incidents/{incident_id}",
        headers=_auth(refs["token"]),
    )
    assert resp.status_code == 200
    assert resp.json()["title"] == "Fetch me"


async def test_update_incident(client, db_session, tmp_path):
    refs = await _setup(db_session, tmp_path)
    create_resp = await client.post(
        f"/api/workspaces/{refs['ws_id']}/incidents",
        json={"title": "Updatable"},
        headers=_auth(refs["token"]),
    )
    incident_id = create_resp.json()["id"]

    resp = await client.patch(
        f"/api/incidents/{incident_id}",
        json={"status": "investigating"},
        headers=_auth(refs["token"]),
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == "investigating"


async def test_resolve_and_postmortem(client, db_session, tmp_path):
    refs = await _setup(db_session, tmp_path)
    create_resp = await client.post(
        f"/api/workspaces/{refs['ws_id']}/incidents",
        json={"title": "Full lifecycle"},
        headers=_auth(refs["token"]),
    )
    incident_id = create_resp.json()["id"]

    # Resolve
    await client.patch(
        f"/api/incidents/{incident_id}",
        json={"status": "resolved", "resolved_by": str(refs["user_id"])},
        headers=_auth(refs["token"]),
    )

    # Create postmortem
    resp = await client.post(
        f"/api/incidents/{incident_id}/postmortem",
        json={
            "timeline": "09:00 alert",
            "impact": "10min downtime",
            "root_cause_analysis": "pool exhausted",
            "action_items": ["increase pool"],
        },
        headers=_auth(refs["token"]),
    )
    assert resp.status_code == 201
    assert resp.json()["root_cause_analysis"] == "pool exhausted"

    # Get postmortem
    get_resp = await client.get(
        f"/api/incidents/{incident_id}/postmortem",
        headers=_auth(refs["token"]),
    )
    assert get_resp.status_code == 200
    assert get_resp.json()["incident_id"] == incident_id


async def test_incident_no_auth_401(client, db_session, tmp_path):
    refs = await _setup(db_session, tmp_path)
    resp = await client.post(
        f"/api/workspaces/{refs['ws_id']}/incidents",
        json={"title": "No auth"},
    )
    assert resp.status_code == 401


# ── ql-20260826-011：对象级鉴权（跨工作区越权 / IDOR）─────────────────────────


async def _seed_two_workspaces_with_incident(db_session, tmp_path: Path) -> dict:
    """A 工作区（仅 INCIDENT_READ 用户）+ B 工作区（含一条故障单 + DEPLOY_PRODUCTION 用户）。"""
    from app.modules.incident.schema import IncidentCreate
    from app.modules.incident.service import IncidentService

    ws_a = Workspace(
        id=uuid.uuid4(),
        name="WS A",
        slug=f"ws-a-{uuid.uuid4().hex[:8]}",
        root_path=str(tmp_path / "a"),
        status="active",
    )
    ws_b = Workspace(
        id=uuid.uuid4(),
        name="WS B",
        slug=f"ws-b-{uuid.uuid4().hex[:8]}",
        root_path=str(tmp_path / "b"),
        status="active",
    )
    db_session.add_all([ws_a, ws_b])

    reader_a = await _make_user(db_session, name="reader-a")
    await _grant_ws_permission(
        db_session, user=reader_a, workspace_id=ws_a.id, permission="incident:read"
    )
    admin_b = await _make_user(db_session, name="admin-b")
    await db_session.commit()

    incident = await IncidentService(db_session).create(
        ws_b.id,
        admin_b.id,
        IncidentCreate(title="B 工作区故障", severity="high"),
    )
    await db_session.commit()
    return {
        "ws_a": ws_a.id,
        "ws_b": ws_b.id,
        "reader_a_token": _token_for(reader_a),
        "admin_b_token": _token_for(admin_b),
        "incident_id": incident.id,
    }


async def test_get_incident_cross_workspace_403(client, db_session, tmp_path):
    """A 工作区 INCIDENT_READ 用户读 B 工作区故障单 → 403（原 require_permission_any 会放行）。"""
    refs = await _seed_two_workspaces_with_incident(db_session, tmp_path)
    resp = await client.get(
        f"/api/incidents/{refs['incident_id']}",
        headers=_auth(refs["reader_a_token"]),
    )
    assert resp.status_code == 403


async def test_update_incident_cross_workspace_403(client, db_session, tmp_path):
    """A 工作区用户改 B 工作区故障单 → 403。"""
    refs = await _seed_two_workspaces_with_incident(db_session, tmp_path)
    resp = await client.patch(
        f"/api/incidents/{refs['incident_id']}",
        json={"status": "investigating"},
        headers=_auth(refs["reader_a_token"]),
    )
    assert resp.status_code == 403


async def test_postmortem_cross_workspace_403(client, db_session, tmp_path):
    """A 工作区用户读 B 工作区故障单复盘 → 403。"""
    refs = await _seed_two_workspaces_with_incident(db_session, tmp_path)
    resp = await client.get(
        f"/api/incidents/{refs['incident_id']}/postmortem",
        headers=_auth(refs["reader_a_token"]),
    )
    assert resp.status_code == 403


async def test_platform_admin_still_allowed(client, db_session, tmp_path):
    """平台管理员不受对象级校验影响（has_permission 短路），跨工作区仍放行。"""
    refs = await _seed_two_workspaces_with_incident(db_session, tmp_path)
    admin = await _make_user(db_session, name="plat-admin", is_platform_admin=True)
    await db_session.commit()
    resp = await client.get(
        f"/api/incidents/{refs['incident_id']}",
        headers=_auth(_token_for(admin)),
    )
    assert resp.status_code == 200
    assert resp.json()["title"] == "B 工作区故障"
