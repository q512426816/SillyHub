"""HTTP-level tests for the worktree lease router.

GitRunner is mocked — no real git binary needed.
"""

from __future__ import annotations

import uuid
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.modules.worktree.model import WorktreeLease


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _setup_prerequisites(db_session) -> dict:
    """Create workspace, change, task, git_identity in DB."""
    from app.core.security import password_hasher
    from app.modules.auth.model import User
    from app.modules.change.model import Change
    from app.modules.git_identity.model import GitIdentity
    from app.modules.task.model import Task
    from app.modules.workspace.model import Workspace

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
        change_key="change-001",
        title="Test Change",
        status="in_progress",
        location="local",
        path="changes/local/change-001",
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
        "token": token,
    }


@pytest.fixture()
def mock_git():
    with patch("app.modules.worktree.service.GitRunner") as cls:
        instance = AsyncMock()
        cls.return_value = instance
        yield instance


@pytest.fixture()
def mock_exec_env(tmp_path):
    with patch("app.modules.worktree.service.ExecEnvBuilder") as cls:
        lease_root = tmp_path / "lease"
        instance = MagicMock()
        instance.lease_root.return_value = lease_root
        instance.repo_dir.return_value = lease_root / "repo"
        instance.bare_repo_path.return_value = tmp_path / "bare"
        instance.build_env_vars.return_value = {"PATH": "/usr/bin"}
        instance._path_or_none = staticmethod(
            lambda p: str(p) if p and Path(p).exists() else None,
        )
        cls.return_value = instance
        yield instance


@pytest.fixture()
def mock_cipher():
    with patch("app.modules.worktree.service.get_cipher") as fn:
        cipher = MagicMock()
        cipher.decrypt.return_value = "ghp_fake_token_for_test"
        fn.return_value = cipher
        yield cipher


async def test_acquire_returns_201(
    client, db_session, mock_git, mock_exec_env, mock_cipher
) -> None:
    p = await _setup_prerequisites(db_session)
    resp = await client.post(
        f"/api/workspaces/{p['ws_id']}/worktrees/acquire",
        json={
            "component_id": str(p["ws_id"]),
            "change_id": str(p["change_id"]),
            "task_id": str(p["task_id"]),
            "git_identity_id": str(p["identity_id"]),
            "ttl_seconds": 3600,
        },
        headers=_auth(p["token"]),
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["status"] == "locked"
    assert body["branch_name"]
    assert body["expires_at"]


async def test_list_worktrees_empty(
    client, auth_headers, db_session,
) -> None:
    from app.modules.workspace.model import Workspace

    ws_id = uuid.uuid4()
    db_session.add(Workspace(
        id=ws_id, name="WS", slug=f"ws-{ws_id.hex[:8]}", root_path="/tmp",
        status="active",
    ))
    await db_session.commit()

    resp = await client.get(
        f"/api/workspaces/{ws_id}/worktrees",
        headers=auth_headers,
    )
    assert resp.status_code == 200
    assert resp.json()["total"] == 0


async def test_acquire_no_auth_returns_401(client, db_session) -> None:
    ws_id = uuid.uuid4()
    resp = await client.post(
        f"/api/workspaces/{ws_id}/worktrees/acquire",
        json={
            "component_id": str(uuid.uuid4()),
            "change_id": str(uuid.uuid4()),
            "task_id": str(uuid.uuid4()),
            "git_identity_id": str(uuid.uuid4()),
        },
    )
    assert resp.status_code == 401


async def test_release_worktree(
    client, db_session, mock_git, mock_exec_env, mock_cipher
) -> None:
    p = await _setup_prerequisites(db_session)
    headers = _auth(p["token"])

    # Acquire first
    resp = await client.post(
        f"/api/workspaces/{p['ws_id']}/worktrees/acquire",
        json={
            "component_id": str(p["ws_id"]),
            "change_id": str(p["change_id"]),
            "task_id": str(p["task_id"]),
            "git_identity_id": str(p["identity_id"]),
        },
        headers=headers,
    )
    assert resp.status_code == 201
    lease_id = resp.json()["id"]

    # Release
    resp = await client.post(
        f"/api/worktrees/{lease_id}/release",
        headers=headers,
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "released"
    assert resp.json()["released_at"] is not None


async def test_get_lease_detail(
    client, db_session, mock_git, mock_exec_env, mock_cipher
) -> None:
    p = await _setup_prerequisites(db_session)
    headers = _auth(p["token"])

    resp = await client.post(
        f"/api/workspaces/{p['ws_id']}/worktrees/acquire",
        json={
            "component_id": str(p["ws_id"]),
            "change_id": str(p["change_id"]),
            "task_id": str(p["task_id"]),
            "git_identity_id": str(p["identity_id"]),
        },
        headers=headers,
    )
    assert resp.status_code == 201
    lease_id = resp.json()["id"]

    resp = await client.get(
        f"/api/worktrees/{lease_id}",
        headers=headers,
    )
    assert resp.status_code == 200
    assert resp.json()["id"] == lease_id


async def test_extend_lease(
    client, db_session, mock_git, mock_exec_env, mock_cipher
) -> None:
    p = await _setup_prerequisites(db_session)
    headers = _auth(p["token"])

    resp = await client.post(
        f"/api/workspaces/{p['ws_id']}/worktrees/acquire",
        json={
            "component_id": str(p["ws_id"]),
            "change_id": str(p["change_id"]),
            "task_id": str(p["task_id"]),
            "git_identity_id": str(p["identity_id"]),
            "ttl_seconds": 3600,
        },
        headers=headers,
    )
    assert resp.status_code == 201
    lease_id = resp.json()["id"]
    original_expires = resp.json()["expires_at"]

    resp = await client.post(
        f"/api/worktrees/{lease_id}/extend",
        json={"additional_seconds": 1800},
        headers=headers,
    )
    assert resp.status_code == 200
    assert resp.json()["expires_at"] != original_expires


async def test_cross_user_release_403(
    client, db_session, mock_git, mock_exec_env, mock_cipher
) -> None:
    """User A acquires, User B tries to release."""
    from app.core.config import get_settings
    from app.core.security import create_access_token, password_hasher
    from app.modules.auth.model import User

    p = await _setup_prerequisites(db_session)

    # Acquire as User A (prereqs user)
    resp = await client.post(
        f"/api/workspaces/{p['ws_id']}/worktrees/acquire",
        json={
            "component_id": str(p["ws_id"]),
            "change_id": str(p["change_id"]),
            "task_id": str(p["task_id"]),
            "git_identity_id": str(p["identity_id"]),
        },
        headers=_auth(p["token"]),
    )
    assert resp.status_code == 201
    lease_id = resp.json()["id"]

    # Create User B
    settings = get_settings()
    user_b = User(
        id=uuid.uuid4(),
        email="other@example.com",
        password_hash=password_hasher.hash("Pass123!"),
        display_name="Other",
        status="active",
        is_platform_admin=False,
    )
    db_session.add(user_b)
    await db_session.commit()
    token_b, _ = create_access_token(
        user_id=user_b.id, email=user_b.email, is_admin=False, settings=settings,
    )

    # User B tries to release
    resp = await client.post(
        f"/api/worktrees/{lease_id}/release",
        headers=_auth(token_b),
    )
    assert resp.status_code == 403


async def test_get_nonexistent_lease(
    client, auth_headers,
) -> None:
    resp = await client.get(
        f"/api/worktrees/{uuid.uuid4()}",
        headers=auth_headers,
    )
    assert resp.status_code == 404
