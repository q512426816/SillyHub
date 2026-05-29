"""HTTP-level tests for Incident router."""

from __future__ import annotations

import uuid
from pathlib import Path

from app.core.security import password_hasher
from app.modules.auth.model import User
from app.modules.workspace.model import Workspace


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
