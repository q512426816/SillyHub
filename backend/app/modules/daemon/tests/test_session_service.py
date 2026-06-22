"""Tests for DaemonService interactive session orchestration (task-05).

Covers create/inject/interrupt/end_session, the D-005@v1 triple, currentRun
uniqueness, concurrency conflict detection (single-threaded logic + the
``with_for_update`` query), end-session single reconciliation, idempotency,
offline convergence, and the lease-kind invariant guard.

The WS hub is mocked via ``get_daemon_ws_hub`` so no live WebSocket is needed;
Redis is mocked via ``get_redis`` so no live Redis is needed. SQLite ignores
``FOR UPDATE`` but the row-lock query + error branches are still exercised
(AC-04/AC-17 PostgreSQL concurrency proof is environment-gated, see report).
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.model import AgentRun, AgentSession
from app.modules.daemon.model import DaemonRuntime, DaemonTaskLease
from app.modules.daemon.service import (
    DaemonRuntimeOffline,
    DaemonService,
    DaemonSessionInvariantViolation,
    DaemonSessionNoCurrentRun,
    DaemonSessionNotActive,
    DaemonSessionNotFound,
    DaemonSessionTurnConflict,
)

# ── Fixtures ─────────────────────────────────────────────────────────────────


async def _create_user(session: AsyncSession) -> uuid.UUID:
    from app.modules.auth.model import User

    uid = uuid.uuid4()
    session.add(
        User(
            id=uid,
            email=f"svc-{uid}@example.com",
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


def _mock_hub(*, connected: bool = True) -> MagicMock:
    hub = MagicMock()
    hub.is_connected.return_value = connected
    hub.connected_runtime_ids = []
    hub.send_wakeup = AsyncMock(return_value=True)
    hub.send_session_control = AsyncMock(return_value=connected)
    return hub


def _mock_redis() -> AsyncMock:
    redis = AsyncMock()
    redis.publish = AsyncMock()
    return redis


@pytest.fixture()
def mocked_hub():
    hub = _mock_hub()
    # Both service.create_session (via placement.notify_interactive_dispatch)
    # and the service control senders call get_daemon_ws_hub. Patch at source.
    with patch("app.modules.daemon.ws_hub.get_daemon_ws_hub", return_value=hub):
        yield hub


@pytest.fixture()
def mocked_redis():
    redis = _mock_redis()
    with patch("app.modules.daemon.session.service.get_redis", return_value=redis):
        yield redis


# ── create_session ───────────────────────────────────────────────────────────


class TestCreateSession:
    @pytest.mark.asyncio
    async def test_creates_triple_and_activates(self, db_session, mocked_hub, mocked_redis) -> None:
        uid = await _create_user(db_session)
        await _create_runtime(db_session, uid)

        svc = DaemonService(db_session)
        result = await svc.create_session(
            uid, provider="claude", prompt="hello", model="claude-sonnet-4"
        )

        s = result.agent_session
        run = result.agent_run
        assert s.status == "active"
        assert s.turn_count == 1
        assert s.runtime_id is not None
        assert s.lease_id == result.lease_id
        # first run bound to session, pending, interactive strategy
        assert run.agent_session_id == s.id
        assert run.status == "pending"
        assert run.spec_strategy == "interactive"

        # D-005@v1: lease agent_run_id NULL, kind interactive, no expiry
        lease = await db_session.get(DaemonTaskLease, result.lease_id)
        assert lease.agent_run_id is None
        assert lease.kind == "interactive"
        assert lease.lease_expires_at is None

    @pytest.mark.asyncio
    async def test_first_turn_control_message_sent(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        uid = await _create_user(db_session)
        await _create_runtime(db_session, uid)
        svc = DaemonService(db_session)
        result = await svc.create_session(uid, provider="claude", prompt="hi there")

        # Exactly one SESSION_INJECT control message for the first turn
        assert mocked_hub.send_session_control.await_count == 1
        call = mocked_hub.send_session_control.await_args
        msg_type, payload = call.args[1], call.args[2]
        from app.modules.daemon.protocol import DAEMON_MSG_SESSION_INJECT

        assert msg_type == DAEMON_MSG_SESSION_INJECT
        assert payload["prompt"] == "hi there"
        assert payload["session_id"] == str(result.agent_session.id)
        assert payload["run_id"] == str(result.agent_run.id)
        assert payload["lease_id"] == str(result.lease_id)

    @pytest.mark.asyncio
    async def test_empty_prompt_rejected(self, db_session, mocked_hub) -> None:
        uid = await _create_user(db_session)
        await _create_runtime(db_session, uid)
        svc = DaemonService(db_session)
        with pytest.raises(Exception):  # DaemonSessionNotActive
            await svc.create_session(uid, provider="claude", prompt="   ")

    @pytest.mark.asyncio
    async def test_offline_daemon_converges_to_failed(self, db_session, mocked_redis) -> None:
        """AC-12: first-turn wake-up failure → run=failed, session=failed, lease=completed."""
        uid = await _create_user(db_session)
        await _create_runtime(db_session, uid)

        offline_hub = _mock_hub(connected=False)
        # notify_interactive_dispatch checks is_connected + connected_runtime_ids
        offline_hub.is_connected.return_value = False
        offline_hub.connected_runtime_ids = []
        with patch("app.modules.daemon.ws_hub.get_daemon_ws_hub", return_value=offline_hub):
            svc = DaemonService(db_session)
            with pytest.raises(DaemonRuntimeOffline):
                await svc.create_session(uid, provider="claude", prompt="hello")

        # No active session/run/lease lingering — all converged
        sessions = (await db_session.execute(select(AgentSession))).scalars().all()
        assert len(sessions) == 1
        assert sessions[0].status == "failed"
        assert sessions[0].ended_at is not None

        runs = (await db_session.execute(select(AgentRun))).scalars().all()
        assert len(runs) == 1
        assert runs[0].status == "failed"

        leases = (await db_session.execute(select(DaemonTaskLease))).scalars().all()
        assert len(leases) == 1
        assert leases[0].status == "completed"


# ── inject_session ───────────────────────────────────────────────────────────


class TestInjectSession:
    @pytest.mark.asyncio
    async def test_inject_creates_new_run(self, db_session, mocked_hub, mocked_redis) -> None:
        uid = await _create_user(db_session)
        await _create_runtime(db_session, uid)
        svc = DaemonService(db_session)
        created = await svc.create_session(uid, provider="claude", prompt="first")
        first_run_id = created.agent_run.id
        # mark first run as completed (turn done) so inject can proceed
        created.agent_run.status = "completed"
        created.agent_run.finished_at = datetime.now(UTC)
        await db_session.commit()

        result = await svc.inject_session(created.agent_session.id, uid, prompt="second")

        assert result.agent_run.id != first_run_id
        assert result.agent_run.agent_session_id == created.agent_session.id
        assert result.agent_run.status == "pending"
        # turn_count incremented
        await db_session.refresh(created.agent_session)
        assert created.agent_session.turn_count == 2

    @pytest.mark.asyncio
    async def test_inject_conflict_when_active_run(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        """AC-05: pending/running run present → 409 DaemonSessionTurnConflict."""
        uid = await _create_user(db_session)
        await _create_runtime(db_session, uid)
        svc = DaemonService(db_session)
        created = await svc.create_session(uid, provider="claude", prompt="first")
        # first run is still pending → inject must conflict
        with pytest.raises(DaemonSessionTurnConflict):
            await svc.inject_session(created.agent_session.id, uid, prompt="second")

    @pytest.mark.asyncio
    async def test_inject_on_non_active_session(self, db_session, mocked_hub, mocked_redis) -> None:
        uid = await _create_user(db_session)
        await _create_runtime(db_session, uid)
        svc = DaemonService(db_session)
        created = await svc.create_session(uid, provider="claude", prompt="first")
        created.agent_session.status = "ended"
        await db_session.commit()

        with pytest.raises(DaemonSessionNotActive):
            await svc.inject_session(created.agent_session.id, uid, prompt="again")

    @pytest.mark.asyncio
    async def test_inject_wrong_user_returns_404(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        """AC-11: cross-user access → 404 (existence not leaked)."""
        uid = await _create_user(db_session)
        other = await _create_user(db_session)
        await _create_runtime(db_session, uid)
        svc = DaemonService(db_session)
        created = await svc.create_session(uid, provider="claude", prompt="first")
        with pytest.raises(DaemonSessionNotFound):
            await svc.inject_session(created.agent_session.id, other, prompt="x")

    @pytest.mark.asyncio
    async def test_inject_ws_send_failure_converges_run(self, db_session, mocked_redis) -> None:
        """AC-13: control send fails → new run=failed but session stays active."""
        uid = await _create_user(db_session)
        await _create_runtime(db_session, uid)
        # create succeeds (hub connected)
        good_hub = _mock_hub(connected=True)
        with patch("app.modules.daemon.ws_hub.get_daemon_ws_hub", return_value=good_hub):
            svc = DaemonService(db_session)
            created = await svc.create_session(uid, provider="claude", prompt="first")
        created.agent_run.status = "completed"
        created.agent_run.finished_at = datetime.now(UTC)
        await db_session.commit()

        # Now break the WS send for the inject path
        bad_hub = _mock_hub(connected=True)
        bad_hub.send_session_control = AsyncMock(return_value=False)
        with patch("app.modules.daemon.ws_hub.get_daemon_ws_hub", return_value=bad_hub):
            svc = DaemonService(db_session)
            with pytest.raises(DaemonRuntimeOffline):
                await svc.inject_session(created.agent_session.id, uid, prompt="second")

        # session still active, run failed
        await db_session.refresh(created.agent_session)
        assert created.agent_session.status == "active"
        runs = (
            (
                await db_session.execute(
                    select(AgentRun).where(AgentRun.agent_session_id == created.agent_session.id)
                )
            )
            .scalars()
            .all()
        )
        failed = [r for r in runs if r.status == "failed"]
        assert len(failed) == 1
        assert failed[0].output_redacted is not None  # auditable


# ── interrupt_session ────────────────────────────────────────────────────────


class TestInterruptSession:
    @pytest.mark.asyncio
    async def test_interrupt_sends_message_keeps_session_active(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        """AC-06: interrupt sends SESSION_INTERRUPT, session stays active, lease untouched."""
        uid = await _create_user(db_session)
        await _create_runtime(db_session, uid)
        svc = DaemonService(db_session)
        created = await svc.create_session(uid, provider="claude", prompt="first")

        # reset mock to inspect the interrupt call cleanly
        mocked_hub.send_session_control.reset_mock()
        result = await svc.interrupt_session(created.agent_session.id, uid)

        assert result.current_run_id == created.agent_run.id
        # exactly one control message after reset
        assert mocked_hub.send_session_control.await_count == 1
        from app.modules.daemon.protocol import DAEMON_MSG_SESSION_INTERRUPT

        call = mocked_hub.send_session_control.await_args
        assert call.args[1] == DAEMON_MSG_SESSION_INTERRUPT

        # session/lease NOT mutated
        await db_session.refresh(created.agent_session)
        assert created.agent_session.status == "active"
        lease = await db_session.get(DaemonTaskLease, created.agent_session.lease_id)
        assert lease.status == "pending"
        # run NOT locally killed (daemon result drives terminal state)
        await db_session.refresh(created.agent_run)
        assert created.agent_run.status == "pending"

    @pytest.mark.asyncio
    async def test_interrupt_no_current_run(self, db_session, mocked_hub, mocked_redis) -> None:
        """AC-07: no active run → DaemonSessionNoCurrentRun."""
        uid = await _create_user(db_session)
        await _create_runtime(db_session, uid)
        svc = DaemonService(db_session)
        created = await svc.create_session(uid, provider="claude", prompt="first")
        created.agent_run.status = "completed"
        created.agent_run.finished_at = datetime.now(UTC)
        await db_session.commit()

        with pytest.raises(DaemonSessionNoCurrentRun):
            await svc.interrupt_session(created.agent_session.id, uid)

    @pytest.mark.asyncio
    async def test_interrupt_offline_raises(self, db_session, mocked_redis) -> None:
        """AC-08 boundary: WS send fails → DaemonRuntimeOffline, no state change."""
        uid = await _create_user(db_session)
        await _create_runtime(db_session, uid)
        good_hub = _mock_hub(connected=True)
        with patch("app.modules.daemon.ws_hub.get_daemon_ws_hub", return_value=good_hub):
            svc = DaemonService(db_session)
            created = await svc.create_session(uid, provider="claude", prompt="first")

        bad_hub = _mock_hub(connected=True)
        bad_hub.send_session_control = AsyncMock(return_value=False)
        with patch("app.modules.daemon.ws_hub.get_daemon_ws_hub", return_value=bad_hub):
            svc = DaemonService(db_session)
            with pytest.raises(DaemonRuntimeOffline):
                await svc.interrupt_session(created.agent_session.id, uid)

        # session unchanged
        await db_session.refresh(created.agent_session)
        assert created.agent_session.status == "active"


# ── end_session ──────────────────────────────────────────────────────────────


class TestEndSession:
    @pytest.mark.asyncio
    async def test_end_reconciles_three_entities(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        """AC-08: single transaction kills run + ends session + completes lease."""
        uid = await _create_user(db_session)
        await _create_runtime(db_session, uid)
        svc = DaemonService(db_session)
        created = await svc.create_session(uid, provider="claude", prompt="first")

        result = await svc.end_session(created.agent_session.id, uid)
        assert result.agent_session.status == "ended"
        assert result.current_run_id == created.agent_run.id

        await db_session.refresh(created.agent_session)
        await db_session.refresh(created.agent_run)
        lease = await db_session.get(DaemonTaskLease, created.agent_session.lease_id)

        assert created.agent_session.status == "ended"
        assert created.agent_session.ended_at is not None
        assert created.agent_run.status == "killed"
        assert created.agent_run.finished_at is not None
        assert lease.status == "completed"

        # SESSION_END was sent exactly once
        end_calls = [c for c in mocked_hub.send_session_control.await_args_list]
        from app.modules.daemon.protocol import DAEMON_MSG_SESSION_END

        assert any(c.args[1] == DAEMON_MSG_SESSION_END for c in end_calls)

    @pytest.mark.asyncio
    async def test_end_idempotent(self, db_session, mocked_hub, mocked_redis) -> None:
        """AC-10: double end → no second WS, no ended_at change."""
        uid = await _create_user(db_session)
        await _create_runtime(db_session, uid)
        svc = DaemonService(db_session)
        created = await svc.create_session(uid, provider="claude", prompt="first")
        await svc.end_session(created.agent_session.id, uid)
        await db_session.refresh(created.agent_session)
        first_ended_at = created.agent_session.ended_at

        mocked_hub.send_session_control.reset_mock()
        await svc.end_session(created.agent_session.id, uid)
        await db_session.refresh(created.agent_session)
        assert created.agent_session.ended_at == first_ended_at
        # no WS sent on idempotent path
        assert mocked_hub.send_session_control.await_count == 0

    @pytest.mark.asyncio
    async def test_end_offline_still_reconciles(self, db_session, mocked_redis) -> None:
        """AC-09: daemon offline → local reconciliation still succeeds, warning logged."""
        uid = await _create_user(db_session)
        await _create_runtime(db_session, uid)
        good_hub = _mock_hub(connected=True)
        with patch("app.modules.daemon.ws_hub.get_daemon_ws_hub", return_value=good_hub):
            svc = DaemonService(db_session)
            created = await svc.create_session(uid, provider="claude", prompt="first")

        # break WS for the end path
        bad_hub = _mock_hub(connected=True)
        bad_hub.send_session_control = AsyncMock(return_value=False)
        with patch("app.modules.daemon.ws_hub.get_daemon_ws_hub", return_value=bad_hub):
            svc = DaemonService(db_session)
            # must NOT raise — end is best-effort on WS
            result = await svc.end_session(created.agent_session.id, uid)

        assert result.agent_session.status == "ended"
        await db_session.refresh(created.agent_run)
        assert created.agent_run.status == "killed"

    @pytest.mark.asyncio
    async def test_end_batch_lease_invariant_violation(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        """AC-19: session.lease_id pointing at a batch lease → invariant violation, rollback."""
        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)
        # craft an active session bound to a BATCH lease (data corruption case)
        batch_lease = DaemonTaskLease(
            id=uuid.uuid4(),
            runtime_id=rt.id,
            agent_run_id=None,
            kind="batch",  # wrong kind!
            status="pending",
            created_at=datetime.now(UTC),
            updated_at=datetime.now(UTC),
        )
        session = AgentSession(
            id=uuid.uuid4(),
            user_id=uid,
            runtime_id=rt.id,
            lease_id=batch_lease.id,
            provider="claude",
            status="active",
            turn_count=1,
        )
        db_session.add_all([batch_lease, session])
        await db_session.commit()

        svc = DaemonService(db_session)
        with pytest.raises(DaemonSessionInvariantViolation):
            await svc.end_session(session.id, uid)

        # session unchanged (rolled back), batch lease NOT completed
        await db_session.refresh(session)
        await db_session.refresh(batch_lease)
        assert session.status == "active"
        assert batch_lease.status == "pending"


# ── currentRun invariant ─────────────────────────────────────────────────────


class TestCurrentRunInvariant:
    @pytest.mark.asyncio
    async def test_multiple_active_runs_raises_invariant(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        """AC-07 boundary: >1 active run → DaemonSessionInvariantViolation (never guess)."""
        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)
        session = AgentSession(
            id=uuid.uuid4(),
            user_id=uid,
            runtime_id=rt.id,
            provider="claude",
            status="active",
            turn_count=2,
        )
        run1 = AgentRun(
            id=uuid.uuid4(),
            agent_type="claude_code",
            status="running",
            agent_session_id=session.id,
        )
        run2 = AgentRun(
            id=uuid.uuid4(),
            agent_type="claude_code",
            status="pending",
            agent_session_id=session.id,
        )
        db_session.add_all([session, run1, run2])
        await db_session.commit()

        svc = DaemonService(db_session)
        with pytest.raises(DaemonSessionInvariantViolation):
            await svc.interrupt_session(session.id, uid)
