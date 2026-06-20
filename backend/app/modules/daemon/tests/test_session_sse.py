"""Tests for session-level SSE aggregation (task-06).

Covers FR-03 / D-005@v1 / R-08:
  * ``submit_messages`` dual publish (run channel unchanged + session channel
    with ``run_id`` marker) for interactive runs; batch runs unchanged.
  * ``AgentService.stream_session_logs`` — single SSE connection surviving
    across turns (different ``run_id``), done on ``session_ended``, keepalive
    on silence, error + cleanup on Redis failure.

Redis is mocked (``AsyncMock``) — no live broker needed. WS hub is mocked for
``submit_messages`` paths that go through dispatch.
"""

from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.model import AgentRun, AgentSession
from app.modules.agent.service import AgentService
from app.modules.daemon.model import DaemonRuntime, DaemonTaskLease
from app.modules.daemon.service import DaemonService

# ── Helpers ──────────────────────────────────────────────────────────────────


async def _create_user(session: AsyncSession) -> uuid.UUID:
    from app.modules.auth.model import User

    uid = uuid.uuid4()
    session.add(
        User(
            id=uid,
            email=f"sse-{uid}@example.com",
            password_hash="x",
            display_name="T",
            status="active",
        )
    )
    await session.commit()
    return uid


async def _create_runtime(session: AsyncSession, user_id: uuid.UUID) -> DaemonRuntime:
    rt = DaemonRuntime(
        id=uuid.uuid4(),
        user_id=user_id,
        name="daemon",
        provider="claude",
        status="online",
        last_heartbeat_at=datetime.now(UTC),
    )
    session.add(rt)
    await session.commit()
    await session.refresh(rt)
    return rt


async def _make_interactive_run(
    session: AsyncSession,
    *,
    agent_session_id: uuid.UUID,
    runtime_id: uuid.UUID,
) -> tuple[AgentRun, DaemonTaskLease]:
    """Seed an AgentRun bound to an AgentSession + its interactive lease.

    The claim_token is stored in ``metadata_["claim_token"]`` (the real schema,
    no dedicated column).
    """
    lease = DaemonTaskLease(
        id=uuid.uuid4(),
        runtime_id=runtime_id,
        agent_run_id=None,  # set below
        kind="interactive",
        status="claimed",
        metadata_={"claim_token": "tok"},
        lease_expires_at=datetime.now(UTC).replace(year=2099),
    )
    run = AgentRun(
        id=uuid.uuid4(),
        task_id=uuid.uuid4(),
        agent_type="claude_code",
        status="pending",
        agent_session_id=agent_session_id,
    )
    lease.agent_run_id = run.id
    session.add_all([run, lease])
    await session.commit()
    await session.refresh(run)
    await session.refresh(lease)
    return run, lease


async def _make_batch_run(
    session: AsyncSession,
    *,
    runtime_id: uuid.UUID,
) -> tuple[AgentRun, DaemonTaskLease]:
    lease = DaemonTaskLease(
        id=uuid.uuid4(),
        runtime_id=runtime_id,
        agent_run_id=None,
        kind="batch",
        status="claimed",
        metadata_={"claim_token": "tok"},
        lease_expires_at=datetime.now(UTC).replace(year=2099),
    )
    run = AgentRun(
        id=uuid.uuid4(),
        task_id=uuid.uuid4(),
        agent_type="claude_code",
        status="pending",
        agent_session_id=None,  # batch
    )
    lease.agent_run_id = run.id
    session.add_all([run, lease])
    await session.commit()
    await session.refresh(run)
    await session.refresh(lease)
    return run, lease


def _messages(*contents: str) -> list[dict]:
    return [{"event_type": "text", "content": c, "channel": "stdout"} for c in contents]


def _classify_publishes(redis_mock: AsyncMock) -> dict[str, list[str]]:
    """Split redis.publish calls into {channel: [raw_json_payload, ...]}."""
    buckets: dict[str, list[str]] = {}
    for call in redis_mock.publish.await_args_list:
        channel, raw = call.args
        buckets.setdefault(channel, []).append(raw)
    return buckets


def _decode(raw_list: list[str]) -> list[dict]:
    return [json.loads(r) for r in raw_list]


# ── submit_messages dual publish (AC-01 / AC-02 / AC-03 / AC-06) ──────────────


class TestSubmitMessagesDualPublish:
    @pytest.mark.asyncio
    async def test_interactive_run_publishes_both_channels_with_run_id(self, db_session) -> None:
        """AC-01: interactive run publishes agent_run:{run_id} AND
        agent_session:{session_id}; session events carry run_id marker."""
        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)
        ag_session = AgentSession(
            id=uuid.uuid4(),
            user_id=uid,
            runtime_id=rt.id,
            provider="claude",
            status="active",
        )
        db_session.add(ag_session)
        await db_session.commit()
        run, lease = await _make_interactive_run(
            db_session,
            agent_session_id=ag_session.id,
            runtime_id=rt.id,
        )

        redis = AsyncMock()
        with patch("app.modules.daemon.service.get_redis", return_value=redis):
            svc = DaemonService(db_session)
            count = await svc.submit_messages(lease.id, "tok", run.id, _messages("a", "b"))

        assert count == 2
        buckets = _classify_publishes(redis)
        run_channel = f"agent_run:{run.id}"
        session_channel = f"agent_session:{ag_session.id}"
        assert run_channel in buckets
        assert session_channel in buckets

        # run channel: 2 flat logs + 1 summary
        run_payloads = _decode(buckets[run_channel])
        assert len(run_payloads) == 3
        assert run_payloads[-1]["event"] == "messages"

        # session channel: 2 log events, each with run_id marker, NO summary
        session_payloads = _decode(buckets[session_channel])
        assert len(session_payloads) == 2
        for p in session_payloads:
            assert p["event"] == "log"
            assert p["run_id"] == str(run.id)
            assert p["session_id"] == str(ag_session.id)
            assert "log_id" in p
            assert p["channel"] == "stdout"
            assert "content" in p
            assert "timestamp" in p
        # summary (event: messages) must NOT appear on session channel
        assert not any(p.get("event") == "messages" for p in session_payloads)

    @pytest.mark.asyncio
    async def test_batch_run_no_session_channel_publish(self, db_session) -> None:
        """AC-03: batch run (agent_session_id IS NULL) → zero session channel."""
        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)
        run, lease = await _make_batch_run(db_session, runtime_id=rt.id)

        redis = AsyncMock()
        with patch("app.modules.daemon.service.get_redis", return_value=redis):
            svc = DaemonService(db_session)
            await svc.submit_messages(lease.id, "tok", run.id, _messages("x"))

        buckets = _classify_publishes(redis)
        assert f"agent_run:{run.id}" in buckets  # run channel unchanged
        # no agent_session:* channel published
        assert not any(ch.startswith("agent_session:") for ch in buckets), buckets

    @pytest.mark.asyncio
    async def test_session_publish_failure_does_not_break_run_channel(self, db_session) -> None:
        """AC-06: session channel publish raises → run channel still published,
        AgentRunLog committed, no exception raised."""
        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)
        ag_session = AgentSession(
            id=uuid.uuid4(),
            user_id=uid,
            runtime_id=rt.id,
            provider="claude",
            status="active",
        )
        db_session.add(ag_session)
        await db_session.commit()
        run, lease = await _make_interactive_run(
            db_session,
            agent_session_id=ag_session.id,
            runtime_id=rt.id,
        )

        call_log: list[str] = []

        async def flaky_publish(channel: str, payload: str) -> int:
            call_log.append(channel)
            if channel.startswith("agent_session:"):
                raise RuntimeError("session broker down")
            return 1

        redis = AsyncMock()
        redis.publish = AsyncMock(side_effect=flaky_publish)
        with patch("app.modules.daemon.service.get_redis", return_value=redis):
            svc = DaemonService(db_session)
            # Must not raise
            count = await svc.submit_messages(lease.id, "tok", run.id, _messages("a", "b"))

        assert count == 2
        # run channel publishes happened before the session publish attempt
        run_calls = [c for c in call_log if c.startswith("agent_run:")]
        session_calls = [c for c in call_log if c.startswith("agent_session:")]
        # run channel got its 2 logs + 1 summary
        assert len(run_calls) == 3
        # session channel was attempted
        assert len(session_calls) >= 1
        # AgentRunLog rows persisted despite session publish failure
        from app.modules.agent.model import AgentRunLog

        rows = (
            await db_session.execute(
                AgentRunLog.__table__.select().where(AgentRunLog.run_id == run.id)
            )
        ).all()
        assert len(rows) == 2


# ── stream_session_logs generator (AC-04 / AC-05 / AC-07 / AC-10) ─────────────


def _build_mock_pubsub(messages: list[dict | None]) -> tuple[MagicMock, dict]:
    """Build a MagicMock pubsub whose get_message yields ``messages`` then loops.

    ``None`` entries model silence (timeout path). Real message dicts are
    returned as-is.
    """
    state = {"remaining": list(messages)}

    pubsub = MagicMock()
    pubsub.subscribe = AsyncMock()
    pubsub.unsubscribe = AsyncMock()
    pubsub.close = AsyncMock()

    async def fake_get_message(timeout=None):
        if state["remaining"]:
            return state["remaining"].pop(0)
        return None  # exhausted → endless silence (caller breaks via done)

    pubsub.get_message = fake_get_message
    return pubsub, state


class TestStreamSessionLogs:
    @pytest.mark.asyncio
    async def test_connected_then_data_events_with_run_id(self, db_session) -> None:
        """AC-04: yields connected + data events carrying run_id."""
        sid = uuid.uuid4()
        log_payload = {
            "event": "log",
            "session_id": str(sid),
            "run_id": str(uuid.uuid4()),
            "log_id": str(uuid.uuid4()),
            "channel": "stdout",
            "content": "hello",
            "timestamp": "2026-06-18T22:41:08Z",
        }
        raw = json.dumps(log_payload)
        msgs = [{"type": "message", "data": raw}]
        pubsub, _ = _build_mock_pubsub(msgs)
        redis = MagicMock()
        redis.pubsub.return_value = pubsub

        svc = AgentService(db_session)
        collected: list[str] = []
        gen = svc.stream_session_logs(sid)
        with patch("app.modules.agent.service.get_redis", return_value=redis):
            async for ev in gen:
                collected.append(ev)
                if len(collected) > 5:
                    break
            # Consumer-side break defers GeneratorExit; explicitly close so the
            # finally (unsubscribe + close) runs deterministically.
            await gen.aclose()

        assert collected[0] == ": connected\n\n"
        assert any(ev == f"data: {raw}\n\n" for ev in collected)
        pubsub.unsubscribe.assert_called_once()
        pubsub.close.assert_called_once()

    @pytest.mark.asyncio
    async def test_session_ended_emits_done_and_returns(self, db_session) -> None:
        """AC-05: session_ended event → event: done + stop iteration."""
        sid = uuid.uuid4()
        ended = json.dumps(
            {
                "event": "session_ended",
                "session_id": str(sid),
                "run_id": None,
                "status": "ended",
                "reason": "manual",
            }
        )
        msgs = [{"type": "message", "data": ended}]
        pubsub, _ = _build_mock_pubsub(msgs)
        redis = MagicMock()
        redis.pubsub.return_value = pubsub

        svc = AgentService(db_session)
        collected: list[str] = []
        with patch("app.modules.agent.service.get_redis", return_value=redis):
            async for ev in svc.stream_session_logs(sid):
                collected.append(ev)

        assert any(ev.startswith("event: done") for ev in collected)
        assert any('"status": "ended"' in ev for ev in collected)
        pubsub.unsubscribe.assert_called_once()
        pubsub.close.assert_called_once()

    @pytest.mark.asyncio
    async def test_already_ended_session_emits_done_immediately(self, db_session) -> None:
        """AC-05 boundary: subscribe sees session already ended → immediate done."""
        uid = await _create_user(db_session)
        ag = AgentSession(
            id=uuid.uuid4(),
            user_id=uid,
            provider="claude",
            status="ended",
        )
        db_session.add(ag)
        await db_session.commit()

        pubsub, _ = _build_mock_pubsub([])  # no messages ever
        redis = MagicMock()
        redis.pubsub.return_value = pubsub

        svc = AgentService(db_session)
        collected: list[str] = []
        with patch("app.modules.agent.service.get_redis", return_value=redis):
            async for ev in svc.stream_session_logs(ag.id):
                collected.append(ev)

        assert collected[0] == ": connected\n\n"
        assert any(ev.startswith("event: done") for ev in collected)
        pubsub.subscribe.assert_called_once()

    @pytest.mark.asyncio
    async def test_multiple_run_ids_single_connection(self, db_session) -> None:
        """AC-04: two turns (different run_id) flow over one connection."""
        sid = uuid.uuid4()
        run1 = uuid.uuid4()
        run2 = uuid.uuid4()
        log1 = json.dumps(
            {
                "event": "log",
                "session_id": str(sid),
                "run_id": str(run1),
                "log_id": str(uuid.uuid4()),
                "channel": "stdout",
                "content": "turn1",
                "timestamp": "2026-06-18T22:41:08Z",
            }
        )
        log2 = json.dumps(
            {
                "event": "log",
                "session_id": str(sid),
                "run_id": str(run2),
                "log_id": str(uuid.uuid4()),
                "channel": "stdout",
                "content": "turn2",
                "timestamp": "2026-06-18T22:42:08Z",
            }
        )
        msgs = [
            {"type": "message", "data": log1},
            {"type": "message", "data": log2},
        ]
        pubsub, _ = _build_mock_pubsub(msgs)
        redis = MagicMock()
        redis.pubsub.return_value = pubsub

        svc = AgentService(db_session)
        collected: list[str] = []
        gen = svc.stream_session_logs(sid)
        with patch("app.modules.agent.service.get_redis", return_value=redis):
            async for ev in gen:
                collected.append(ev)
                if len(collected) > 6:
                    break
            await gen.aclose()

        joined = "".join(collected)
        assert f"data: {log1}\n\n" in joined
        assert f"data: {log2}\n\n" in joined

    @pytest.mark.asyncio
    async def test_redis_error_emits_error_and_cleans_up(self, db_session) -> None:
        """AC-07: Redis failure → event: error + finally unsubscribe/close."""
        sid = uuid.uuid4()
        pubsub = MagicMock()
        pubsub.subscribe = AsyncMock(side_effect=ConnectionRefusedError("down"))
        pubsub.unsubscribe = AsyncMock()
        pubsub.close = AsyncMock()
        redis = MagicMock()
        redis.pubsub.return_value = pubsub

        svc = AgentService(db_session)
        collected: list[str] = []
        with patch("app.modules.agent.service.get_redis", return_value=redis):
            async for ev in svc.stream_session_logs(sid):
                collected.append(ev)

        assert any(ev.startswith("event: error") for ev in collected)
        assert any("redis connection failed" in ev for ev in collected)
        pubsub.unsubscribe.assert_called_once()
        pubsub.close.assert_called_once()


# ── Router GET /sessions/{id}/stream (AC-08 / AC-09) ──────────────────────────


class TestStreamSessionEndpoint:
    @pytest.mark.asyncio
    async def test_stream_200_owned_session_headers(self, client, auth_headers, db_session) -> None:
        """AC-09: owned session → 200 text/event-stream + correct headers."""
        from app.modules.auth.model import User

        admin = (
            (await db_session.execute(select(User).where(User.email == "admin@example.com")))
            .scalars()
            .first()
        )
        assert admin is not None
        ag = AgentSession(
            id=uuid.uuid4(),
            user_id=admin.id,
            provider="claude",
            status="ended",  # terminal → generator race-guard emits done fast
        )
        db_session.add(ag)
        await db_session.commit()
        await db_session.refresh(ag)

        # Mock Redis: pubsub is never consumed (race-guard short-circuits), but
        # get_redis must not hit a live broker.
        mock_redis = MagicMock()
        mock_redis.pubsub.return_value = MagicMock(
            subscribe=AsyncMock(),
            unsubscribe=AsyncMock(),
            close=AsyncMock(),
            get_message=AsyncMock(return_value=None),
        )
        with patch("app.modules.agent.service.get_redis", return_value=mock_redis):
            resp = await client.get(f"/api/daemon/sessions/{ag.id}/stream", headers=auth_headers)
        assert resp.status_code == 200, resp.text
        assert resp.headers["content-type"].startswith("text/event-stream")
        assert resp.headers["cache-control"] == "no-cache, no-transform"
        assert resp.headers["x-accel-buffering"] == "no"

    @pytest.mark.asyncio
    async def test_stream_200_terminates_when_session_ended_published(
        self, client, auth_headers, db_session
    ) -> None:
        """AC-05: a published session_ended closes the stream within the
        generator (router does not short-circuit). Verifies ownership +
        end-to-end generator wiring via the route."""
        from app.modules.auth.model import User

        admin = (
            (await db_session.execute(select(User).where(User.email == "admin@example.com")))
            .scalars()
            .first()
        )
        assert admin is not None
        ag = AgentSession(
            id=uuid.uuid4(),
            user_id=admin.id,
            provider="claude",
            status="active",
        )
        db_session.add(ag)
        await db_session.commit()
        await db_session.refresh(ag)

        # Mock Redis so the generator's pubsub yields a single session_ended
        # message then None — driving the generator to ``event: done`` and
        # return, so the StreamingResponse completes for the test client.
        ended_raw = json.dumps(
            {
                "event": "session_ended",
                "session_id": str(ag.id),
                "run_id": None,
                "status": "ended",
                "reason": "manual",
            }
        )
        pubsub = MagicMock()
        pubsub.subscribe = AsyncMock()
        pubsub.unsubscribe = AsyncMock()
        pubsub.close = AsyncMock()
        delivered = {"v": False}

        async def fake_get_message(timeout=None):
            if not delivered["v"]:
                delivered["v"] = True
                return {"type": "message", "data": ended_raw}
            return None

        pubsub.get_message = fake_get_message
        mock_redis = MagicMock()
        mock_redis.pubsub.return_value = pubsub

        with patch("app.modules.agent.service.get_redis", return_value=mock_redis):
            resp = await client.get(f"/api/daemon/sessions/{ag.id}/stream", headers=auth_headers)
        body = resp.text
        assert resp.status_code == 200, body
        assert "event: done" in body
        assert '"status": "ended"' in body

    @pytest.mark.asyncio
    async def test_stream_404_wrong_user(self, client, auth_headers) -> None:
        """AC-08: session owned by another/missing → 404, no stream."""
        resp = await client.get(f"/api/daemon/sessions/{uuid.uuid4()}/stream", headers=auth_headers)
        assert resp.status_code == 404

    @pytest.mark.asyncio
    async def test_stream_401_unauthenticated(self, client) -> None:
        """AC-08: no auth → 401."""
        resp = await client.get(f"/api/daemon/sessions/{uuid.uuid4()}/stream")
        assert resp.status_code == 401
