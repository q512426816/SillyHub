"""HTTP-level tests for the git gateway router.

GitGatewayService.execute subprocess is mocked — no real git binary needed.
"""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timedelta
from unittest.mock import AsyncMock, patch

import pytest

from app.modules.git_gateway.model import GitOperationLog


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _setup_active_lease(db_session) -> dict:
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
    """Patch _resolve_repo_dir to return a real tmp directory."""
    repo_dir = tmp_path / "repo"
    repo_dir.mkdir()
    (repo_dir / ".git").mkdir()
    with patch(
        "app.modules.git_gateway.service.GitGatewayService._resolve_repo_dir",
        return_value=repo_dir,
    ):
        yield repo_dir


async def test_git_status_success(client, db_session, mock_repo_dir):
    refs = await _setup_active_lease(db_session)
    with patch("app.modules.git_gateway.service.asyncio.create_subprocess_exec") as mock_exec:
        proc = AsyncMock()
        proc.communicate = AsyncMock(return_value=(b"On branch main\n", b""))
        proc.returncode = 0
        mock_exec.return_value = proc

        resp = await client.post(
            f"/api/worktrees/{refs['lease_id']}/git",
            json={"operation": "status", "args": []},
            headers=_auth(refs["token"]),
        )
    assert resp.status_code == 200
    body = resp.json()
    assert body["operation"] == "status"
    assert body["result_code"] == 0
    assert "On branch main" in body["redacted_output"]


async def test_git_log_with_args(client, db_session, mock_repo_dir):
    refs = await _setup_active_lease(db_session)
    with patch("app.modules.git_gateway.service.asyncio.create_subprocess_exec") as mock_exec:
        proc = AsyncMock()
        proc.communicate = AsyncMock(return_value=(b"abc123 commit msg\n", b""))
        proc.returncode = 0
        mock_exec.return_value = proc

        resp = await client.post(
            f"/api/worktrees/{refs['lease_id']}/git",
            json={"operation": "log", "args": ["--oneline", "-5"]},
            headers=_auth(refs["token"]),
        )
    assert resp.status_code == 200
    body = resp.json()
    assert body["operation"] == "log"
    assert body["result_code"] == 0


async def test_blocked_operation_returns_403(client, db_session, mock_repo_dir):
    refs = await _setup_active_lease(db_session)
    resp = await client.post(
        f"/api/worktrees/{refs['lease_id']}/git",
        json={"operation": "stash", "args": []},
        headers=_auth(refs["token"]),
    )
    assert resp.status_code == 403


async def test_push_force_blocked(client, db_session, mock_repo_dir):
    refs = await _setup_active_lease(db_session)
    resp = await client.post(
        f"/api/worktrees/{refs['lease_id']}/git",
        json={"operation": "push", "args": ["--force"]},
        headers=_auth(refs["token"]),
    )
    assert resp.status_code == 403


async def test_no_auth_returns_401(client, db_session, mock_repo_dir):
    refs = await _setup_active_lease(db_session)
    resp = await client.post(
        f"/api/worktrees/{refs['lease_id']}/git",
        json={"operation": "status", "args": []},
    )
    assert resp.status_code == 401


async def test_unknown_lease_returns_404(client, db_session, mock_repo_dir):
    refs = await _setup_active_lease(db_session)
    fake_lease = uuid.uuid4()
    resp = await client.post(
        f"/api/worktrees/{fake_lease}/git",
        json={"operation": "status", "args": []},
        headers=_auth(refs["token"]),
    )
    assert resp.status_code == 404


async def test_pat_redacted_in_output(client, db_session, mock_repo_dir):
    refs = await _setup_active_lease(db_session)
    with patch("app.modules.git_gateway.service.asyncio.create_subprocess_exec") as mock_exec:
        proc = AsyncMock()
        proc.communicate = AsyncMock(
            return_value=(
                b"Pushing to https://user:ghp_AbCdEf1234567890abcdefghijklmn@github.com/repo\n",
                b"",
            ),
        )
        proc.returncode = 0
        mock_exec.return_value = proc

        resp = await client.post(
            f"/api/worktrees/{refs['lease_id']}/git",
            json={"operation": "push", "args": []},
            headers=_auth(refs["token"]),
        )
    assert resp.status_code == 200
    body = resp.json()
    assert "ghp_AbCdEf" not in body["redacted_output"]
    assert "***REDACTED***" in body["redacted_output"]


async def test_git_operation_log_written(client, db_session, mock_repo_dir):
    refs = await _setup_active_lease(db_session)
    with patch("app.modules.git_gateway.service.asyncio.create_subprocess_exec") as mock_exec:
        proc = AsyncMock()
        proc.communicate = AsyncMock(return_value=(b"ok\n", b""))
        proc.returncode = 0
        mock_exec.return_value = proc

        resp = await client.post(
            f"/api/worktrees/{refs['lease_id']}/git",
            json={"operation": "diff", "args": ["--stat"]},
            headers=_auth(refs["token"]),
        )
    assert resp.status_code == 200

    from sqlalchemy import select

    stmt = select(GitOperationLog).where(
        GitOperationLog.lease_id == refs["lease_id"],
    )
    logs = list((await db_session.execute(stmt)).scalars().all())
    assert len(logs) == 1
    assert logs[0].operation == "diff"
    assert logs[0].result_code == 0
    assert logs[0].workspace_id == refs["ws_id"]
    assert logs[0].args_json is not None
    assert "--stat" in json.loads(logs[0].args_json)


async def test_git_failure_returns_log_with_nonzero(client, db_session, mock_repo_dir):
    refs = await _setup_active_lease(db_session)
    with patch("app.modules.git_gateway.service.asyncio.create_subprocess_exec") as mock_exec:
        proc = AsyncMock()
        proc.communicate = AsyncMock(
            return_value=(b"fatal: not a git repository\n", b""),
        )
        proc.returncode = 128
        mock_exec.return_value = proc

        resp = await client.post(
            f"/api/worktrees/{refs['lease_id']}/git",
            json={"operation": "status", "args": []},
            headers=_auth(refs["token"]),
        )
    assert resp.status_code == 200
    body = resp.json()
    assert body["result_code"] == 128


async def test_push_to_main_rejected(client, db_session, mock_repo_dir):
    refs = await _setup_active_lease(db_session)
    resp = await client.post(
        f"/api/worktrees/{refs['lease_id']}/git",
        json={"operation": "push", "args": ["origin", "main"]},
        headers=_auth(refs["token"]),
    )
    assert resp.status_code == 403
    assert "protected" in resp.json()["message"].lower()


async def test_push_to_master_rejected(client, db_session, mock_repo_dir):
    refs = await _setup_active_lease(db_session)
    resp = await client.post(
        f"/api/worktrees/{refs['lease_id']}/git",
        json={"operation": "push", "args": ["origin", "master"]},
        headers=_auth(refs["token"]),
    )
    assert resp.status_code == 403


async def test_shell_injection_rejected(client, db_session, mock_repo_dir):
    refs = await _setup_active_lease(db_session)
    resp = await client.post(
        f"/api/worktrees/{refs['lease_id']}/git",
        json={"operation": "commit", "args": ["-m", "$(whoami)"]},
        headers=_auth(refs["token"]),
    )
    assert resp.status_code == 403


async def test_git_env_injected_with_identity(client, db_session, mock_repo_dir):
    """When user has a GitIdentity with git_username/git_email, env vars are passed."""
    refs = await _setup_active_lease(db_session)

    # Update the identity to have username/email
    from sqlalchemy import select
    from app.modules.git_identity.model import GitIdentity

    stmt = select(GitIdentity).where(GitIdentity.id == refs["identity_id"])
    identity = (await db_session.execute(stmt)).scalars().first()
    identity.git_username = "TestUser"
    identity.git_email = "test@example.com"
    await db_session.commit()

    with patch("app.modules.git_gateway.service.asyncio.create_subprocess_exec") as mock_exec:
        proc = AsyncMock()
        proc.communicate = AsyncMock(return_value=(b"ok\n", b""))
        proc.returncode = 0
        mock_exec.return_value = proc

        resp = await client.post(
            f"/api/worktrees/{refs['lease_id']}/git",
            json={"operation": "status", "args": []},
            headers=_auth(refs["token"]),
        )
    assert resp.status_code == 200

    # Verify env was passed to subprocess
    call_kwargs = mock_exec.call_args.kwargs
    assert "env" in call_kwargs
    env = call_kwargs["env"]
    assert env["GIT_AUTHOR_NAME"] == "TestUser"
    assert env["GIT_AUTHOR_EMAIL"] == "test@example.com"
    assert env["GIT_COMMITTER_NAME"] == "TestUser"
    assert env["GIT_COMMITTER_EMAIL"] == "test@example.com"


async def test_git_env_defaults_without_identity(client, db_session, mock_repo_dir):
    """When user has no usable GitIdentity, default identity env vars are used."""
    refs = await _setup_active_lease(db_session)

    # Revoke the identity so none is usable
    from sqlalchemy import select
    from app.modules.git_identity.model import GitIdentity
    from datetime import datetime

    stmt = select(GitIdentity).where(GitIdentity.id == refs["identity_id"])
    identity = (await db_session.execute(stmt)).scalars().first()
    identity.revoked_at = datetime.utcnow()
    await db_session.commit()

    with patch("app.modules.git_gateway.service.asyncio.create_subprocess_exec") as mock_exec:
        proc = AsyncMock()
        proc.communicate = AsyncMock(return_value=(b"ok\n", b""))
        proc.returncode = 0
        mock_exec.return_value = proc

        resp = await client.post(
            f"/api/worktrees/{refs['lease_id']}/git",
            json={"operation": "status", "args": []},
            headers=_auth(refs["token"]),
        )
    assert resp.status_code == 200

    call_kwargs = mock_exec.call_args.kwargs
    env = call_kwargs["env"]
    assert env["GIT_AUTHOR_NAME"] == "SillyHub Agent"
    assert env["GIT_AUTHOR_EMAIL"] == "agent@sillyhub.local"


async def test_list_git_operations_empty(client, db_session):
    refs = await _setup_active_lease(db_session)
    resp = await client.get(
        "/api/git/operations",
        headers=_auth(refs["token"]),
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] == 0
    assert body["items"] == []
    assert body["page"] == 1
    assert body["page_size"] == 20


async def test_list_git_operations_with_data(client, db_session, mock_repo_dir):
    refs = await _setup_active_lease(db_session)

    # Create a log entry via the execute endpoint
    with patch("app.modules.git_gateway.service.asyncio.create_subprocess_exec") as mock_exec:
        proc = AsyncMock()
        proc.communicate = AsyncMock(return_value=(b"ok\n", b""))
        proc.returncode = 0
        mock_exec.return_value = proc

        await client.post(
            f"/api/worktrees/{refs['lease_id']}/git",
            json={"operation": "status", "args": []},
            headers=_auth(refs["token"]),
        )

    # Now list
    resp = await client.get(
        "/api/git/operations",
        headers=_auth(refs["token"]),
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] >= 1
    assert len(body["items"]) >= 1
    item = body["items"][0]
    assert item["operation"] == "status"
    assert item["workspace_id"] == str(refs["ws_id"])
    assert item["lease_id"] == str(refs["lease_id"])


async def test_list_git_operations_filter_by_workspace(client, db_session, mock_repo_dir):
    refs = await _setup_active_lease(db_session)

    resp = await client.get(
        f"/api/git/operations?workspace_id={refs['ws_id']}",
        headers=_auth(refs["token"]),
    )
    assert resp.status_code == 200
    assert resp.json()["total"] == 0


async def test_list_git_operations_filter_by_lease(client, db_session, mock_repo_dir):
    refs = await _setup_active_lease(db_session)

    resp = await client.get(
        f"/api/git/operations?lease_id={refs['lease_id']}",
        headers=_auth(refs["token"]),
    )
    assert resp.status_code == 200
    assert resp.json()["total"] == 0


async def test_list_git_operations_pagination(client, db_session):
    refs = await _setup_active_lease(db_session)
    resp = await client.get(
        "/api/git/operations?page=1&page_size=5",
        headers=_auth(refs["token"]),
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["page"] == 1
    assert body["page_size"] == 5
