"""HTTP-level tests for agent router — uses mock subprocess."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, MagicMock, patch

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
        "lease_id": lease_id,
        "token": token,
        "lease_path": lease_path,
    }


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


async def test_get_agent_run_not_found(client, db_session, tmp_path):
    refs = await _setup(db_session, tmp_path)
    fake_id = uuid.uuid4()
    resp = await client.get(
        f"/api/workspaces/{refs['ws_id']}/agent/runs/{fake_id}",
        headers=_auth(refs["token"]),
    )
    assert resp.status_code == 404  # AgentRunNotFound -> 404


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
        started_at=datetime.now(UTC),
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
    assert "event: done" in collected[-1]
    assert '"status"' in collected[-1]
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
        started_at=datetime.now(UTC),
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

    assert "event: done" in collected[-1]
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
        started_at=datetime.now(UTC),
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
    assert "event: done" in collected[-1]


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
        started_at=datetime.now(UTC),
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

    assert len(collected) == 2
    assert collected[0] == ": connected\n\n"
    assert "event: error" in collected[1]
    assert "redis connection failed" in collected[1]


async def test_create_agent_run_passes_provider(client, db_session, tmp_path):
    """task-05: router forwards request body ``provider`` to ``start_run``.

    ``AgentService`` is replaced with a mock so the test only asserts the
    propagation of the provider field; the response status is intentionally
    not checked (mocked enrich output need not satisfy AgentRunResponse).
    """
    refs = await _setup(db_session, tmp_path)
    mock_svc = MagicMock()
    mock_svc.start_run = AsyncMock(return_value=MagicMock(status="pending"))
    mock_svc.enrich_with_workspace_ids = AsyncMock(return_value=MagicMock())
    # The mocked enrich output does not satisfy AgentRunResponse, so the server
    # raises during response serialization. That happens AFTER ``start_run`` has
    # been called (router.py orders start_run before enrich), so the provider
    # propagation is still observable from the recorded call.
    with patch("app.modules.agent.router.AgentService", return_value=mock_svc):
        try:
            await client.post(
                f"/api/workspaces/{refs['ws_id']}/agent/runs",
                json={
                    "task_id": str(refs["task_id"]),
                    "lease_id": str(refs["lease_id"]),
                    "provider": "codex",
                },
                headers=_auth(refs["token"]),
            )
        except Exception:  # ResponseValidationError is expected here
            pass
    assert mock_svc.start_run.call_args.kwargs["provider"] == "codex"


async def test_create_agent_run_passes_agent_profile_id(client, db_session, tmp_path):
    """task-12: router forwards request body ``agent_profile_id`` to ``start_run``.

    Mirrors ``test_create_agent_run_passes_provider``：AgentService mocked，仅断言
    agent_profile_id 透传到 svc.start_run（router → service → resolve_profile 链路）。
    """
    refs = await _setup(db_session, tmp_path)
    profile_id = uuid.uuid4()
    mock_svc = MagicMock()
    mock_svc.start_run = AsyncMock(return_value=MagicMock(status="pending"))
    mock_svc.enrich_with_workspace_ids = AsyncMock(return_value=MagicMock())
    with patch("app.modules.agent.router.AgentService", return_value=mock_svc):
        try:
            await client.post(
                f"/api/workspaces/{refs['ws_id']}/agent/runs",
                json={
                    "task_id": str(refs["task_id"]),
                    "lease_id": str(refs["lease_id"]),
                    "agent_profile_id": str(profile_id),
                },
                headers=_auth(refs["token"]),
            )
        except Exception:  # ResponseValidationError expected（mocked enrich 输出不合规）
            pass
    assert mock_svc.start_run.call_args.kwargs["agent_profile_id"] == profile_id


async def test_create_agent_run_omits_agent_profile_id_when_absent(client, db_session, tmp_path):
    """task-12: 请求体不带 agent_profile_id → start_run 收到 None（FR-15 零回归兜底）。"""
    refs = await _setup(db_session, tmp_path)
    mock_svc = MagicMock()
    mock_svc.start_run = AsyncMock(return_value=MagicMock(status="pending"))
    mock_svc.enrich_with_workspace_ids = AsyncMock(return_value=MagicMock())
    with patch("app.modules.agent.router.AgentService", return_value=mock_svc):
        try:
            await client.post(
                f"/api/workspaces/{refs['ws_id']}/agent/runs",
                json={
                    "task_id": str(refs["task_id"]),
                    "lease_id": str(refs["lease_id"]),
                },
                headers=_auth(refs["token"]),
            )
        except Exception:
            pass
    assert mock_svc.start_run.call_args.kwargs["agent_profile_id"] is None


# ---------------------------------------------------------------------------
# perf-remediation task-08 / FR-10 / D-001@v1：GET logs ?after= 增量游标。
# 语义（勿写反）：after = 前端已见最早一条 timestamp，后端 WHERE timestamp > after
# 返回比游标更新的日志；恰好等于 after 的条目不返回（desc 排序 + 5000 上限不变）。
# ---------------------------------------------------------------------------


async def _seed_run_with_logs(
    db_session, timestamps: list[datetime], workspace_id: uuid.UUID | None = None
) -> uuid.UUID:
    """建一个 running AgentRun + 逐条 AgentRunLog（时间戳给定，正文带序号）。

    workspace_id 给定时建 AgentRunWorkspace 关联——run 级端点有对象级授权
    （_require_run_workspace），未关联的 run 经 workspace 路径访问会 403。
    """
    from app.modules.agent.model import AgentRun, AgentRunLog
    from app.modules.workspace.model import AgentRunWorkspace

    run_id = uuid.uuid4()
    run = AgentRun(
        id=run_id,
        task_id=uuid.uuid4(),
        lease_id=uuid.uuid4(),
        agent_type="claude_code",
        status="running",
        started_at=datetime.now(UTC),
    )
    db_session.add(run)
    if workspace_id is not None:
        db_session.add(AgentRunWorkspace(agent_run_id=run_id, workspace_id=workspace_id))
    for i, ts in enumerate(timestamps):
        db_session.add(
            AgentRunLog(
                run_id=run_id,
                channel="stdout",
                content_redacted=f"line-{i}",
                timestamp=ts,
            )
        )
    await db_session.commit()
    return run_id


async def test_get_agent_run_logs_no_after_returns_all(client, db_session, tmp_path):
    """无 after：行为与现状等价——全量正序返回（既有锚点，零回归兜底）。"""
    base = datetime(2026, 8, 15, 7, 0, 0, tzinfo=UTC)
    ts = [base, base + timedelta(seconds=1), base + timedelta(seconds=2)]
    refs = await _setup(db_session, tmp_path)
    run_id = await _seed_run_with_logs(db_session, ts, workspace_id=refs["ws_id"])

    resp = await client.get(
        f"/api/workspaces/{refs['ws_id']}/agent/runs/{run_id}/logs",
        headers=_auth(refs["token"]),
    )
    assert resp.status_code == 200
    body = resp.json()
    assert [e["content_redacted"] for e in body] == ["line-0", "line-1", "line-2"]


async def test_get_agent_run_logs_after_returns_newer_only(client, db_session, tmp_path):
    """有 after：只返回 timestamp 严格更新的条目（等 after 的一条不返回）。"""
    base = datetime(2026, 8, 15, 7, 0, 0, tzinfo=UTC)
    ts = [base, base + timedelta(seconds=1), base + timedelta(seconds=2)]
    refs = await _setup(db_session, tmp_path)
    run_id = await _seed_run_with_logs(db_session, ts, workspace_id=refs["ws_id"])

    resp = await client.get(
        f"/api/workspaces/{refs['ws_id']}/agent/runs/{run_id}/logs"
        f"?after={base.isoformat().replace('+00:00', 'Z')}",
        headers=_auth(refs["token"]),
    )
    assert resp.status_code == 200
    body = resp.json()
    # line-0 的 timestamp 恰好等于 after → 不返回；只回 line-1/line-2（正序）。
    assert [e["content_redacted"] for e in body] == ["line-1", "line-2"]
    for e in body:
        assert e["timestamp"] > base.isoformat().replace("+00:00", "Z")


async def test_get_agent_run_logs_after_future_returns_empty(client, db_session, tmp_path):
    """after 晚于全部日志 → 空列表（前端据此走 fallback 全量重拉）。"""
    base = datetime(2026, 8, 15, 7, 0, 0, tzinfo=UTC)
    refs = await _setup(db_session, tmp_path)
    run_id = await _seed_run_with_logs(
        db_session, [base, base + timedelta(seconds=1)], workspace_id=refs["ws_id"]
    )
    future = (base + timedelta(hours=1)).isoformat().replace("+00:00", "Z")

    resp = await client.get(
        f"/api/workspaces/{refs['ws_id']}/agent/runs/{run_id}/logs?after={future}",
        headers=_auth(refs["token"]),
    )
    assert resp.status_code == 200
    assert resp.json() == []


async def test_get_agent_run_logs_after_invalid_returns_422(client, db_session, tmp_path):
    """after 非 ISO timestamp → FastAPI 校验 422（datetime 解析失败）。"""
    base = datetime(2026, 8, 15, 7, 0, 0, tzinfo=UTC)
    refs = await _setup(db_session, tmp_path)
    run_id = await _seed_run_with_logs(db_session, [base], workspace_id=refs["ws_id"])

    resp = await client.get(
        f"/api/workspaces/{refs['ws_id']}/agent/runs/{run_id}/logs?after=not-a-timestamp",
        headers=_auth(refs["token"]),
    )
    assert resp.status_code == 422
