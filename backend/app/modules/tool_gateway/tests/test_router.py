"""HTTP-level tests for the tool gateway router."""

from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path
from unittest.mock import AsyncMock, patch

from app.modules.tool_gateway.model import ToolOperationLog


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _setup_active_lease(db_session, tmp_path: Path) -> dict:
    """Create workspace, change, task, user, identity, lease + token."""
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
        root_path=str(tmp_path),
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
        change_key="change-tool-001",
        title="Tool Test Change",
        status="in_progress",
        location="local",
        path="changes/local/change-tool-001",
    )
    db_session.add(change)

    task_id = uuid.uuid4()
    task = Task(
        id=task_id,
        workspace_id=ws_id,
        change_id=change_id,
        task_key="task-tool-01",
        title="Tool Test Task",
        status="in_progress",
        allowed_paths=["src/", "tests/"],
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
    lease_path = tmp_path / f"lease-{lease_id.hex[:8]}"
    lease_path.mkdir()
    repo_dir = lease_path / "repo"
    repo_dir.mkdir()
    (repo_dir / "src").mkdir()
    (repo_dir / "tests").mkdir()
    (repo_dir / "src" / "main.py").write_text("print('hello')", encoding="utf-8")
    lease = WorktreeLease(
        id=lease_id,
        workspace_id=ws_id,
        component_id=ws_id,
        change_id=change_id,
        task_id=task_id,
        user_id=user_id,
        run_id=uuid.uuid4(),
        git_identity_id=identity_id,
        path=str(lease_path),
        branch_name="test-branch",
        status="locked",
        locked_at=datetime.now(UTC),
        expires_at=datetime.now(UTC) + timedelta(hours=1),
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
        "lease_path": lease_path,
        "repo_dir": repo_dir,
    }


# ── file_read ────────────────────────────────────────────────────────────────


async def test_file_read_success(client, db_session, tmp_path):
    refs = await _setup_active_lease(db_session, tmp_path)
    resp = await client.post(
        f"/api/worktrees/{refs['lease_id']}/tools",
        json={
            "tool_type": "file_read",
            "params": {"path": "src/main.py"},
        },
        headers=_auth(refs["token"]),
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["result_code"] == 0
    assert "hello" in body["redacted_output"]


async def test_file_read_not_found(client, db_session, tmp_path):
    refs = await _setup_active_lease(db_session, tmp_path)
    # Path is in allowed_paths (src/) but file doesn't exist
    resp = await client.post(
        f"/api/worktrees/{refs['lease_id']}/tools",
        json={
            "tool_type": "file_read",
            "params": {"path": "src/nonexistent.py"},
        },
        headers=_auth(refs["token"]),
    )
    assert resp.status_code == 200
    assert resp.json()["result_code"] == 1


async def test_file_read_path_traversal_blocked(client, db_session, tmp_path):
    refs = await _setup_active_lease(db_session, tmp_path)
    resp = await client.post(
        f"/api/worktrees/{refs['lease_id']}/tools",
        json={
            "tool_type": "file_read",
            "params": {"path": "../../etc/passwd"},
        },
        headers=_auth(refs["token"]),
    )
    assert resp.status_code == 403


async def test_file_read_allowed_paths_enforced(client, db_session, tmp_path):
    refs = await _setup_active_lease(db_session, tmp_path)
    resp = await client.post(
        f"/api/worktrees/{refs['lease_id']}/tools",
        json={
            "tool_type": "file_read",
            "params": {"path": "secrets/key.pem"},
        },
        headers=_auth(refs["token"]),
    )
    assert resp.status_code == 403


# ── file_write ───────────────────────────────────────────────────────────────


async def test_file_write_success(client, db_session, tmp_path):
    refs = await _setup_active_lease(db_session, tmp_path)
    resp = await client.post(
        f"/api/worktrees/{refs['lease_id']}/tools",
        json={
            "tool_type": "file_write",
            "params": {"path": "src/new_file.py", "content": "x = 1"},
        },
        headers=_auth(refs["token"]),
    )
    assert resp.status_code == 200
    assert resp.json()["result_code"] == 0

    written = refs["repo_dir"] / "src" / "new_file.py"
    assert written.exists()
    assert written.read_text(encoding="utf-8") == "x = 1"


async def test_file_write_path_blocked(client, db_session, tmp_path):
    refs = await _setup_active_lease(db_session, tmp_path)
    resp = await client.post(
        f"/api/worktrees/{refs['lease_id']}/tools",
        json={
            "tool_type": "file_write",
            "params": {"path": "etc/evil.sh", "content": "bad"},
        },
        headers=_auth(refs["token"]),
    )
    assert resp.status_code == 403


# ── file_list ────────────────────────────────────────────────────────────────


async def test_file_list_success(client, db_session, tmp_path):
    refs = await _setup_active_lease(db_session, tmp_path)
    resp = await client.post(
        f"/api/worktrees/{refs['lease_id']}/tools",
        json={
            "tool_type": "file_list",
            "params": {"path": "src"},
        },
        headers=_auth(refs["token"]),
    )
    assert resp.status_code == 200
    assert resp.json()["result_code"] == 0
    assert "main.py" in resp.json()["redacted_output"]


async def test_file_list_recursive(client, db_session, tmp_path):
    refs = await _setup_active_lease(db_session, tmp_path)
    resp = await client.post(
        f"/api/worktrees/{refs['lease_id']}/tools",
        json={
            "tool_type": "file_list",
            "params": {"path": "src", "recursive": True},
        },
        headers=_auth(refs["token"]),
    )
    assert resp.status_code == 200
    output = resp.json()["redacted_output"]
    assert "main.py" in output


# ── file_search ──────────────────────────────────────────────────────────────


async def test_file_search_success(client, db_session, tmp_path):
    refs = await _setup_active_lease(db_session, tmp_path)
    resp = await client.post(
        f"/api/worktrees/{refs['lease_id']}/tools",
        json={
            "tool_type": "file_search",
            "params": {"path": "src", "pattern": "main"},
        },
        headers=_auth(refs["token"]),
    )
    assert resp.status_code == 200
    assert resp.json()["result_code"] == 0
    assert "main.py" in resp.json()["redacted_output"]


async def test_file_search_no_pattern(client, db_session, tmp_path):
    refs = await _setup_active_lease(db_session, tmp_path)
    resp = await client.post(
        f"/api/worktrees/{refs['lease_id']}/tools",
        json={
            "tool_type": "file_search",
            "params": {"path": "src", "pattern": ""},
        },
        headers=_auth(refs["token"]),
    )
    assert resp.status_code == 200
    assert resp.json()["result_code"] == 1


# ── shell_exec ───────────────────────────────────────────────────────────────


async def test_shell_exec_success(client, db_session, tmp_path):
    refs = await _setup_active_lease(db_session, tmp_path)
    with patch("app.modules.tool_gateway.service.asyncio.create_subprocess_exec") as mock_exec:
        proc = AsyncMock()
        proc.communicate = AsyncMock(return_value=(b"hello world\n", b""))
        proc.returncode = 0
        mock_exec.return_value = proc

        resp = await client.post(
            f"/api/worktrees/{refs['lease_id']}/tools",
            json={
                "tool_type": "shell_exec",
                "params": {"command": "echo", "args": ["hello"]},
            },
            headers=_auth(refs["token"]),
        )
    assert resp.status_code == 200
    assert resp.json()["result_code"] == 0
    assert "hello world" in resp.json()["redacted_output"]


async def test_shell_exec_blocked_command(client, db_session, tmp_path):
    refs = await _setup_active_lease(db_session, tmp_path)
    resp = await client.post(
        f"/api/worktrees/{refs['lease_id']}/tools",
        json={
            "tool_type": "shell_exec",
            "params": {"command": "sudo", "args": ["rm", "-rf", "/"]},
        },
        headers=_auth(refs["token"]),
    )
    assert resp.status_code == 403


async def test_shell_exec_pat_redacted(client, db_session, tmp_path):
    refs = await _setup_active_lease(db_session, tmp_path)
    with patch("app.modules.tool_gateway.service.asyncio.create_subprocess_exec") as mock_exec:
        proc = AsyncMock()
        proc.communicate = AsyncMock(
            return_value=(b"token: ghp_AbCdEf1234567890abcdefghijklmn\n", b""),
        )
        proc.returncode = 0
        mock_exec.return_value = proc

        resp = await client.post(
            f"/api/worktrees/{refs['lease_id']}/tools",
            json={
                "tool_type": "shell_exec",
                "params": {"command": "cat", "args": [".env"]},
            },
            headers=_auth(refs["token"]),
        )
    assert resp.status_code == 200
    assert "ghp_AbCdEf" not in resp.json()["redacted_output"]


# ── auth & lease checks ─────────────────────────────────────────────────────


async def test_no_auth_returns_401(client, db_session, tmp_path):
    refs = await _setup_active_lease(db_session, tmp_path)
    resp = await client.post(
        f"/api/worktrees/{refs['lease_id']}/tools",
        json={
            "tool_type": "file_read",
            "params": {"path": "src/main.py"},
        },
    )
    assert resp.status_code == 401


async def test_unknown_lease_returns_404(client, db_session, tmp_path):
    refs = await _setup_active_lease(db_session, tmp_path)
    fake_lease = uuid.uuid4()
    resp = await client.post(
        f"/api/worktrees/{fake_lease}/tools",
        json={
            "tool_type": "file_read",
            "params": {"path": "src/main.py"},
        },
        headers=_auth(refs["token"]),
    )
    assert resp.status_code == 404


async def test_unknown_tool_type_returns_422(client, db_session, tmp_path):
    """Literal tool_type validation produces 422 from Pydantic."""
    refs = await _setup_active_lease(db_session, tmp_path)
    resp = await client.post(
        f"/api/worktrees/{refs['lease_id']}/tools",
        json={
            "tool_type": "web_fetch",
            "params": {"url": "https://evil.com"},
        },
        headers=_auth(refs["token"]),
    )
    assert resp.status_code == 422


# ── audit log ────────────────────────────────────────────────────────────────


async def test_tool_operation_log_written(client, db_session, tmp_path):
    refs = await _setup_active_lease(db_session, tmp_path)
    resp = await client.post(
        f"/api/worktrees/{refs['lease_id']}/tools",
        json={
            "tool_type": "file_read",
            "params": {"path": "src/main.py"},
        },
        headers=_auth(refs["token"]),
    )
    assert resp.status_code == 200

    from sqlalchemy import select

    stmt = select(ToolOperationLog).where(
        ToolOperationLog.lease_id == refs["lease_id"],
    )
    logs = list((await db_session.execute(stmt)).scalars().all())
    assert len(logs) == 1
    assert logs[0].tool_type == "file_read"
    assert logs[0].result_code == 0
    assert logs[0].workspace_id == refs["ws_id"]
    assert logs[0].params_json is not None
    assert "src/main.py" in json.loads(logs[0].params_json)["path"]
