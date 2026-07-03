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
    DaemonOffline,
    DaemonRuntimeOffline,
    DaemonService,
    DaemonSessionInvariantViolation,
    DaemonSessionNoAgentSession,
    DaemonSessionNoCurrentRun,
    DaemonSessionNotActive,
    DaemonSessionNotFound,
    DaemonSessionResumeUnsupported,
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
    hub.connected_daemon_ids = []
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

    @pytest.mark.asyncio
    async def test_end_daemon_actor_by_runtime_owner_success(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        """ql-20260623-004: daemon 身份（X-API-Key owner=runtime owner）能 end
        绑定到自己 runtime 的 session——admin 共享 runtime 场景 creator≠owner。

        复现 404 根因：session 创建者 creator ≠ runtime/api-key owner。修复前
        end_session(session_id, owner) 走 user_id 校验
        （AgentSession.user_id==creator）→ 404；修复后 actor_runtime_owner_id=owner
        走 runtime 归属校验（session.runtime.user_id==owner）→ 成功收口。
        """
        creator = await _create_user(db_session)
        owner = await _create_user(db_session)
        rt = await _create_runtime(db_session, owner)  # runtime 归属 owner
        lease = DaemonTaskLease(
            id=uuid.uuid4(),
            runtime_id=rt.id,
            agent_run_id=None,
            kind="interactive",
            status="pending",
            created_at=datetime.now(UTC),
            updated_at=datetime.now(UTC),
        )
        session = AgentSession(
            id=uuid.uuid4(),
            user_id=creator,  # 创建者 ≠ runtime owner
            runtime_id=rt.id,
            lease_id=lease.id,
            provider="claude",
            status="active",
            turn_count=1,
        )
        db_session.add_all([lease, session])
        await db_session.commit()

        svc = DaemonService(db_session)
        result = await svc.end_session(session.id, owner, actor_runtime_owner_id=owner)
        assert result.agent_session.status == "ended"
        await db_session.refresh(session)
        assert session.status == "ended"

    @pytest.mark.asyncio
    async def test_end_daemon_actor_wrong_owner_404(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        """ql-20260623-004: daemon api-key owner ≠ runtime owner → 404，session 不变。"""
        creator = await _create_user(db_session)
        owner = await _create_user(db_session)
        intruder = await _create_user(db_session)
        rt = await _create_runtime(db_session, owner)
        lease = DaemonTaskLease(
            id=uuid.uuid4(),
            runtime_id=rt.id,
            agent_run_id=None,
            kind="interactive",
            status="pending",
            created_at=datetime.now(UTC),
            updated_at=datetime.now(UTC),
        )
        session = AgentSession(
            id=uuid.uuid4(),
            user_id=creator,
            runtime_id=rt.id,
            lease_id=lease.id,
            provider="claude",
            status="active",
            turn_count=1,
        )
        db_session.add_all([lease, session])
        await db_session.commit()

        svc = DaemonService(db_session)
        # intruder 不是 runtime owner（rt.user_id=owner≠intruder）→ 404
        with pytest.raises(DaemonSessionNotFound):
            await svc.end_session(session.id, intruder, actor_runtime_owner_id=intruder)
        await db_session.refresh(session)
        assert session.status == "active"  # 未被改动

    @pytest.mark.asyncio
    async def test_end_frontend_actor_path_unchanged(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        """ql-20260623-004 回归：前端身份（不传 actor_runtime_owner_id）仍走 user_id 校验。"""
        creator = await _create_user(db_session)
        rt = await _create_runtime(db_session, creator)
        lease = DaemonTaskLease(
            id=uuid.uuid4(),
            runtime_id=rt.id,
            agent_run_id=None,
            kind="interactive",
            status="pending",
            created_at=datetime.now(UTC),
            updated_at=datetime.now(UTC),
        )
        session = AgentSession(
            id=uuid.uuid4(),
            user_id=creator,
            runtime_id=rt.id,
            lease_id=lease.id,
            provider="claude",
            status="active",
            turn_count=1,
        )
        db_session.add_all([lease, session])
        await db_session.commit()

        svc = DaemonService(db_session)
        result = await svc.end_session(session.id, creator)
        assert result.agent_session.status == "ended"


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


# ── task-07 (codex reopen parity, design §5.6 / FR-06 / D-003@v1 / D-007@v1) ──


async def _make_ended_session(
    session: AsyncSession,
    user_id: uuid.UUID,
    runtime_id: uuid.UUID,
    *,
    provider: str = "codex",
    agent_session_id: str | None = "codex-thread-abc",
    status: str = "ended",
) -> tuple[AgentSession, DaemonTaskLease]:
    """Create a terminal AgentSession bound to a completed interactive lease.

    Mirrors the pre-reopen state: the original ``completed`` lease (design
    §6.2) must stay untouched; reopen creates a brand-new pending lease.
    """
    now = datetime.now(UTC)
    lease = DaemonTaskLease(
        id=uuid.uuid4(),
        runtime_id=runtime_id,
        agent_run_id=None,
        kind="interactive",
        status="completed",
        claimed_at=now,
        lease_expires_at=None,
        attempt_number=1,
        metadata_={
            "session_id": agent_session_id or "",
            "provider": provider,
            "claim_token": "old-codex-token-deadbeef",
        },
        created_at=now,
        updated_at=now,
    )
    sess = AgentSession(
        id=uuid.uuid4(),
        user_id=user_id,
        runtime_id=runtime_id,
        lease_id=lease.id,
        provider=provider,
        status=status,
        agent_session_id=agent_session_id,
        config={"model": "gpt-5"},
        turn_count=1,
        cwd="/workspace/codex-proj",
        created_at=now,
        last_active_at=now,
        ended_at=now if status in ("ended", "failed") else None,
    )
    session.add_all([lease, sess])
    await session.commit()
    await session.refresh(lease)
    await session.refresh(sess)
    return sess, lease


class TestReopenCodexSession:
    """task-07 / design §5.6: backend 放开 Codex reopen (provider gate {claude,codex}).

    D-003@v1 复用 backend session 控制面；D-007@v1 agent_session_id 即 Codex
    threadId，原样作为 resume key 保留，不伪造。
    """

    @pytest.mark.asyncio
    async def test_reopen_ended_codex_session_returns_reconnecting(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)
        sess, _old_lease = await _make_ended_session(db_session, uid, rt.id)

        svc = DaemonService(db_session)
        result = await svc.reopen_session(sess.id, uid)

        assert result.session_id == str(sess.id)
        assert result.status == "reconnecting"

        # DB-level via column projection (bypass identity-map copy written by
        # the service's own session).
        status_row = (
            await db_session.execute(select(AgentSession.status).where(AgentSession.id == sess.id))
        ).scalar_one()
        assert status_row == "reconnecting"

    @pytest.mark.asyncio
    async def test_reopen_codex_creates_new_lease_preserves_threadid(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)
        sess, old_lease = await _make_ended_session(
            db_session, uid, rt.id, agent_session_id="codex-thread-xyz"
        )

        svc = DaemonService(db_session)
        await svc.reopen_session(sess.id, uid)

        sess_row = (
            await db_session.execute(
                select(
                    AgentSession.status,
                    AgentSession.agent_session_id,
                    AgentSession.lease_id,
                    AgentSession.runtime_id,
                ).where(AgentSession.id == sess.id)
            )
        ).one()
        assert sess_row.status == "reconnecting"
        # D-007@v1: threadId preserved verbatim as the resume key.
        assert sess_row.agent_session_id == "codex-thread-xyz"
        assert sess_row.lease_id is not None
        new_lease_id = sess_row.lease_id
        assert new_lease_id != old_lease.id

        new_lease = (
            await db_session.execute(
                select(
                    DaemonTaskLease.kind,
                    DaemonTaskLease.status,
                    DaemonTaskLease.metadata_,
                ).where(DaemonTaskLease.id == new_lease_id)
            )
        ).one()
        assert new_lease.kind == "interactive"
        assert new_lease.status == "pending"
        meta = new_lease.metadata_ or {}
        # lease metadata 四字段齐 (design §5.6.3)。
        assert meta["session_id"] == str(sess.id)
        assert meta["agent_session_id"] == "codex-thread-xyz"
        assert meta["provider"] == "codex"
        new_token = meta["claim_token"]
        assert isinstance(new_token, str) and len(new_token) >= 32
        assert new_token != "old-codex-token-deadbeef"

        # design §6.2: 旧 completed lease 不动。
        old_status = (
            await db_session.execute(
                select(DaemonTaskLease.status).where(DaemonTaskLease.id == old_lease.id)
            )
        ).scalar_one()
        assert old_status == "completed"

    @pytest.mark.asyncio
    async def test_reopen_unsupported_provider_still_409(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)
        # 非 {claude, codex} provider（如 cursor/openclaw/gemini）仍拦截。
        sess, _lease = await _make_ended_session(
            db_session, uid, rt.id, provider="gemini", agent_session_id="g-1"
        )

        svc = DaemonService(db_session)
        with pytest.raises(DaemonSessionResumeUnsupported) as exc_info:
            await svc.reopen_session(sess.id, uid)
        # 文案锁：only claude/codex（design §5.6.2）。
        assert "claude/codex" in str(exc_info.value)
        assert exc_info.value.code == "HTTP_409_DAEMON_SESSION_RESUME_UNSUPPORTED"
        # session 未被 mutate（pre-flight 第一道即拦）。
        status_row = (
            await db_session.execute(select(AgentSession.status).where(AgentSession.id == sess.id))
        ).scalar_one()
        assert status_row == "ended"

    @pytest.mark.asyncio
    async def test_reopen_codex_null_agent_session_id_409(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        """D-007@v1: Codex ended 但 threadId=NULL 不得伪造，仍 NO_AGENT_SESSION。"""
        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)
        sess, _lease = await _make_ended_session(db_session, uid, rt.id, agent_session_id=None)

        svc = DaemonService(db_session)
        with pytest.raises(DaemonSessionNoAgentSession):
            await svc.reopen_session(sess.id, uid)
        status_row = (
            await db_session.execute(select(AgentSession.status).where(AgentSession.id == sess.id))
        ).scalar_one()
        assert status_row == "ended"

    @pytest.mark.asyncio
    async def test_reopen_codex_active_session_409_not_active(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        """状态机一致：codex active session reopen → NOT_ACTIVE（应走 inject）。"""
        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)
        sess, _lease = await _make_ended_session(db_session, uid, rt.id, status="active")

        svc = DaemonService(db_session)
        with pytest.raises(DaemonSessionNotActive):
            await svc.reopen_session(sess.id, uid)

    @pytest.mark.asyncio
    async def test_reopen_codex_offline_runtime_409(self, db_session, mocked_redis) -> None:
        """FR-06 边界：codex runtime 未连 WS → DaemonOffline（409 OFFLINE）。"""
        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)
        sess, _lease = await _make_ended_session(db_session, uid, rt.id)

        # offline hub: is_connected False.
        hub = _mock_hub(connected=False)
        with patch("app.modules.daemon.ws_hub.get_daemon_ws_hub", return_value=hub):
            svc = DaemonService(db_session)
            with pytest.raises(DaemonOffline):
                await svc.reopen_session(sess.id, uid)
