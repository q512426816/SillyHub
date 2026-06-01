"""HTTP-level tests for agent router — uses mock subprocess."""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta
from unittest.mock import AsyncMock, patch

from app.core.security import password_hasher
from app.modules.auth.model import User
from app.modules.change.model import Change
from app.modules.git_identity.model import GitIdentity
from app.modules.task.model import Task
from app.modules.workspace.model import Workspace
from app.modules.worktree.model import WorktreeLease


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _setup(db_session, tmp_path) -> dict:
    """Create workspace, change, task, user, lease + token."""
    ws_id = uuid.uuid4()
    ws = Workspace(
        id=ws_id,
        name="Test WS",
        slug=f"test-ws-{ws_id.hex[:8]}",
        root_path=str(tmp_path),
        status="active",
    )
    db_session.add(ws)

    change_id = uuid.uuid4()
    change = Change(
        id=change_id,
        workspace_id=ws_id,
        change_key="test-agent-change",
        title="Agent Test",
        status="in_progress",
        location="change",
        path=".sillyspec/changes/change/test-agent-change",
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
        allowed_paths=["src/"],
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
        "lease_id": lease_id,
        "token": token,
        "lease_path": lease_path,
    }


async def test_create_agent_run_success(client, db_session, tmp_path):
    refs = await _setup(db_session, tmp_path)

    # Mock the adapter to avoid needing real claude CLI.
    # The service now calls run_with_bundle (not run), so we patch that.
    mock_result = AsyncMock()
    mock_result.exit_code = 0
    mock_result.stdout = "Task completed successfully"
    mock_result.stderr = ""
    mock_result.redacted_output = "Task completed successfully"
    mock_result.timed_out = False

    with patch(
        "app.modules.agent.adapters.claude_code.ClaudeCodeAdapter.run_with_bundle",
        return_value=mock_result,
    ):
        resp = await client.post(
            f"/api/workspaces/{refs['ws_id']}/agent/runs",
            json={
                "task_id": str(refs["task_id"]),
                "lease_id": str(refs["lease_id"]),
                "agent_type": "claude_code",
            },
            headers=_auth(refs["token"]),
        )
    assert resp.status_code == 201, f"Expected 201, got {resp.status_code}: {resp.text}"
    body = resp.json()
    assert body["status"] == "completed"
    assert body["exit_code"] == 0
    assert body["agent_type"] == "claude_code"

    # Verify CLAUDE.md was written
    claude_md = refs["lease_path"] / "CLAUDE.md"
    assert claude_md.exists()
    content = claude_md.read_text(encoding="utf-8")
    assert "Test Task" in content


async def test_create_agent_run_no_auth(client, db_session, tmp_path):
    refs = await _setup(db_session, tmp_path)
    resp = await client.post(
        f"/api/workspaces/{refs['ws_id']}/agent/runs",
        json={
            "task_id": str(refs["task_id"]),
            "lease_id": str(refs["lease_id"]),
        },
    )
    assert resp.status_code == 401


async def test_create_agent_run_invalid_lease(client, db_session, tmp_path):
    refs = await _setup(db_session, tmp_path)
    fake_lease = uuid.uuid4()
    resp = await client.post(
        f"/api/workspaces/{refs['ws_id']}/agent/runs",
        json={
            "task_id": str(refs["task_id"]),
            "lease_id": str(fake_lease),
        },
        headers=_auth(refs["token"]),
    )
    assert resp.status_code == 404


async def test_create_agent_run_invalid_task(client, db_session, tmp_path):
    refs = await _setup(db_session, tmp_path)
    fake_task = uuid.uuid4()
    resp = await client.post(
        f"/api/workspaces/{refs['ws_id']}/agent/runs",
        json={
            "task_id": str(fake_task),
            "lease_id": str(refs["lease_id"]),
        },
        headers=_auth(refs["token"]),
    )
    assert resp.status_code == 404


async def test_get_agent_run(client, db_session, tmp_path):
    refs = await _setup(db_session, tmp_path)

    mock_result = AsyncMock()
    mock_result.exit_code = 0
    mock_result.stdout = "ok"
    mock_result.stderr = ""
    mock_result.redacted_output = "ok"
    mock_result.timed_out = False

    with patch(
        "app.modules.agent.adapters.claude_code.ClaudeCodeAdapter.run_with_bundle",
        return_value=mock_result,
    ):
        create_resp = await client.post(
            f"/api/workspaces/{refs['ws_id']}/agent/runs",
            json={
                "task_id": str(refs["task_id"]),
                "lease_id": str(refs["lease_id"]),
            },
            headers=_auth(refs["token"]),
        )
    run_id = create_resp.json()["id"]

    resp = await client.get(
        f"/api/workspaces/{refs['ws_id']}/agent/runs/{run_id}",
        headers=_auth(refs["token"]),
    )
    assert resp.status_code == 200
    assert resp.json()["id"] == run_id


async def test_get_agent_run_not_found(client, db_session, tmp_path):
    refs = await _setup(db_session, tmp_path)
    fake_id = uuid.uuid4()
    resp = await client.get(
        f"/api/workspaces/{refs['ws_id']}/agent/runs/{fake_id}",
        headers=_auth(refs["token"]),
    )
    assert resp.status_code == 404  # AgentRunNotFound -> 404


async def test_get_agent_run_logs(client, db_session, tmp_path):
    refs = await _setup(db_session, tmp_path)

    mock_result = AsyncMock()
    mock_result.exit_code = 0
    mock_result.stdout = "output line"
    mock_result.stderr = "error line"
    mock_result.redacted_output = "output line\nerror line"
    mock_result.timed_out = False

    with patch(
        "app.modules.agent.adapters.claude_code.ClaudeCodeAdapter.run_with_bundle",
        return_value=mock_result,
    ):
        create_resp = await client.post(
            f"/api/workspaces/{refs['ws_id']}/agent/runs",
            json={
                "task_id": str(refs["task_id"]),
                "lease_id": str(refs["lease_id"]),
            },
            headers=_auth(refs["token"]),
        )
    run_id = create_resp.json()["id"]

    resp = await client.get(
        f"/api/workspaces/{refs['ws_id']}/agent/runs/{run_id}/logs",
        headers=_auth(refs["token"]),
    )
    assert resp.status_code == 200
    logs = resp.json()
    assert len(logs) >= 1


async def test_list_task_agent_runs(client, db_session, tmp_path):
    refs = await _setup(db_session, tmp_path)

    mock_result = AsyncMock()
    mock_result.exit_code = 0
    mock_result.stdout = "done"
    mock_result.stderr = ""
    mock_result.redacted_output = "done"
    mock_result.timed_out = False

    with patch(
        "app.modules.agent.adapters.claude_code.ClaudeCodeAdapter.run_with_bundle",
        return_value=mock_result,
    ):
        await client.post(
            f"/api/workspaces/{refs['ws_id']}/agent/runs",
            json={
                "task_id": str(refs["task_id"]),
                "lease_id": str(refs["lease_id"]),
            },
            headers=_auth(refs["token"]),
        )

    resp = await client.get(
        f"/api/workspaces/{refs['ws_id']}/tasks/{refs['task_id']}/agent/runs",
        headers=_auth(refs["token"]),
    )
    assert resp.status_code == 200
    assert len(resp.json()) >= 1


async def test_agent_run_audit_logged(client, db_session, tmp_path):
    refs = await _setup(db_session, tmp_path)

    mock_result = AsyncMock()
    mock_result.exit_code = 0
    mock_result.stdout = "ok"
    mock_result.stderr = ""
    mock_result.redacted_output = "ok"
    mock_result.timed_out = False

    with patch(
        "app.modules.agent.adapters.claude_code.ClaudeCodeAdapter.run_with_bundle",
        return_value=mock_result,
    ):
        await client.post(
            f"/api/workspaces/{refs['ws_id']}/agent/runs",
            json={
                "task_id": str(refs["task_id"]),
                "lease_id": str(refs["lease_id"]),
            },
            headers=_auth(refs["token"]),
        )

    resp = await client.get(
        f"/api/workspaces/{refs['ws_id']}/audit",
        headers=_auth(refs["token"]),
    )
    assert resp.status_code == 200
    actions = [e["action"] for e in resp.json()]
    assert "agent.run" in actions


# ---------------------------------------------------------------------------
# SSE streaming endpoint tests
# ---------------------------------------------------------------------------


async def test_stream_completed_run_returns_done(client, db_session, tmp_path):
    """AC-03: Non-running run immediately returns event: done."""
    refs = await _setup(db_session, tmp_path)

    mock_result = AsyncMock()
    mock_result.exit_code = 0
    mock_result.stdout = "ok"
    mock_result.stderr = ""
    mock_result.redacted_output = "ok"
    mock_result.timed_out = False

    with patch(
        "app.modules.agent.adapters.claude_code.ClaudeCodeAdapter.run_with_bundle",
        return_value=mock_result,
    ):
        create_resp = await client.post(
            f"/api/workspaces/{refs['ws_id']}/agent/runs",
            json={
                "task_id": str(refs["task_id"]),
                "lease_id": str(refs["lease_id"]),
            },
            headers=_auth(refs["token"]),
        )
    run_id = create_resp.json()["id"]

    resp = await client.get(
        f"/api/workspaces/{refs['ws_id']}/agent/runs/{run_id}/stream",
        headers=_auth(refs["token"]),
    )
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "text/event-stream; charset=utf-8"
    assert "event: done" in resp.text
    assert "data: {}" in resp.text


async def test_stream_not_found_run(client, db_session, tmp_path):
    """AC-05: Missing run returns 404."""
    refs = await _setup(db_session, tmp_path)
    fake_id = uuid.uuid4()
    resp = await client.get(
        f"/api/workspaces/{refs['ws_id']}/agent/runs/{fake_id}/stream",
        headers=_auth(refs["token"]),
    )
    assert resp.status_code == 404


async def test_stream_no_auth(client, db_session, tmp_path):
    """AC-06: No auth token returns 401."""
    refs = await _setup(db_session, tmp_path)
    fake_id = uuid.uuid4()
    resp = await client.get(
        f"/api/workspaces/{refs['ws_id']}/agent/runs/{fake_id}/stream",
    )
    assert resp.status_code == 401


async def test_stream_running_run_sse_data_events(db_session):
    """AC-01: stream_run_logs yields data events from Redis pubsub."""
    import json
    from unittest.mock import MagicMock

    from app.modules.agent.model import AgentRun
    from app.modules.agent.service import AgentService

    run_id = uuid.uuid4()
    run = AgentRun(
        id=run_id,
        task_id=uuid.uuid4(),
        lease_id=uuid.uuid4(),
        agent_type="claude_code",
        status="running",
        started_at=datetime.utcnow(),
    )
    db_session.add(run)
    await db_session.commit()

    messages = [
        {"type": "message", "data": json.dumps({"text": "line 1"})},
        {"type": "message", "data": json.dumps({"text": "line 2"})},
        {"type": "message", "data": json.dumps({"event": "done"})},
    ]
    msg_iter = iter(messages)

    mock_pubsub = MagicMock()
    mock_pubsub.subscribe = AsyncMock()
    mock_pubsub.unsubscribe = AsyncMock()
    mock_pubsub.close = AsyncMock()

    async def fake_get_message(timeout=None):
        return next(msg_iter)

    mock_pubsub.get_message = fake_get_message

    mock_redis = MagicMock()
    mock_redis.pubsub.return_value = mock_pubsub

    svc = AgentService(db_session)
    collected = []
    with patch("app.modules.agent.service.get_redis", return_value=mock_redis):
        async for event in svc.stream_run_logs(run_id):
            collected.append(event)

    assert 'data: {"text": "line 1"}\n\n' in collected
    assert 'data: {"text": "line 2"}\n\n' in collected
    assert "event: done\ndata: {}\n\n" in collected
    mock_pubsub.unsubscribe.assert_called_once()
    mock_pubsub.close.assert_called_once()


async def test_stream_done_event_closes(db_session):
    """AC-02: Receiving done message yields event: done and stops iteration."""
    import json
    from unittest.mock import MagicMock

    from app.modules.agent.model import AgentRun
    from app.modules.agent.service import AgentService

    run_id = uuid.uuid4()
    run = AgentRun(
        id=run_id,
        task_id=uuid.uuid4(),
        lease_id=uuid.uuid4(),
        agent_type="claude_code",
        status="running",
        started_at=datetime.utcnow(),
    )
    db_session.add(run)
    await db_session.commit()

    done_msg = {"type": "message", "data": json.dumps({"event": "done"})}
    mock_pubsub = MagicMock()
    mock_pubsub.subscribe = AsyncMock()
    mock_pubsub.unsubscribe = AsyncMock()
    mock_pubsub.close = AsyncMock()
    mock_pubsub.get_message = AsyncMock(return_value=done_msg)

    mock_redis = MagicMock()
    mock_redis.pubsub.return_value = mock_pubsub

    svc = AgentService(db_session)
    collected = []
    with patch("app.modules.agent.service.get_redis", return_value=mock_redis):
        async for event in svc.stream_run_logs(run_id):
            collected.append(event)

    assert "event: done\ndata: {}\n\n" in collected
    mock_pubsub.unsubscribe.assert_called_once()
    mock_pubsub.close.assert_called_once()


async def test_stream_keepalive_on_no_message(db_session):
    """AC-04: asyncio.TimeoutError triggers keepalive comment."""
    import json
    from unittest.mock import MagicMock

    from app.modules.agent.model import AgentRun
    from app.modules.agent.service import AgentService

    run_id = uuid.uuid4()
    run = AgentRun(
        id=run_id,
        task_id=uuid.uuid4(),
        lease_id=uuid.uuid4(),
        agent_type="claude_code",
        status="running",
        started_at=datetime.utcnow(),
    )
    db_session.add(run)
    await db_session.commit()

    call_count = 0
    done_msg = {"type": "message", "data": json.dumps({"event": "done"})}

    mock_pubsub = MagicMock()
    mock_pubsub.subscribe = AsyncMock()
    mock_pubsub.unsubscribe = AsyncMock()
    mock_pubsub.close = AsyncMock()

    async def fake_get_message(timeout=None):
        nonlocal call_count
        call_count += 1
        if call_count <= 2:
            raise TimeoutError()
        return done_msg

    mock_pubsub.get_message = fake_get_message

    mock_redis = MagicMock()
    mock_redis.pubsub.return_value = mock_pubsub

    svc = AgentService(db_session)
    collected = []
    with patch("app.modules.agent.service.get_redis", return_value=mock_redis):
        async for event in svc.stream_run_logs(run_id):
            collected.append(event)

    assert ": keepalive\n\n" in collected
    assert "event: done\ndata: {}\n\n" in collected


async def test_stream_redis_error_sends_error_event(db_session):
    """Boundary: Redis connection failure sends error event then closes."""
    from unittest.mock import MagicMock

    from app.modules.agent.model import AgentRun
    from app.modules.agent.service import AgentService

    run_id = uuid.uuid4()
    run = AgentRun(
        id=run_id,
        task_id=uuid.uuid4(),
        lease_id=uuid.uuid4(),
        agent_type="claude_code",
        status="running",
        started_at=datetime.utcnow(),
    )
    db_session.add(run)
    await db_session.commit()

    mock_pubsub = MagicMock()
    mock_pubsub.subscribe = AsyncMock(side_effect=ConnectionRefusedError("redis down"))
    mock_pubsub.unsubscribe = AsyncMock()
    mock_pubsub.close = AsyncMock()

    mock_redis = MagicMock()
    mock_redis.pubsub.return_value = mock_pubsub

    svc = AgentService(db_session)
    collected = []
    with patch("app.modules.agent.service.get_redis", return_value=mock_redis):
        async for event in svc.stream_run_logs(run_id):
            collected.append(event)

    assert len(collected) == 1
    assert "event: error" in collected[0]
    assert "redis connection failed" in collected[0]
