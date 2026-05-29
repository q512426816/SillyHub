"""HTTP-level tests for the change writer router."""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta
from unittest.mock import patch

import pytest


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _setup_prerequisites(db_session) -> dict:
    """Create workspace, change, task, git_identity, user + active lease."""
    from app.core.security import password_hasher
    from app.modules.auth.model import User
    from app.modules.change.model import Change
    from app.modules.git_identity.model import GitIdentity
    from app.modules.task.model import Task
    from app.modules.workspace.model import Workspace
    from app.modules.worktree.model import WorktreeLease

    ws_id = uuid.uuid4()
    ws = Workspace(
        id=ws_id,
        name="Test WS",
        slug=f"test-ws-{ws_id.hex[:8]}",
        root_path="/tmp/test",
        status="active",
        component_key="backend",
        repo_url="https://github.com/org/repo.git",
        default_branch="main",
        source_yaml_path="projects/backend.yaml",
    )
    db_session.add(ws)

    change_id = uuid.uuid4()
    change = Change(
        id=change_id,
        workspace_id=ws_id,
        change_key="2026-05-26-test-change",
        title="Test Change",
        status="draft",
        location="change",
        path=".sillyspec/changes/change/2026-05-26-test-change",
    )
    db_session.add(change)

    task_id = uuid.uuid4()
    task = Task(
        id=task_id,
        workspace_id=ws_id,
        change_id=change_id,
        task_key="task-01",
        title="Test Task",
        status="in_progress",
    )
    db_session.add(task)

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

    identity_id = uuid.uuid4()
    identity = GitIdentity(
        id=identity_id,
        user_id=user_id,
        provider="github",
        credential_type="pat",
        encrypted_credential=b"\x00" * 32,
        key_id="v1",
        allowed_repositories=[],
    )
    db_session.add(identity)

    lease_id = uuid.uuid4()
    lease_root = f"/tmp/lease-{lease_id.hex[:8]}"
    lease = WorktreeLease(
        id=lease_id,
        workspace_id=ws_id,
        component_id=ws_id,
        change_id=change_id,
        task_id=task_id,
        user_id=user_id,
        run_id=uuid.uuid4(),
        git_identity_id=identity_id,
        path=lease_root,
        branch_name="test-branch",
        status="locked",
        locked_at=datetime.utcnow(),
        expires_at=datetime.utcnow() + timedelta(hours=1),
    )
    db_session.add(lease)
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

    return {
        "ws_id": ws_id,
        "change_id": change_id,
        "task_id": task_id,
        "user_id": user_id,
        "identity_id": identity_id,
        "lease_id": lease_id,
        "token": token,
        "lease_root": lease_root,
    }


@pytest.fixture()
def mock_repo_dir(tmp_path):
    """Patch ExecEnvBuilder.repo_dir to return a real tmp directory."""
    repo_dir = tmp_path / "repo"
    repo_dir.mkdir()
    (repo_dir / ".sillyspec" / "changes" / "change").mkdir(parents=True)
    with patch(
        "app.modules.change_writer.service.ExecEnvBuilder",
    ) as cls:
        instance = cls.return_value
        instance.repo_dir.return_value = repo_dir
        yield repo_dir


async def test_create_change_success(client, db_session, mock_repo_dir):
    refs = await _setup_prerequisites(db_session)
    resp = await client.post(
        f"/api/workspaces/{refs['ws_id']}/changes/create",
        json={
            "title": "Add Login Feature",
            "change_type": "feature",
            "affected_components": ["backend"],
            "lease_id": str(refs["lease_id"]),
        },
        headers=_auth(refs["token"]),
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["title"] == "Add Login Feature"
    assert body["status"] == "draft"
    assert "add-login-feature" in body["change_key"]

    # Verify file was created on disk
    master_path = mock_repo_dir / body["path"] / "MASTER.md"
    assert master_path.exists()
    content = master_path.read_text()
    assert "Add Login Feature" in content


async def test_generate_proposal(client, db_session, mock_repo_dir):
    refs = await _setup_prerequisites(db_session)
    # Create the change dir first
    change_dir = mock_repo_dir / ".sillyspec" / "changes" / "change" / "2026-05-26-test-change"
    change_dir.mkdir(parents=True, exist_ok=True)
    (change_dir / "MASTER.md").write_text("# Test Change")

    resp = await client.post(
        f"/api/workspaces/{refs['ws_id']}/changes/{refs['change_id']}/documents/generate",
        json={
            "doc_type": "proposal",
            "content": "# Proposal: Test\n\n## Background\nSome background.",
            "lease_id": str(refs["lease_id"]),
        },
        headers=_auth(refs["token"]),
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["doc_type"] == "proposal"
    assert body["size"] > 0

    # Verify file exists
    assert (change_dir / "proposal.md").exists()


async def test_generate_design(client, db_session, mock_repo_dir):
    refs = await _setup_prerequisites(db_session)
    change_dir = mock_repo_dir / ".sillyspec" / "changes" / "change" / "2026-05-26-test-change"
    change_dir.mkdir(parents=True, exist_ok=True)

    resp = await client.post(
        f"/api/workspaces/{refs['ws_id']}/changes/{refs['change_id']}/documents/generate",
        json={
            "doc_type": "design",
            "content": "# Design: Test\n\n## Architecture\nDetails.",
            "lease_id": str(refs["lease_id"]),
        },
        headers=_auth(refs["token"]),
    )
    assert resp.status_code == 200
    assert (change_dir / "design.md").exists()


async def test_generate_document_no_auth(client, db_session, mock_repo_dir):
    refs = await _setup_prerequisites(db_session)
    resp = await client.post(
        f"/api/workspaces/{refs['ws_id']}/changes/{refs['change_id']}/documents/generate",
        json={
            "doc_type": "proposal",
            "content": "test",
            "lease_id": str(refs["lease_id"]),
        },
    )
    assert resp.status_code == 401


async def test_create_change_no_auth(client, db_session, mock_repo_dir):
    refs = await _setup_prerequisites(db_session)
    resp = await client.post(
        f"/api/workspaces/{refs['ws_id']}/changes/create",
        json={
            "title": "Test",
            "lease_id": str(refs["lease_id"]),
        },
    )
    assert resp.status_code == 401


async def test_create_change_invalid_lease(client, db_session, mock_repo_dir):
    refs = await _setup_prerequisites(db_session)
    fake_lease = uuid.uuid4()
    resp = await client.post(
        f"/api/workspaces/{refs['ws_id']}/changes/create",
        json={
            "title": "Test",
            "lease_id": str(fake_lease),
        },
        headers=_auth(refs["token"]),
    )
    assert resp.status_code == 404


async def test_generate_document_upsert(client, db_session, mock_repo_dir):
    """Writing the same doc_type twice should update, not duplicate."""
    refs = await _setup_prerequisites(db_session)
    change_dir = mock_repo_dir / ".sillyspec" / "changes" / "change" / "2026-05-26-test-change"
    change_dir.mkdir(parents=True, exist_ok=True)

    for _ in range(2):
        resp = await client.post(
            f"/api/workspaces/{refs['ws_id']}/changes/{refs['change_id']}/documents/generate",
            json={
                "doc_type": "plan",
                "content": "# Plan v2\n\nUpdated plan.",
                "lease_id": str(refs["lease_id"]),
            },
            headers=_auth(refs["token"]),
        )
        assert resp.status_code == 200

    # Should have only one ChangeDocument for this doc_type
    from sqlalchemy import select

    from app.modules.change.model import ChangeDocument

    stmt = select(ChangeDocument).where(
        ChangeDocument.change_id == refs["change_id"],
        ChangeDocument.doc_type == "plan",
    )
    docs = list((await db_session.execute(stmt)).scalars().all())
    assert len(docs) == 1
    assert docs[0].exists is True
