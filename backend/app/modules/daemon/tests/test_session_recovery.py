"""Tests for DaemonService.recover_session_after_daemon_restart (task-10).

Covers FR-08 / D-003@v1 daemon-restart recovery reconciliation:
  - session/lease/runtime/provider ownership match → status=reconnecting,
    interrupted currentRun converged to failed (daemon_restarted).
  - interrupted_run_id already terminal → idempotent (keeps completion result).
  - interrupted_run_id belonging to another session → invariant violation.
  - another non-terminal run on same session (besides interrupted_run_id) →
    invariant violation.
  - session already ended/failed → returns terminal, not resurrected.
  - runtime/lease/provider mismatch → rejected.
  - token rotation: lease claim_token rotated on successful recover (防旧 claim 重放).

SQLite ignores FOR UPDATE; the row-lock query + ownership branches are still
exercised (PostgreSQL concurrency proof is environment-gated, see report).
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.model import AgentRun, AgentSession
from app.modules.daemon.model import DaemonRuntime, DaemonTaskLease
from app.modules.daemon.service import (
    DaemonService,
    DaemonSessionInvariantViolation,
)

# ── Fixtures ─────────────────────────────────────────────────────────────────


async def _create_user(session: AsyncSession) -> uuid.UUID:
    from app.modules.auth.model import User

    uid = uuid.uuid4()
    session.add(
        User(
            id=uid,
            email=f"rec-{uid}@example.com",
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


def _mock_redis() -> AsyncMock:
    redis = AsyncMock()
    redis.publish = AsyncMock()
    return redis


@pytest.fixture()
def mocked_redis():
    redis = _mock_redis()
    with patch("app.modules.daemon.service.get_redis", return_value=redis):
        yield redis


async def _make_active_session(
    db_session: AsyncSession,
    *,
    user_id: uuid.UUID,
    runtime: DaemonRuntime,
    session_status: str = "active",
    agent_session_id_sdk: str = "sdk-sess-1",
    current_run_status: str | None = "running",
    claim_token: str = "old-token",
) -> tuple[AgentSession, AgentRun, DaemonTaskLease]:
    """Build a session + run + interactive lease triple directly in the DB."""
    now = datetime.now(UTC)
    lease = DaemonTaskLease(
        id=uuid.uuid4(),
        runtime_id=runtime.id,
        status="claimed",
        kind="interactive",
        claimed_at=now,
        lease_expires_at=now,
        metadata_={"claim_token": claim_token},
    )
    db_session.add(lease)
    await db_session.flush()

    session = AgentSession(
        id=uuid.uuid4(),
        user_id=user_id,
        runtime_id=runtime.id,
        lease_id=lease.id,
        provider="claude",
        status=session_status,
        agent_session_id=agent_session_id_sdk,
        config={"manual_approval": False},
        turn_count=1,
        created_at=now,
        last_active_at=now,
        cwd="C:\\work",
    )
    db_session.add(session)
    await db_session.flush()

    run: AgentRun | None = None
    if current_run_status is not None:
        run = AgentRun(
            id=uuid.uuid4(),
            agent_type="claude_code",
            provider="claude",
            status=current_run_status,
            spec_strategy="interactive",
            agent_session_id=session.id,
        )
        db_session.add(run)
        await db_session.flush()

    await db_session.commit()
    await db_session.refresh(lease)
    await db_session.refresh(session)
    if run is not None:
        await db_session.refresh(run)
    return session, run, lease  # type: ignore[return-value]


# ── recover_session_after_daemon_restart ──────────────────────────────────────


class TestRecoverSessionAfterDaemonRestart:
    @pytest.mark.asyncio
    async def test_ownership_match_active_with_running_run_converges(
        self, db_session, mocked_redis
    ) -> None:
        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)
        session, run, lease = await _make_active_session(
            db_session,
            user_id=uid,
            runtime=rt,
            current_run_status="running",
        )

        svc = DaemonService(db_session)
        result = await svc.recover_session_after_daemon_restart(
            session.id,
            runtime_id=rt.id,
            lease_id=lease.id,
            provider="claude",
            agent_session_id="sdk-sess-1",
            interrupted_run_id=run.id,
        )

        assert result.status == "reconnecting"
        assert result.interrupted_run_status == "failed"
        await db_session.refresh(session)
        await db_session.refresh(run)
        await db_session.refresh(lease)
        assert session.status == "reconnecting"
        assert run.status == "failed"
        assert run.error_code == "daemon_restarted"
        assert run.finished_at is not None

    @pytest.mark.asyncio
    async def test_active_no_current_run_writes_reconnecting_only(
        self, db_session, mocked_redis
    ) -> None:
        """Boundary 7: crashed while idle (no running run) — no fake run created."""
        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)
        session, _run, lease = await _make_active_session(
            db_session,
            user_id=uid,
            runtime=rt,
            current_run_status=None,
        )

        svc = DaemonService(db_session)
        result = await svc.recover_session_after_daemon_restart(
            session.id,
            runtime_id=rt.id,
            lease_id=lease.id,
            provider="claude",
            agent_session_id="sdk-sess-1",
            interrupted_run_id=None,
        )

        assert result.status == "reconnecting"
        assert result.interrupted_run_status is None
        await db_session.refresh(session)
        assert session.status == "reconnecting"

    @pytest.mark.asyncio
    async def test_interrupted_run_already_terminal_keeps_result(
        self, db_session, mocked_redis
    ) -> None:
        """Boundary 11: run already completed before crash — idempotent."""
        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)
        session, run, lease = await _make_active_session(
            db_session,
            user_id=uid,
            runtime=rt,
            current_run_status="completed",
        )
        run.output_redacted = "done-content"
        db_session.add(run)
        await db_session.commit()

        svc = DaemonService(db_session)
        result = await svc.recover_session_after_daemon_restart(
            session.id,
            runtime_id=rt.id,
            lease_id=lease.id,
            provider="claude",
            agent_session_id="sdk-sess-1",
            interrupted_run_id=run.id,
        )

        # session 仍可继续恢复（reconnecting），run 保持 completed（幂等不改）。
        assert result.status == "reconnecting"
        await db_session.refresh(run)
        assert run.status == "completed"
        assert run.output_redacted == "done-content"

    @pytest.mark.asyncio
    async def test_interrupted_run_belongs_to_other_session_invariant(
        self, db_session, mocked_redis
    ) -> None:
        """Boundary 10: interrupted_run_id points to another session → 409."""
        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)
        session_a, _run_a, lease_a = await _make_active_session(
            db_session, user_id=uid, runtime=rt, current_run_status=None
        )
        _session_b, run_b, _lease_b = await _make_active_session(
            db_session,
            user_id=uid,
            runtime=rt,
            current_run_status="running",
            agent_session_id_sdk="sdk-sess-2",
        )

        svc = DaemonService(db_session)
        with pytest.raises(DaemonSessionInvariantViolation):
            await svc.recover_session_after_daemon_restart(
                session_a.id,
                runtime_id=rt.id,
                lease_id=lease_a.id,
                provider="claude",
                agent_session_id="sdk-sess-1",
                interrupted_run_id=run_b.id,  # belongs to session_b
            )

    @pytest.mark.asyncio
    async def test_another_nonterminal_run_on_same_session_invariant(
        self, db_session, mocked_redis
    ) -> None:
        """Boundary: interrupted_run_id given but another non-terminal run exists."""
        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)
        session, run_a, lease = await _make_active_session(
            db_session, user_id=uid, runtime=rt, current_run_status="running"
        )
        # second non-terminal run on same session (violates 1-active invariant).
        run_b = AgentRun(
            id=uuid.uuid4(),
            agent_type="claude_code",
            provider="claude",
            status="pending",
            spec_strategy="interactive",
            agent_session_id=session.id,
        )
        db_session.add(run_b)
        await db_session.commit()

        svc = DaemonService(db_session)
        with pytest.raises(DaemonSessionInvariantViolation):
            await svc.recover_session_after_daemon_restart(
                session.id,
                runtime_id=rt.id,
                lease_id=lease.id,
                provider="claude",
                agent_session_id="sdk-sess-1",
                interrupted_run_id=run_a.id,
            )

    @pytest.mark.asyncio
    async def test_session_already_ended_returns_ended_no_resurrect(
        self, db_session, mocked_redis
    ) -> None:
        """Boundary 8: session already ended → return ended, no run convergence."""
        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)
        session, _run, lease = await _make_active_session(
            db_session,
            user_id=uid,
            runtime=rt,
            session_status="ended",
            current_run_status=None,
        )

        svc = DaemonService(db_session)
        result = await svc.recover_session_after_daemon_restart(
            session.id,
            runtime_id=rt.id,
            lease_id=lease.id,
            provider="claude",
            agent_session_id="sdk-sess-1",
            interrupted_run_id=None,
        )
        assert result.status == "ended"

    @pytest.mark.asyncio
    async def test_session_already_failed_returns_failed(self, db_session, mocked_redis) -> None:
        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)
        session, _run, lease = await _make_active_session(
            db_session,
            user_id=uid,
            runtime=rt,
            session_status="failed",
            current_run_status=None,
        )

        svc = DaemonService(db_session)
        result = await svc.recover_session_after_daemon_restart(
            session.id,
            runtime_id=rt.id,
            lease_id=lease.id,
            provider="claude",
            agent_session_id="sdk-sess-1",
            interrupted_run_id=None,
        )
        assert result.status == "failed"

    @pytest.mark.asyncio
    async def test_runtime_mismatch_rejected(self, db_session, mocked_redis) -> None:
        """Boundary 9: runtime_id mismatch → rejected."""
        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)
        session, _run, lease = await _make_active_session(
            db_session, user_id=uid, runtime=rt, current_run_status=None
        )

        svc = DaemonService(db_session)
        result = await svc.recover_session_after_daemon_restart(
            session.id,
            runtime_id=uuid.uuid4(),  # mismatched
            lease_id=lease.id,
            provider="claude",
            agent_session_id="sdk-sess-1",
            interrupted_run_id=None,
        )
        assert result.status == "rejected"

    @pytest.mark.asyncio
    async def test_lease_kind_not_interactive_rejected(self, db_session, mocked_redis) -> None:
        """FR-09 守门：batch lease 不进 recover（rejected）。"""
        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)
        # Build a session bound to a BATCH lease (shouldn't happen, but guard).
        now = datetime.now(UTC)
        batch_lease = DaemonTaskLease(
            id=uuid.uuid4(),
            runtime_id=rt.id,
            status="claimed",
            kind="batch",
            claimed_at=now,
            lease_expires_at=now,
            metadata_={"claim_token": "x"},
        )
        db_session.add(batch_lease)
        await db_session.flush()
        session = AgentSession(
            id=uuid.uuid4(),
            user_id=uid,
            runtime_id=rt.id,
            lease_id=batch_lease.id,
            provider="claude",
            status="active",
            agent_session_id="sdk-sess-1",
            turn_count=1,
            created_at=now,
            last_active_at=now,
        )
        db_session.add(session)
        await db_session.commit()

        svc = DaemonService(db_session)
        result = await svc.recover_session_after_daemon_restart(
            session.id,
            runtime_id=rt.id,
            lease_id=batch_lease.id,
            provider="claude",
            agent_session_id="sdk-sess-1",
            interrupted_run_id=None,
        )
        assert result.status == "rejected"

    @pytest.mark.asyncio
    async def test_token_rotated_on_successful_recover(self, db_session, mocked_redis) -> None:
        """防旧 claim 重放：recover 成功旋转 lease.claim_token（new value != old）。"""
        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)
        session, run, lease = await _make_active_session(
            db_session,
            user_id=uid,
            runtime=rt,
            current_run_status="running",
            claim_token="old-secret-token",
        )

        svc = DaemonService(db_session)
        await svc.recover_session_after_daemon_restart(
            session.id,
            runtime_id=rt.id,
            lease_id=lease.id,
            provider="claude",
            agent_session_id="sdk-sess-1",
            interrupted_run_id=run.id,
        )
        await db_session.refresh(lease)
        new_token = (lease.metadata_ or {}).get("claim_token")
        assert new_token is not None
        assert new_token != "old-secret-token"

    @pytest.mark.asyncio
    async def test_session_not_found_returns_rejected(self, db_session, mocked_redis) -> None:
        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)
        svc = DaemonService(db_session)
        result = await svc.recover_session_after_daemon_restart(
            uuid.uuid4(),
            runtime_id=rt.id,
            lease_id=uuid.uuid4(),
            provider="claude",
            agent_session_id="x",
            interrupted_run_id=None,
        )
        assert result.status == "rejected"

    @pytest.mark.asyncio
    async def test_session_in_reconnecting_idempotent_re_recover(
        self, db_session, mocked_redis
    ) -> None:
        """Idempotent re-recover: already reconnecting → stay reconnecting, converge run."""
        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)
        session, run, lease = await _make_active_session(
            db_session,
            user_id=uid,
            runtime=rt,
            current_run_status="running",
            session_status="reconnecting",
        )

        svc = DaemonService(db_session)
        result = await svc.recover_session_after_daemon_restart(
            session.id,
            runtime_id=rt.id,
            lease_id=lease.id,
            provider="claude",
            agent_session_id="sdk-sess-1",
            interrupted_run_id=run.id,
        )
        assert result.status == "reconnecting"
        await db_session.refresh(run)
        assert run.status == "failed"
