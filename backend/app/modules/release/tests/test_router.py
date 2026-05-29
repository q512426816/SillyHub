"""HTTP-level tests for Release and Archive routers."""

from __future__ import annotations

import uuid
from pathlib import Path

from app.core.security import password_hasher
from app.modules.auth.model import User
from app.modules.change.model import Change
from app.modules.workspace.model import Workspace


async def _setup_workspace_and_user(db_session, tmp_path: Path) -> dict:
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


# ── Release ────────────────────────────────────────────────────


async def test_create_release(client, db_session, tmp_path):
    refs = await _setup_workspace_and_user(db_session, tmp_path)
    resp = await client.post(
        f"/api/workspaces/{refs['ws_id']}/releases",
        json={"version": "v1.0.0", "title": "First Release"},
        headers=_auth(refs["token"]),
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["version"] == "v1.0.0"
    assert body["status"] == "draft"


async def test_list_releases(client, db_session, tmp_path):
    refs = await _setup_workspace_and_user(db_session, tmp_path)
    # Create 2 releases
    await client.post(
        f"/api/workspaces/{refs['ws_id']}/releases",
        json={"version": "v1.0.0"},
        headers=_auth(refs["token"]),
    )
    await client.post(
        f"/api/workspaces/{refs['ws_id']}/releases",
        json={"version": "v2.0.0"},
        headers=_auth(refs["token"]),
    )

    resp = await client.get(
        f"/api/workspaces/{refs['ws_id']}/releases",
        headers=_auth(refs["token"]),
    )
    assert resp.status_code == 200
    assert len(resp.json()) == 2


async def test_approve_release(client, db_session, tmp_path):
    refs = await _setup_workspace_and_user(db_session, tmp_path)
    create_resp = await client.post(
        f"/api/workspaces/{refs['ws_id']}/releases",
        json={"version": "v1.0.0", "target_environment": "production"},
        headers=_auth(refs["token"]),
    )
    release_id = create_resp.json()["id"]

    # Create second user for approval
    approver_id = uuid.uuid4()
    approver = User(
        id=approver_id,
        email=f"approver-{approver_id.hex[:8]}@example.com",
        password_hash=password_hasher.hash("Pass123!"),
        display_name="Approver",
        status="active",
        is_platform_admin=True,
    )
    db_session.add(approver)
    await db_session.commit()

    from app.core.config import get_settings
    from app.core.security import create_access_token

    settings = get_settings()
    approver_token, _ = create_access_token(
        user_id=approver.id,
        email=approver.email,
        is_admin=True,
        settings=settings,
    )

    resp = await client.post(
        f"/api/releases/{release_id}/approve",
        json={"verdict": "approve", "comment": "LGTM"},
        headers=_auth(approver_token),
    )
    assert resp.status_code == 201
    assert resp.json()["verdict"] == "approve"


async def test_deploy_staging_release(client, db_session, tmp_path):
    refs = await _setup_workspace_and_user(db_session, tmp_path)
    create_resp = await client.post(
        f"/api/workspaces/{refs['ws_id']}/releases",
        json={"version": "v1.0.0", "target_environment": "staging"},
        headers=_auth(refs["token"]),
    )
    release_id = create_resp.json()["id"]

    # Move to staging first
    from app.modules.release.model import Release

    release = await db_session.get(Release, uuid.UUID(release_id))
    release.status = "staging"
    await db_session.commit()

    resp = await client.post(
        f"/api/releases/{release_id}/deploy",
        headers=_auth(refs["token"]),
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == "deployed"


async def test_rollback_release(client, db_session, tmp_path):
    refs = await _setup_workspace_and_user(db_session, tmp_path)
    create_resp = await client.post(
        f"/api/workspaces/{refs['ws_id']}/releases",
        json={"version": "v1.0.0"},
        headers=_auth(refs["token"]),
    )
    release_id = create_resp.json()["id"]

    from datetime import UTC, datetime

    from app.modules.release.model import Release

    release = await db_session.get(Release, uuid.UUID(release_id))
    release.status = "deployed"
    release.deployed_at = datetime.now(UTC)
    await db_session.commit()

    resp = await client.post(
        f"/api/releases/{release_id}/rollback",
        headers=_auth(refs["token"]),
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == "rolled_back"


async def test_release_no_auth_401(client, db_session, tmp_path):
    refs = await _setup_workspace_and_user(db_session, tmp_path)
    resp = await client.post(
        f"/api/workspaces/{refs['ws_id']}/releases",
        json={"version": "v1.0.0"},
    )
    assert resp.status_code == 401


# ── Archive ────────────────────────────────────────────────────


async def test_archive_change(client, db_session, tmp_path):
    refs = await _setup_workspace_and_user(db_session, tmp_path)

    change_id = uuid.uuid4()
    change_dir = tmp_path / "changes" / "local" / "test-archive"
    change_dir.mkdir(parents=True)
    (change_dir / "MASTER.md").write_text("# Change", encoding="utf-8")

    change = Change(
        id=change_id,
        workspace_id=refs["ws_id"],
        change_key="change-archive-001",
        title="Archive Test",
        status="done",
        location="local",
        path="changes/local/test-archive",
    )
    db_session.add(change)
    await db_session.commit()

    resp = await client.post(
        f"/api/workspaces/{refs['ws_id']}/changes/{change_id}/archive",
        headers=_auth(refs["token"]),
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == "archived"


async def test_archive_change_not_done(client, db_session, tmp_path):
    refs = await _setup_workspace_and_user(db_session, tmp_path)

    change_id = uuid.uuid4()
    change = Change(
        id=change_id,
        workspace_id=refs["ws_id"],
        change_key="change-not-done",
        title="Not Done",
        status="in_progress",
        location="local",
        path="changes/local/not-done",
    )
    db_session.add(change)
    await db_session.commit()

    resp = await client.post(
        f"/api/workspaces/{refs['ws_id']}/changes/{change_id}/archive",
        headers=_auth(refs["token"]),
    )
    assert resp.status_code == 409


async def test_distill_knowledge(client, db_session, tmp_path):
    refs = await _setup_workspace_and_user(db_session, tmp_path)

    change_id = uuid.uuid4()
    change = Change(
        id=change_id,
        workspace_id=refs["ws_id"],
        change_key="change-distill-001",
        title="Distill Test",
        status="done",
        location="local",
        path="changes/local/distill-test",
    )
    db_session.add(change)
    await db_session.commit()

    resp = await client.post(
        f"/api/workspaces/{refs['ws_id']}/changes/{change_id}/distill",
        headers=_auth(refs["token"]),
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["change_key"] == "change-distill-001"
