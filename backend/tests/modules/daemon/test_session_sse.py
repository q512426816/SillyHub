"""SSE streaming tests for ``AgentService.stream_run_logs``.

Regression coverage for the bug where ``permission_request`` /
``permission_resolved`` events published on the
``agent_session:{session_id}`` Redis channel were never surfaced to the
frontend's AskUserQuestion approval card, because the run-scoped SSE stream
only subscribed to ``agent_run:{run_id}``.

The fix makes ``stream_run_logs`` additionally subscribe to
``agent_session:{agent_session_id}`` for interactive runs (those that carry
an ``agent_session_id``). These tests pin that behaviour using hermetic fakes
for Redis pub/sub and the short-lived DB session factory — no live Redis or
Postgres is required.
"""

from __future__ import annotations

import asyncio
import json
import uuid
from typing import Any

import pytest

from app.modules.agent import service as agent_service
from app.modules.agent.model import AgentRun

# ─── Fakes ────────────────────────────────────────────────────────────────────


class _FakeRun:
    """Minimal stand-in for an AgentRun ORM row.

    Only the attributes read by ``stream_run_logs`` are populated:
    ``status``, ``exit_code`` and ``agent_session_id``.
    """

    def __init__(
        self,
        *,
        status: str = "running",
        exit_code: int | None = None,
        agent_session_id: uuid.UUID | None = None,
    ) -> None:
        self.status = status
        self.exit_code = exit_code
        self.agent_session_id = agent_session_id


class _FakeSession:
    """Async-context-manager DB session that returns a canned AgentRun."""

    def __init__(self, run: _FakeRun | None) -> None:
        self._run = run

    async def get(self, model: Any, _pk: Any) -> Any:
        if model is AgentRun:
            return self._run
        return None

    async def __aenter__(self) -> _FakeSession:
        return self

    async def __aexit__(self, *_exc: Any) -> bool:
        return False


class _FakeSessionFactory:
    """``get_session_factory()`` replacement: calling it returns a session."""

    def __init__(self, run: _FakeRun | None) -> None:
        self._run = run

    def __call__(self) -> _FakeSession:
        return _FakeSession(self._run)


class _FakePubSub:
    """In-memory pub/sub multiplexing several channels onto one queue.

    Mirrors the subset of ``redis.asyncio.client.PubSub`` used by the SSE
    generator: ``subscribe`` / ``unsubscribe`` / ``get_message`` / ``close``.
    Messages are plain dicts shaped like real pub/sub frames
    (``{"type": "message", "channel": ..., "data": ...}``) so the production
    code path exercises its real parsing logic.
    """

    def __init__(self, queue: asyncio.Queue[dict[str, Any]]) -> None:
        self._queue = queue
        self.subscribed: list[str] = []
        self.unsubscribed: list[str] = []
        self.closed = False

    async def subscribe(self, *channels: str) -> None:
        for ch in channels:
            self.subscribed.append(ch)

    async def unsubscribe(self, *channels: str) -> None:
        for ch in channels:
            self.unsubscribed.append(ch)

    async def get_message(self, timeout: float | None = 25) -> dict[str, Any] | None:
        try:
            return await asyncio.wait_for(self._queue.get(), timeout=timeout)
        except TimeoutError:
            return None

    async def close(self) -> None:
        self.closed = True


class _FakeRedis:
    def __init__(self) -> None:
        self.queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
        self.pubsub_obj: _FakePubSub | None = None

    def pubsub(self) -> _FakePubSub:
        self.pubsub_obj = _FakePubSub(self.queue)
        return self.pubsub_obj


def _frame(channel: str, payload: dict[str, Any]) -> dict[str, Any]:
    """Build a pub/sub message frame as redis-py would deliver it."""
    return {"type": "message", "channel": channel, "data": json.dumps(payload)}


def _make_service(
    run: _FakeRun | None, monkeypatch: pytest.MonkeyPatch
) -> tuple[agent_service.AgentService, _FakeRedis]:
    """Wire ``stream_run_logs`` against fakes and return (service, fake_redis)."""
    fake_redis = _FakeRedis()
    monkeypatch.setattr(agent_service, "get_redis", lambda: fake_redis)
    monkeypatch.setattr(agent_service, "get_session_factory", lambda: _FakeSessionFactory(run))
    service = agent_service.AgentService(session=None)  # type: ignore[arg-type]
    return service, fake_redis


async def _drain(gen: Any) -> list[str]:
    """Collect every SSE chunk until the generator stops."""
    chunks: list[str] = []
    async for chunk in gen:
        chunks.append(chunk)
    return chunks


# ─── Tests ────────────────────────────────────────────────────────────────────


async def test_stream_run_logs_surfaces_permission_request(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Interactive run: permission_request on the session channel reaches SSE.

    This is the core regression: before the fix the generator never
    subscribed to ``agent_session:{id}``, so the AskUserQuestion approval
    card never appeared.
    """
    run_id = uuid.uuid4()
    session_id = uuid.uuid4()
    run = _FakeRun(status="running", exit_code=None, agent_session_id=session_id)
    service, fake_redis = _make_service(run, monkeypatch)

    run_channel = f"agent_run:{run_id}"
    session_channel = f"agent_session:{session_id}"

    # 1. permission_request published on the *session* channel (as
    #    DaemonPermissionService._publish_session_event does).
    await fake_redis.queue.put(
        _frame(
            session_channel,
            {
                "event": "permission_request",
                "session_id": str(session_id),
                "run_id": str(run_id),
                "request_id": "req-123",
                "tool_name": "Bash",
            },
        )
    )
    # 2. run completes → ``done`` on the run channel terminates the stream.
    await fake_redis.queue.put(
        _frame(
            run_channel,
            {"event": "done", "status": "completed", "exit_code": 0},
        )
    )

    chunks = await _drain(service.stream_run_logs(run_id))
    joined = "".join(chunks)

    # Both channels were subscribed.
    assert run_channel in fake_redis.pubsub_obj.subscribed  # type: ignore[union-attr]
    assert session_channel in fake_redis.pubsub_obj.subscribed  # type: ignore[union-attr]

    # permission_request was surfaced as an SSE ``data`` frame (not dropped).
    assert "data: " in joined
    assert "permission_request" in joined
    assert "req-123" in joined

    # The terminal ``done`` event still fires and carries DB-agnostic payload.
    assert "event: done" in joined
    assert '"status": "completed"' in joined

    # Session channel is cleaned up in finally alongside the run channel.
    assert session_channel in fake_redis.pubsub_obj.unsubscribed  # type: ignore[union-attr]
    assert run_channel in fake_redis.pubsub_obj.unsubscribed  # type: ignore[union-attr]
    assert fake_redis.pubsub_obj.closed is True  # type: ignore[union-attr]


async def test_stream_run_logs_surfaces_permission_resolved(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """permission_resolved (manual allow / timeout deny) also passes through."""
    run_id = uuid.uuid4()
    session_id = uuid.uuid4()
    run = _FakeRun(status="running", agent_session_id=session_id)
    service, fake_redis = _make_service(run, monkeypatch)

    await fake_redis.queue.put(
        _frame(
            f"agent_session:{session_id}",
            {
                "event": "permission_resolved",
                "session_id": str(session_id),
                "request_id": "req-456",
                "decision": "allow",
                "reason": "manual",
            },
        )
    )
    await fake_redis.queue.put(
        _frame(f"agent_run:{run_id}", {"event": "done", "status": "completed", "exit_code": 0})
    )

    joined = "".join(await _drain(service.stream_run_logs(run_id)))
    assert "permission_resolved" in joined
    assert '"decision": "allow"' in joined


async def test_stream_run_logs_passes_through_turn_completed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Non-permission session events (turn_completed) are transparently relayed."""
    run_id = uuid.uuid4()
    session_id = uuid.uuid4()
    run = _FakeRun(status="running", agent_session_id=session_id)
    service, fake_redis = _make_service(run, monkeypatch)

    await fake_redis.queue.put(
        _frame(
            f"agent_session:{session_id}",
            {"event": "turn_completed", "run_id": str(run_id)},
        )
    )
    await fake_redis.queue.put(
        _frame(f"agent_run:{run_id}", {"event": "done", "status": "completed", "exit_code": 0})
    )

    joined = "".join(await _drain(service.stream_run_logs(run_id)))
    assert "turn_completed" in joined


async def test_batch_run_without_session_skips_session_channel(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Batch runs (agent_session_id is None) must NOT subscribe a session channel.

    Guards against subscribing ``agent_session:None`` and against changing the
    existing run-only behaviour for non-interactive runs.
    """
    run_id = uuid.uuid4()
    run = _FakeRun(status="running", agent_session_id=None)
    service, fake_redis = _make_service(run, monkeypatch)

    await fake_redis.queue.put(
        _frame(f"agent_run:{run_id}", {"event": "done", "status": "completed", "exit_code": 0})
    )

    await _drain(service.stream_run_logs(run_id))

    ps = fake_redis.pubsub_obj
    assert ps is not None
    assert f"agent_run:{run_id}" in ps.subscribed
    # No session channel of any kind.
    assert not any(c.startswith("agent_session:") for c in ps.subscribed)
    # No session channel unsubscribed either.
    assert not any(c.startswith("agent_session:") for c in ps.unsubscribed)


async def test_stream_run_logs_run_channel_messages_unchanged(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Run-scoped log messages on ``agent_run:{id}`` are still relayed verbatim."""
    run_id = uuid.uuid4()
    session_id = uuid.uuid4()
    run = _FakeRun(status="running", agent_session_id=session_id)
    service, fake_redis = _make_service(run, monkeypatch)

    log_payload = {"event": "log", "level": "info", "message": "hello"}
    await fake_redis.queue.put(_frame(f"agent_run:{run_id}", log_payload))
    await fake_redis.queue.put(
        _frame(f"agent_run:{run_id}", {"event": "done", "status": "completed", "exit_code": 0})
    )

    joined = "".join(await _drain(service.stream_run_logs(run_id)))
    assert "hello" in joined
    assert '"event": "log"' in joined
