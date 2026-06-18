"""Tests for DaemonLeaseService and DaemonService — idempotency, claim, heartbeat, expire, cancel."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import col

from app.modules.agent.model import AgentRun
from app.modules.daemon.lease_service import (
    DaemonLeaseService,
    LeaseConflict,
    LeaseNotClaimable,
    LeaseNotFound,
    LeaseTokenMismatch,
)
from app.modules.daemon.model import DaemonRuntime, DaemonTaskLease
from app.modules.daemon.service import (
    DaemonInvalidClaimToken,
    DaemonRuntimeNotFound,
    DaemonService,
)

# ── Helpers ──────────────────────────────────────────────────────────────────


async def _create_user(session: AsyncSession) -> uuid.UUID:
    """Insert a User row so FK constraints on daemon_runtimes are satisfied."""
    from app.modules.auth.model import User

    uid = uuid.uuid4()
    user = User(
        id=uid,
        email=f"test-{uid}@example.com",
        password_hash="irrelevant",
        display_name="Test",
        status="active",
    )
    session.add(user)
    await session.commit()
    return uid


async def _create_runtime(session: AsyncSession, user_id: uuid.UUID) -> DaemonRuntime:
    """Create a DaemonRuntime row for testing."""
    rt = DaemonRuntime(
        id=uuid.uuid4(),
        user_id=user_id,
        name="test-daemon",
        provider="claude_code",
        status="online",
        last_heartbeat_at=datetime.now(UTC),
    )
    session.add(rt)
    await session.commit()
    await session.refresh(rt)
    return rt


async def _create_lease_row(
    session: AsyncSession,
    runtime_id: uuid.UUID,
    agent_run_id: uuid.UUID,
    *,
    status: str = "claimed",
    claim_token: str | None = None,
    lease_expires_at: datetime | None = None,
    attempt_number: int = 1,
) -> DaemonTaskLease:
    """Low-level lease row insertion for test setup."""
    now = datetime.now(UTC)
    metadata: dict = {}
    if claim_token:
        metadata["claim_token"] = claim_token

    lease = DaemonTaskLease(
        id=uuid.uuid4(),
        runtime_id=runtime_id,
        agent_run_id=agent_run_id,
        status=status,
        claimed_at=now if status == "claimed" else None,
        lease_expires_at=lease_expires_at,
        attempt_number=attempt_number,
        metadata_=metadata,
        created_at=now,
        updated_at=now,
    )
    session.add(lease)
    await session.commit()
    await session.refresh(lease)
    return lease


# ── DaemonLeaseService Tests ─────────────────────────────────────────────────


class TestClaimTask:
    """Tests for DaemonLeaseService.claim_task."""

    @pytest.mark.asyncio
    async def test_claim_task_when_new_lease_created(self, db_session: AsyncSession) -> None:
        """claim_task on fresh agent_run creates a new lease with status='claimed'."""
        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        agent_run_id = uuid.uuid4()

        svc = DaemonLeaseService(db_session)
        lease = await svc.claim_task(rt.id, agent_run_id)

        assert lease is not None
        assert lease.status == "claimed"
        assert lease.agent_run_id == agent_run_id
        assert lease.runtime_id == rt.id
        assert lease.attempt_number == 1
        assert lease.lease_expires_at is not None
        # SQLite may return naive datetimes; normalize before comparing
        _expires = lease.lease_expires_at
        if _expires.tzinfo is None:
            _expires = _expires.replace(tzinfo=UTC)
        assert _expires > datetime.now(UTC)
        # claim_token stored in metadata
        assert lease.metadata_ is not None
        assert "claim_token" in lease.metadata_
        assert len(lease.metadata_["claim_token"]) == 64  # secrets.token_hex(32)

    @pytest.mark.asyncio
    async def test_claim_task_when_duplicate_claim_raises_conflict(
        self, db_session: AsyncSession
    ) -> None:
        """claim_task on same agent_run with active lease raises LeaseConflict (409)."""
        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        agent_run_id = uuid.uuid4()

        svc = DaemonLeaseService(db_session)

        # First claim succeeds
        await svc.claim_task(rt.id, agent_run_id)

        # Second claim on same agent_run should raise
        with pytest.raises(LeaseConflict) as exc_info:
            await svc.claim_task(rt.id, agent_run_id)

        assert exc_info.value.http_status == 409

    @pytest.mark.asyncio
    async def test_claim_task_when_expired_lease_reclaims(self, db_session: AsyncSession) -> None:
        """claim_task on agent_run with expired lease reclaims it, incrementing attempt_number."""
        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        agent_run_id = uuid.uuid4()

        # Create an expired lease manually
        past = datetime.now(UTC) - timedelta(seconds=120)
        expired_lease = await _create_lease_row(
            db_session,
            rt.id,
            agent_run_id,
            status="claimed",
            claim_token="old-token",
            lease_expires_at=past,
            attempt_number=1,
        )

        svc = DaemonLeaseService(db_session)
        reclaimed = await svc.claim_task(rt.id, agent_run_id)

        assert reclaimed.id == expired_lease.id
        assert reclaimed.status == "claimed"
        assert reclaimed.attempt_number == 2
        # New claim_token should differ from old
        assert isinstance(reclaimed.metadata_, dict)
        assert reclaimed.metadata_["claim_token"] != "old-token"
        assert reclaimed.lease_expires_at is not None
        # Normalize for SQLite naive datetime comparison
        _re_expires = reclaimed.lease_expires_at
        if _re_expires.tzinfo is None:
            _re_expires = _re_expires.replace(tzinfo=UTC)
        assert _re_expires > datetime.now(UTC)


class TestHeartbeatLease:
    """Tests for DaemonLeaseService.heartbeat_lease."""

    @pytest.mark.asyncio
    async def test_heartbeat_lease_when_token_matches(self, db_session: AsyncSession) -> None:
        """heartbeat_lease with correct token renews expiry."""
        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        agent_run_id = uuid.uuid4()

        svc = DaemonLeaseService(db_session)
        lease = await svc.claim_task(rt.id, agent_run_id)
        assert isinstance(lease.metadata_, dict)
        claim_token = lease.metadata_["claim_token"]

        old_expires = lease.lease_expires_at
        result = await svc.heartbeat_lease(lease.id, claim_token)

        assert result is True
        # Refresh and check
        await db_session.refresh(lease)
        assert lease.lease_expires_at >= old_expires

    @pytest.mark.asyncio
    async def test_heartbeat_lease_when_token_mismatch(self, db_session: AsyncSession) -> None:
        """heartbeat_lease with wrong token raises LeaseTokenMismatch (403)."""
        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        agent_run_id = uuid.uuid4()

        svc = DaemonLeaseService(db_session)
        lease = await svc.claim_task(rt.id, agent_run_id)

        with pytest.raises(LeaseTokenMismatch) as exc_info:
            await svc.heartbeat_lease(lease.id, "wrong-token-value")

        assert exc_info.value.http_status == 403

    @pytest.mark.asyncio
    async def test_heartbeat_lease_when_lease_not_found(self, db_session: AsyncSession) -> None:
        """heartbeat_lease with non-existent lease_id raises LeaseNotFound."""
        svc = DaemonLeaseService(db_session)
        with pytest.raises(LeaseNotFound):
            await svc.heartbeat_lease(uuid.uuid4(), "some-token")

    @pytest.mark.asyncio
    async def test_heartbeat_lease_when_lease_not_claimed(self, db_session: AsyncSession) -> None:
        """heartbeat_lease on a completed lease raises LeaseNotClaimable."""
        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        agent_run_id = uuid.uuid4()

        # Create a completed lease
        await _create_lease_row(
            db_session,
            rt.id,
            agent_run_id,
            status="completed",
            claim_token="abc",
        )

        svc = DaemonLeaseService(db_session)

        # Find the lease
        stmt = select(DaemonTaskLease).where(
            col(DaemonTaskLease.agent_run_id) == agent_run_id,
        )
        lease = (await db_session.execute(stmt)).scalars().first()

        with pytest.raises(LeaseNotClaimable):
            await svc.heartbeat_lease(lease.id, "abc")


class TestExpireOverdueLeases:
    """Tests for DaemonLeaseService.expire_overdue_leases."""

    @pytest.mark.asyncio
    async def test_expire_overdue_leases_when_overdue(self, db_session: AsyncSession) -> None:
        """expire_overdue_leases marks overdue claimed leases as expired."""
        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        agent_run_id_1 = uuid.uuid4()
        agent_run_id_2 = uuid.uuid4()

        past = datetime.now(UTC) - timedelta(seconds=120)

        # Two overdue leases
        await _create_lease_row(
            db_session,
            rt.id,
            agent_run_id_1,
            status="claimed",
            claim_token="t1",
            lease_expires_at=past,
        )
        await _create_lease_row(
            db_session,
            rt.id,
            agent_run_id_2,
            status="claimed",
            claim_token="t2",
            lease_expires_at=past,
        )

        svc = DaemonLeaseService(db_session)
        expired_ids = await svc.expire_overdue_leases()

        assert len(expired_ids) == 2
        assert agent_run_id_1 in expired_ids
        assert agent_run_id_2 in expired_ids

    @pytest.mark.asyncio
    async def test_expire_overdue_leases_when_none_overdue(self, db_session: AsyncSession) -> None:
        """expire_overdue_leases returns empty list when no leases are overdue."""
        svc = DaemonLeaseService(db_session)
        expired_ids = await svc.expire_overdue_leases()
        assert expired_ids == []

    @pytest.mark.asyncio
    async def test_expire_overdue_leases_skips_non_claimed(self, db_session: AsyncSession) -> None:
        """expire_overdue_leases only expires 'claimed' leases, not 'pending' or 'completed'."""
        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        past = datetime.now(UTC) - timedelta(seconds=120)

        # Pending lease that is overdue — should NOT be expired by this method
        await _create_lease_row(
            db_session,
            rt.id,
            uuid.uuid4(),
            status="pending",
            lease_expires_at=past,
        )

        svc = DaemonLeaseService(db_session)
        expired_ids = await svc.expire_overdue_leases()
        assert expired_ids == []


class TestCancelLease:
    """Tests for DaemonLeaseService.cancel_lease."""

    @pytest.mark.asyncio
    async def test_cancel_lease_when_active(self, db_session: AsyncSession) -> None:
        """cancel_lease sets status='cancelled' for claimed lease."""
        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        agent_run_id = uuid.uuid4()

        svc = DaemonLeaseService(db_session)
        lease = await svc.claim_task(rt.id, agent_run_id)

        await svc.cancel_lease(agent_run_id)

        await db_session.refresh(lease)
        assert lease.status == "cancelled"

    @pytest.mark.asyncio
    async def test_cancel_lease_when_no_active_lease(self, db_session: AsyncSession) -> None:
        """cancel_lease on non-existent agent_run is a no-op (no exception)."""
        svc = DaemonLeaseService(db_session)
        # Should not raise
        await svc.cancel_lease(uuid.uuid4())

    @pytest.mark.asyncio
    async def test_cancel_pending_lease_marks_agent_run_killed(
        self, db_session: AsyncSession
    ) -> None:
        """ql-20260616-006：cancel pending lease（daemon 从未 claim）→ agent_run 立即 killed。

        没有 daemon 心跳触发，必须由 cancel_lease 直接收尾 agent_run，否则永久 pending。
        """
        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        agent_run_id = uuid.uuid4()

        # 创建 agent_run 行（pending）
        ar = AgentRun(id=agent_run_id, agent_type="claude_code", status="pending")
        db_session.add(ar)
        await db_session.commit()

        # 创建 pending lease（daemon 还没 claim）
        await _create_lease_row(
            db_session,
            rt.id,
            agent_run_id,
            status="pending",
        )

        svc = DaemonLeaseService(db_session)
        await svc.cancel_lease(agent_run_id)

        await db_session.refresh(ar)
        assert ar.status == "killed"
        assert ar.finished_at is not None

    @pytest.mark.asyncio
    async def test_cancel_claimed_lease_also_marks_agent_run_killed(
        self, db_session: AsyncSession
    ) -> None:
        """ql-20260617-004：cancel claimed lease 立即把 agent_run 标记为 killed。

        之前等 daemon heartbeat 上报，但 daemon 可能通过 complete_lease(cancelled)
        抢先写 cancelled，导致状态错乱。现在 cancel_lease 立即写 killed，
        daemon 后续 complete_lease 会被 terminal-priority 守卫拦下（killed > cancelled）。
        """
        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        agent_run_id = uuid.uuid4()

        ar = AgentRun(id=agent_run_id, agent_type="claude_code", status="running")
        db_session.add(ar)
        await db_session.commit()

        svc = DaemonLeaseService(db_session)
        lease = await svc.claim_task(rt.id, agent_run_id)

        await svc.cancel_lease(agent_run_id)

        await db_session.refresh(ar)
        # ql-20260617-004：立即 killed，给用户即时反馈
        assert ar.status == "killed"
        assert ar.finished_at is not None
        await db_session.refresh(lease)
        assert lease.status == "cancelled"

    @pytest.mark.asyncio
    async def test_cancel_when_no_lease_but_agent_run_running_also_killed(
        self, db_session: AsyncSession
    ) -> None:
        """ql-20260616-006：无 active lease 但 agent_run 仍 pending/running → 也置 killed。

        兜底场景：lease 已被清理或过期回收，但 agent_run 还卡着。
        """
        agent_run_id = uuid.uuid4()
        ar = AgentRun(id=agent_run_id, agent_type="claude_code", status="pending")
        db_session.add(ar)
        await db_session.commit()

        svc = DaemonLeaseService(db_session)
        await svc.cancel_lease(agent_run_id)  # 无 lease

        await db_session.refresh(ar)
        assert ar.status == "killed"
        assert ar.finished_at is not None

    @pytest.mark.asyncio
    async def test_cancel_idempotent_when_agent_run_already_terminal(
        self, db_session: AsyncSession
    ) -> None:
        """ql-20260616-006：agent_run 已是终态（completed）→ cancel 不动它。"""
        agent_run_id = uuid.uuid4()
        ar = AgentRun(id=agent_run_id, agent_type="claude_code", status="completed")
        db_session.add(ar)
        await db_session.commit()

        svc = DaemonLeaseService(db_session)
        await svc.cancel_lease(agent_run_id)

        await db_session.refresh(ar)
        assert ar.status == "completed"


class TestValidateClaimToken:
    """Tests for DaemonLeaseService.validate_claim_token."""

    @pytest.mark.asyncio
    async def test_validate_claim_token_when_valid(self, db_session: AsyncSession) -> None:
        """validate_claim_token returns lease when token matches."""
        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        agent_run_id = uuid.uuid4()

        svc = DaemonLeaseService(db_session)
        lease = await svc.claim_task(rt.id, agent_run_id)
        assert isinstance(lease.metadata_, dict)
        claim_token = lease.metadata_["claim_token"]

        result = await svc.validate_claim_token(lease.id, claim_token)

        assert result.id == lease.id
        assert result.status == "claimed"

    @pytest.mark.asyncio
    async def test_validate_claim_token_when_wrong_token(self, db_session: AsyncSession) -> None:
        """validate_claim_token raises LeaseTokenMismatch with wrong token."""
        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        agent_run_id = uuid.uuid4()

        svc = DaemonLeaseService(db_session)
        lease = await svc.claim_task(rt.id, agent_run_id)

        with pytest.raises(LeaseTokenMismatch):
            await svc.validate_claim_token(lease.id, "bad-token")

    @pytest.mark.asyncio
    async def test_validate_claim_token_when_lease_not_found(
        self, db_session: AsyncSession
    ) -> None:
        """validate_claim_token raises LeaseNotFound for non-existent lease."""
        svc = DaemonLeaseService(db_session)
        with pytest.raises(LeaseNotFound):
            await svc.validate_claim_token(uuid.uuid4(), "some-token")

    @pytest.mark.asyncio
    async def test_validate_claim_token_when_lease_not_claimed(
        self, db_session: AsyncSession
    ) -> None:
        """validate_claim_token raises LeaseNotClaimable for non-claimed lease."""
        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)

        # Create a pending lease (not claimed)
        await _create_lease_row(
            db_session,
            rt.id,
            uuid.uuid4(),
            status="pending",
        )

        stmt = select(DaemonTaskLease).where(
            col(DaemonTaskLease.runtime_id) == rt.id,
            col(DaemonTaskLease.status) == "pending",
        )
        lease = (await db_session.execute(stmt)).scalars().first()

        svc = DaemonLeaseService(db_session)
        with pytest.raises(LeaseNotClaimable):
            await svc.validate_claim_token(lease.id, "any-token")


# ── DaemonService Tests ──────────────────────────────────────────────────────


class TestRegisterRuntime:
    """Tests for DaemonService.register_runtime."""

    @pytest.mark.asyncio
    async def test_register_runtime_when_new(self, db_session: AsyncSession) -> None:
        """register_runtime creates a new DaemonRuntime record."""
        user_id = await _create_user(db_session)
        svc = DaemonService(db_session)

        rt = await svc.register_runtime(
            user_id,
            name="my-daemon",
            provider="claude_code",
            version="1.0.0",
            os="linux",
            arch="x86_64",
        )

        assert rt.id is not None
        assert rt.user_id == user_id
        assert rt.name == "my-daemon"
        assert rt.provider == "claude_code"
        assert rt.version == "1.0.0"
        assert rt.status == "online"
        assert rt.last_heartbeat_at is not None

    @pytest.mark.asyncio
    async def test_register_runtime_when_idempotent(self, db_session: AsyncSession) -> None:
        """register_runtime with same user+provider+name updates existing record."""
        user_id = await _create_user(db_session)
        svc = DaemonService(db_session)

        rt1 = await svc.register_runtime(
            user_id,
            name="my-daemon",
            provider="claude_code",
            version="1.0.0",
        )
        rt2 = await svc.register_runtime(
            user_id,
            name="my-daemon",
            provider="claude_code",
            version="2.0.0",
        )

        assert rt1.id == rt2.id
        assert rt2.version == "2.0.0"

    @pytest.mark.asyncio
    async def test_register_runtime_preserves_disabled_status(
        self, db_session: AsyncSession
    ) -> None:
        """Re-registering a disabled runtime updates metadata without enabling placement."""
        user_id = await _create_user(db_session)
        svc = DaemonService(db_session)

        rt1 = await svc.register_runtime(
            user_id,
            name="my-daemon",
            provider="claude_code",
            version="1.0.0",
        )
        await svc.disable_runtime(rt1.id, user_id)

        rt2 = await svc.register_runtime(
            user_id,
            name="my-daemon",
            provider="claude_code",
            version="2.0.0",
        )

        assert rt1.id == rt2.id
        assert rt2.version == "2.0.0"
        assert rt2.status == "disabled"

    @pytest.mark.asyncio
    async def test_register_runtime_different_names_creates_separate(
        self, db_session: AsyncSession
    ) -> None:
        """register_runtime with different names creates separate records."""
        user_id = await _create_user(db_session)
        svc = DaemonService(db_session)

        rt1 = await svc.register_runtime(user_id, name="daemon-a", provider="claude_code")
        rt2 = await svc.register_runtime(user_id, name="daemon-b", provider="claude_code")

        assert rt1.id != rt2.id


class TestDaemonHeartbeat:
    """Tests for DaemonService.heartbeat."""

    @pytest.mark.asyncio
    async def test_heartbeat_updates_timestamp(self, db_session: AsyncSession) -> None:
        """heartbeat updates last_heartbeat_at and returns the runtime."""
        user_id = await _create_user(db_session)
        svc = DaemonService(db_session)
        rt = await svc.register_runtime(user_id, name="hb-daemon", provider="claude_code")

        old_hb = rt.last_heartbeat_at
        # Small delay to ensure timestamp differs
        import asyncio

        await asyncio.sleep(0.01)

        updated = await svc.heartbeat(rt.id)
        assert updated.last_heartbeat_at > old_hb
        assert updated.status == "online"

    @pytest.mark.asyncio
    async def test_heartbeat_when_not_found(self, db_session: AsyncSession) -> None:
        """heartbeat on non-existent runtime raises DaemonRuntimeNotFound."""
        svc = DaemonService(db_session)
        with pytest.raises(DaemonRuntimeNotFound):
            await svc.heartbeat(uuid.uuid4())

    @pytest.mark.asyncio
    async def test_heartbeat_preserves_disabled_status(self, db_session: AsyncSession) -> None:
        """Heartbeat keeps disabled runtimes disabled while refreshing freshness."""
        user_id = await _create_user(db_session)
        svc = DaemonService(db_session)
        rt = await svc.register_runtime(user_id, name="disabled-hb", provider="claude_code")
        disabled = await svc.disable_runtime(rt.id, user_id)
        old_hb = datetime.now(UTC) - timedelta(seconds=60)
        disabled.last_heartbeat_at = old_hb
        db_session.add(disabled)
        await db_session.commit()

        updated = await svc.heartbeat(rt.id)

        assert updated.status == "disabled"
        assert updated.last_heartbeat_at is not None
        updated_hb = updated.last_heartbeat_at
        if updated_hb.tzinfo is None:
            updated_hb = updated_hb.replace(tzinfo=UTC)
        assert updated_hb > old_hb

    @pytest.mark.asyncio
    async def test_enable_runtime_uses_heartbeat_freshness(self, db_session: AsyncSession) -> None:
        """Enable restores online only for runtimes with a fresh heartbeat."""
        user_id = await _create_user(db_session)
        svc = DaemonService(db_session)
        rt = await svc.register_runtime(user_id, name="enable-hb", provider="claude_code")

        await svc.disable_runtime(rt.id, user_id)
        fresh = await svc.enable_runtime(rt.id, user_id, max_age_seconds=45)
        assert fresh.status == "online"

        fresh.last_heartbeat_at = datetime.now(UTC) - timedelta(seconds=120)
        db_session.add(fresh)
        await db_session.commit()
        await svc.disable_runtime(rt.id, user_id)

        stale = await svc.enable_runtime(rt.id, user_id, max_age_seconds=45)
        assert stale.status == "offline"

    @pytest.mark.asyncio
    async def test_cleanup_stale_runtimes_marks_old_heartbeats_offline(
        self, db_session: AsyncSession
    ) -> None:
        """cleanup_stale_runtimes marks online runtimes offline after heartbeat timeout."""
        user_id = await _create_user(db_session)
        svc = DaemonService(db_session)
        stale = await svc.register_runtime(user_id, name="stale", provider="claude")
        fresh = await svc.register_runtime(user_id, name="fresh", provider="codex")

        stale.last_heartbeat_at = datetime.now(UTC) - timedelta(seconds=180)
        fresh.last_heartbeat_at = datetime.now(UTC)
        db_session.add(stale)
        db_session.add(fresh)
        await db_session.commit()

        count = await svc.cleanup_stale_runtimes(max_age_seconds=120)

        assert count == 1
        await db_session.refresh(stale)
        await db_session.refresh(fresh)
        assert stale.status == "offline"
        assert fresh.status == "online"

    @pytest.mark.asyncio
    async def test_cleanup_stale_runtimes_ignores_disabled_runtimes(
        self, db_session: AsyncSession
    ) -> None:
        """Disabled runtimes stay disabled even when their heartbeat is stale."""
        user_id = await _create_user(db_session)
        svc = DaemonService(db_session)
        rt = await svc.register_runtime(user_id, name="disabled-stale", provider="claude")
        disabled = await svc.disable_runtime(rt.id, user_id)
        disabled.last_heartbeat_at = datetime.now(UTC) - timedelta(seconds=180)
        db_session.add(disabled)
        await db_session.commit()

        count = await svc.cleanup_stale_runtimes(max_age_seconds=45)

        assert count == 0
        await db_session.refresh(disabled)
        assert disabled.status == "disabled"


class TestCompleteLease:
    """Tests for DaemonService.complete_lease."""

    @pytest.mark.asyncio
    async def test_complete_lease_when_valid(self, db_session: AsyncSession) -> None:
        """complete_lease marks lease as completed."""
        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        agent_run_id = uuid.uuid4()

        lease_svc = DaemonLeaseService(db_session)
        lease = await lease_svc.claim_task(rt.id, agent_run_id)
        assert isinstance(lease.metadata_, dict)
        claim_token = lease.metadata_["claim_token"]

        svc = DaemonService(db_session)
        result = await svc.complete_lease(lease.id, claim_token, {"status": "completed"})

        assert result.status == "completed"

    @pytest.mark.asyncio
    async def test_complete_lease_when_idempotent(self, db_session: AsyncSession) -> None:
        """complete_lease on already completed lease returns same result (idempotent)."""
        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        agent_run_id = uuid.uuid4()

        lease_svc = DaemonLeaseService(db_session)
        lease = await lease_svc.claim_task(rt.id, agent_run_id)
        assert isinstance(lease.metadata_, dict)
        claim_token = lease.metadata_["claim_token"]

        svc = DaemonService(db_session)
        # First complete succeeds
        first_result = await svc.complete_lease(lease.id, claim_token, {"status": "completed"})
        assert first_result.status == "completed"

        # Second complete on same lease is idempotent — returns same status
        second_result = await svc.complete_lease(lease.id, claim_token, {"status": "completed"})
        assert second_result.status == "completed"
        assert first_result.id == second_result.id

    @pytest.mark.asyncio
    async def test_complete_lease_when_wrong_token(self, db_session: AsyncSession) -> None:
        """complete_lease with wrong claim_token raises DaemonInvalidClaimToken."""
        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        agent_run_id = uuid.uuid4()

        lease_svc = DaemonLeaseService(db_session)
        lease = await lease_svc.claim_task(rt.id, agent_run_id)

        svc = DaemonService(db_session)
        with pytest.raises(DaemonInvalidClaimToken):
            await svc.complete_lease(lease.id, "wrong-token", {"status": "completed"})
