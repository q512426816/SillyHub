"""Tests for AgentService.submit_run_input() — user input logging & SSE push.

Covers:
- AC-02: pending/running run writes AgentRunLog(channel="user_input")
- AC-03: Redis publish payload matches SSE replay format
- AC-04: run not found / cross-workspace -> AgentRunNotFound
- AC-05: terminal status -> AgentRunNotRunning
- AC-06: blank / too-long content -> AgentRunError
- AC-07: content redacted before persist and publish
- AC-08: Redis publish failure does not affect persisted log
"""

from __future__ import annotations

import json
import uuid
from datetime import datetime
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AgentRunNotFound, AgentRunNotRunning
from app.modules.agent.model import AgentRun, AgentRunLog
from app.modules.agent.service import (
    MAX_USER_INPUT_CHARS,
    USER_INPUT_CHANNEL,
    AgentRunError,
    AgentService,
)
from app.modules.workspace.model import AgentRunWorkspace, Workspace

# ── Helpers ──────────────────────────────────────────────────────────────────


async def _create_workspace(session: AsyncSession, name: str) -> Workspace:
    ws = Workspace(
        id=uuid.uuid4(),
        name=name,
        slug=name.lower().replace(" ", "-"),
        root_path=f"/{name.lower()}",
        status="active",
    )
    session.add(ws)
    await session.commit()
    await session.refresh(ws)
    return ws


async def _create_run(
    session: AsyncSession,
    *,
    status: str = "running",
) -> AgentRun:
    run = AgentRun(
        id=uuid.uuid4(),
        agent_type="claude_code",
        status=status,
    )
    session.add(run)
    await session.commit()
    await session.refresh(run)
    return run


async def _link_run_to_workspace(
    session: AsyncSession,
    run_id: uuid.UUID,
    workspace_id: uuid.UUID,
) -> None:
    arw = AgentRunWorkspace(agent_run_id=run_id, workspace_id=workspace_id)
    session.add(arw)
    await session.commit()


async def _get_user_input_logs(
    session: AsyncSession,
    run_id: uuid.UUID,
) -> list[AgentRunLog]:
    stmt = (
        select(AgentRunLog)
        .where(
            AgentRunLog.run_id == run_id,
            AgentRunLog.channel == USER_INPUT_CHANNEL,
        )
        .order_by(AgentRunLog.timestamp)
    )
    return list((await session.execute(stmt)).scalars().all())


# ── AC-02: persist user_input log ───────────────────────────────────────────


async def test_submit_run_input_persists_user_input_log(
    db_session: AsyncSession,
) -> None:
    """Valid input on a running run writes a user_input log entry."""
    ws = await _create_workspace(db_session, "WS1")
    run = await _create_run(db_session, status="running")
    await _link_run_to_workspace(db_session, run.id, ws.id)

    svc = AgentService(db_session)
    result = await svc.submit_run_input(
        workspace_id=ws.id,
        run_id=run.id,
        content="Use sensible defaults and continue scan.",
    )

    assert result.channel == USER_INPUT_CHANNEL
    assert "Use sensible defaults and continue scan." in (result.content_redacted or "")

    logs = await _get_user_input_logs(db_session, run.id)
    assert len(logs) == 1
    assert logs[0].id == result.id


# ── AC-03: Redis publish matches SSE format ──────────────────────────────────


async def test_submit_run_input_publishes_sse_payload(
    db_session: AsyncSession,
) -> None:
    """After DB commit, publish to agent_run:{run_id} with correct payload."""
    ws = await _create_workspace(db_session, "WS1")
    run = await _create_run(db_session, status="running")
    await _link_run_to_workspace(db_session, run.id, ws.id)

    mock_redis = AsyncMock()
    mock_redis.publish = AsyncMock()

    with patch("app.modules.agent.service.get_redis", return_value=mock_redis):
        svc = AgentService(db_session)
        await svc.submit_run_input(
            workspace_id=ws.id,
            run_id=run.id,
            content="Use sensible defaults and continue scan.",
        )

    mock_redis.publish.assert_awaited_once()
    call_args = mock_redis.publish.call_args
    channel_name = call_args[0][0]
    payload_str = call_args[0][1]

    assert channel_name == f"agent_run:{run.id}"

    payload = json.loads(payload_str)
    assert payload["channel"] == USER_INPUT_CHANNEL
    assert "sensible defaults" in payload["content"]
    assert "timestamp" in payload

    # Verify timestamp is a valid ISO format
    datetime.fromisoformat(payload["timestamp"])


# ── AC-04: run not found / cross-workspace ────────────────────────────────────


async def test_submit_run_input_rejects_missing_run(
    db_session: AsyncSession,
) -> None:
    """Non-existent run_id raises AgentRunNotFound."""
    ws = await _create_workspace(db_session, "WS1")

    svc = AgentService(db_session)
    with pytest.raises(AgentRunNotFound) as exc_info:
        await svc.submit_run_input(
            workspace_id=ws.id,
            run_id=uuid.uuid4(),
            content="Some input",
        )

    assert "run_id" in str(exc_info.value.details)


async def test_submit_run_input_rejects_cross_workspace_run(
    db_session: AsyncSession,
) -> None:
    """Run exists but belongs to a different workspace -> AgentRunNotFound."""
    ws1 = await _create_workspace(db_session, "WS1")
    ws2 = await _create_workspace(db_session, "WS2")
    run = await _create_run(db_session, status="running")
    await _link_run_to_workspace(db_session, run.id, ws1.id)

    svc = AgentService(db_session)
    with pytest.raises(AgentRunNotFound):
        await svc.submit_run_input(
            workspace_id=ws2.id,
            run_id=run.id,
            content="Some input",
        )

    # No log should have been written
    logs = await _get_user_input_logs(db_session, run.id)
    assert len(logs) == 0


# ── AC-05: terminal status rejected ──────────────────────────────────────────


async def test_submit_run_input_rejects_terminal_status(
    db_session: AsyncSession,
) -> None:
    """Terminal run status raises AgentRunNotRunning."""
    ws = await _create_workspace(db_session, "WS1")
    run = await _create_run(db_session, status="completed")
    await _link_run_to_workspace(db_session, run.id, ws.id)

    svc = AgentService(db_session)
    with pytest.raises(AgentRunNotRunning) as exc_info:
        await svc.submit_run_input(
            workspace_id=ws.id,
            run_id=run.id,
            content="Some input",
        )

    assert exc_info.value.details is not None
    assert exc_info.value.details.get("status") == "completed"

    # No log should have been written
    logs = await _get_user_input_logs(db_session, run.id)
    assert len(logs) == 0


async def test_submit_run_input_rejects_failed_status(
    db_session: AsyncSession,
) -> None:
    """Failed run status raises AgentRunNotRunning."""
    ws = await _create_workspace(db_session, "WS1")
    run = await _create_run(db_session, status="failed")
    await _link_run_to_workspace(db_session, run.id, ws.id)

    svc = AgentService(db_session)
    with pytest.raises(AgentRunNotRunning):
        await svc.submit_run_input(
            workspace_id=ws.id,
            run_id=run.id,
            content="Some input",
        )


async def test_submit_run_input_rejects_killed_status(
    db_session: AsyncSession,
) -> None:
    """Killed run status raises AgentRunNotRunning."""
    ws = await _create_workspace(db_session, "WS1")
    run = await _create_run(db_session, status="killed")
    await _link_run_to_workspace(db_session, run.id, ws.id)

    svc = AgentService(db_session)
    with pytest.raises(AgentRunNotRunning):
        await svc.submit_run_input(
            workspace_id=ws.id,
            run_id=run.id,
            content="Some input",
        )


# ── AC-06: blank / too-long content ──────────────────────────────────────────


async def test_submit_run_input_rejects_blank_content(
    db_session: AsyncSession,
) -> None:
    """Empty/whitespace content raises AgentRunError without side effects."""
    ws = await _create_workspace(db_session, "WS1")
    run = await _create_run(db_session, status="running")
    await _link_run_to_workspace(db_session, run.id, ws.id)

    mock_redis = AsyncMock()
    mock_redis.publish = AsyncMock()

    with patch("app.modules.agent.service.get_redis", return_value=mock_redis):
        svc = AgentService(db_session)
        with pytest.raises(AgentRunError):
            await svc.submit_run_input(
                workspace_id=ws.id,
                run_id=run.id,
                content="   \n\t  ",
            )

    # No log, no Redis publish
    logs = await _get_user_input_logs(db_session, run.id)
    assert len(logs) == 0
    mock_redis.publish.assert_not_awaited()


async def test_submit_run_input_rejects_too_long_content(
    db_session: AsyncSession,
) -> None:
    """Content exceeding MAX_USER_INPUT_CHARS raises AgentRunError."""
    ws = await _create_workspace(db_session, "WS1")
    run = await _create_run(db_session, status="running")
    await _link_run_to_workspace(db_session, run.id, ws.id)

    mock_redis = AsyncMock()
    mock_redis.publish = AsyncMock()

    long_content = "x" * (MAX_USER_INPUT_CHARS + 1)

    with patch("app.modules.agent.service.get_redis", return_value=mock_redis):
        svc = AgentService(db_session)
        with pytest.raises(AgentRunError):
            await svc.submit_run_input(
                workspace_id=ws.id,
                run_id=run.id,
                content=long_content,
            )

    logs = await _get_user_input_logs(db_session, run.id)
    assert len(logs) == 0
    mock_redis.publish.assert_not_awaited()


# ── AC-07: content redacted before persist and publish ────────────────────────


async def test_submit_run_input_redacts_content_before_persist_and_publish(
    db_session: AsyncSession,
) -> None:
    """Sensitive tokens are redacted from both DB and Redis payload."""
    ws = await _create_workspace(db_session, "WS1")
    run = await _create_run(db_session, status="running")
    await _link_run_to_workspace(db_session, run.id, ws.id)

    mock_redis = AsyncMock()
    mock_redis.publish = AsyncMock()

    sensitive_content = "My token is ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890"

    with patch("app.modules.agent.service.get_redis", return_value=mock_redis):
        svc = AgentService(db_session)
        result = await svc.submit_run_input(
            workspace_id=ws.id,
            run_id=run.id,
            content=sensitive_content,
        )

    # DB: content_redacted should not contain the raw token
    assert "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ" not in (result.content_redacted or "")
    assert "REDACTED" in (result.content_redacted or "")

    # Redis payload should also not contain the raw token
    payload_str = mock_redis.publish.call_args[0][1]
    assert "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ" not in payload_str
    assert "REDACTED" in payload_str


# ── AC-08: Redis failure does not affect persisted log ────────────────────────


async def test_submit_run_input_keeps_log_when_redis_publish_fails(
    db_session: AsyncSession,
) -> None:
    """Redis publish failure is logged but the method still returns the log."""
    ws = await _create_workspace(db_session, "WS1")
    run = await _create_run(db_session, status="running")
    await _link_run_to_workspace(db_session, run.id, ws.id)

    mock_redis = AsyncMock()
    mock_redis.publish = AsyncMock(side_effect=Exception("Redis connection lost"))

    with patch("app.modules.agent.service.get_redis", return_value=mock_redis):
        svc = AgentService(db_session)
        result = await svc.submit_run_input(
            workspace_id=ws.id,
            run_id=run.id,
            content="Continue with defaults.",
        )

    # Method still returns the AgentRunLog
    assert result.channel == USER_INPUT_CHANNEL
    assert "Continue with defaults." in (result.content_redacted or "")

    # Log is persisted in DB
    logs = await _get_user_input_logs(db_session, run.id)
    assert len(logs) == 1


# ── Additional: pending status is accepted ────────────────────────────────────


async def test_submit_run_input_accepts_pending_status(
    db_session: AsyncSession,
) -> None:
    """pending status run should also accept user input."""
    ws = await _create_workspace(db_session, "WS1")
    run = await _create_run(db_session, status="pending")
    await _link_run_to_workspace(db_session, run.id, ws.id)

    mock_redis = AsyncMock()
    mock_redis.publish = AsyncMock()

    with patch("app.modules.agent.service.get_redis", return_value=mock_redis):
        svc = AgentService(db_session)
        result = await svc.submit_run_input(
            workspace_id=ws.id,
            run_id=run.id,
            content="A pending run input",
        )

    assert result.channel == USER_INPUT_CHANNEL
    logs = await _get_user_input_logs(db_session, run.id)
    assert len(logs) == 1
