"""HTTP smoke tests for POST /workspaces/{ws}/agent/runs/{run}/input endpoint.

Complements test_run_input_service.py (which covers the service method in
depth) — these tests verify the router wiring: auth, error mapping,
happy-path response shape. ql-20260617-005 restored this endpoint after
cf71836 accidentally removed it.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock, patch

from app.core.security import password_hasher
from app.modules.agent.model import AgentRun
from app.modules.auth.model import User
from app.modules.workspace.model import AgentRunWorkspace, Workspace


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _setup(db_session, tmp_path, *, run_status: str = "running") -> dict:
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

    run_id = uuid.uuid4()
    run = AgentRun(
        id=run_id,
        agent_type="claude_code",
        status=run_status,
        started_at=datetime.now(UTC) if run_status != "pending" else None,
    )
    db_session.add(run)

    db_session.add(AgentRunWorkspace(agent_run_id=run_id, workspace_id=ws_id))
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
        "run_id": run_id,
        "user_id": user_id,
        "token": token,
    }


async def test_input_endpoint_happy_path(client, db_session, tmp_path):
    """200 OK + accepted=True + AgentRunLog persisted."""
    refs = await _setup(db_session, tmp_path)
    mock_redis = MagicMock()
    mock_redis.publish = AsyncMock()
    with patch("app.modules.agent.service.get_redis", return_value=mock_redis):
        resp = await client.post(
            f"/api/workspaces/{refs['ws_id']}/agent/runs/{refs['run_id']}/input",
            json={"content": "请使用 React 而非 Vue"},
            headers=_auth(refs["token"]),
        )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["run_id"] == str(refs["run_id"])
    assert body["accepted"] is True
    mock_redis.publish.assert_awaited_once()


async def test_input_endpoint_no_auth_401(client, db_session, tmp_path):
    """Missing token → 401."""
    refs = await _setup(db_session, tmp_path)
    resp = await client.post(
        f"/api/workspaces/{refs['ws_id']}/agent/runs/{refs['run_id']}/input",
        json={"content": "hello"},
    )
    assert resp.status_code == 401


async def test_input_endpoint_run_not_found_404(client, db_session, tmp_path):
    """Nonexistent run → 404 (AgentRunNotFound)."""
    refs = await _setup(db_session, tmp_path)
    fake_run = uuid.uuid4()
    resp = await client.post(
        f"/api/workspaces/{refs['ws_id']}/agent/runs/{fake_run}/input",
        json={"content": "hello"},
        headers=_auth(refs["token"]),
    )
    assert resp.status_code == 404


async def test_input_endpoint_terminal_status_409(client, db_session, tmp_path):
    """Run in terminal status → 409 (AgentRunNotRunning)."""
    refs = await _setup(db_session, tmp_path, run_status="completed")
    resp = await client.post(
        f"/api/workspaces/{refs['ws_id']}/agent/runs/{refs['run_id']}/input",
        json={"content": "hello"},
        headers=_auth(refs["token"]),
    )
    assert resp.status_code == 409


async def test_input_endpoint_redis_failure_returns_200(client, db_session, tmp_path):
    """Redis publish failure must NOT break the endpoint (logentry still persisted)."""
    refs = await _setup(db_session, tmp_path)
    mock_redis = MagicMock()
    mock_redis.publish = AsyncMock(side_effect=RuntimeError("redis down"))
    with patch("app.modules.agent.service.get_redis", return_value=mock_redis):
        resp = await client.post(
            f"/api/workspaces/{refs['ws_id']}/agent/runs/{refs['run_id']}/input",
            json={"content": "hello"},
            headers=_auth(refs["token"]),
        )
    assert resp.status_code == 200, resp.text
