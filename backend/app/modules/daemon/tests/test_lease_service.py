"""Tests for DaemonLeaseService and DaemonService — idempotency, claim, heartbeat, expire, cancel."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import col

from app.modules.agent.model import AgentRun, AgentSession
from app.modules.daemon.lease_service import (
    DaemonLeaseService,
    LeaseConflict,
    LeaseNotClaimable,
    LeaseNotFound,
    LeaseTokenMismatch,
)
from app.modules.daemon.model import DaemonInstance, DaemonRuntime, DaemonTaskLease
from app.modules.daemon.service import (
    DaemonInvalidClaimToken,
    DaemonRuntimeInUse,
    DaemonRuntimeNotFound,
    DaemonService,
)
from app.modules.workspace.model import Workspace

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


async def _legacy_register_runtime(
    session: AsyncSession,
    user_id: uuid.UUID,
    *,
    name: str | None = None,
    provider: str | None = None,
    version: str | None = None,
) -> DaemonRuntime:
    """兼容旧 register_runtime 签名的测试 helper（2026-07-03-daemon-entity-binding）。

    旧 ``register_runtime`` 已被 per-daemon ``register_daemon`` 取代。仍按 per-provider
    语义创建单 runtime 行的测试（heartbeat/disable/enable/delete/cleanup）改用本 helper：
    每次创建独立的 DaemonInstance + 挂在其下的单个 DaemonRuntime，返回该 runtime。
    """
    instance_id = uuid.uuid4()
    instance = DaemonInstance(
        id=instance_id,
        user_id=user_id,
        hostname=name or "test-host",
        server_url="http://test.local",
        status="online",
        last_heartbeat_at=datetime.now(UTC),
    )
    session.add(instance)
    rt = DaemonRuntime(
        id=uuid.uuid4(),
        daemon_instance_id=instance_id,
        user_id=user_id,
        name=name,
        provider=provider,
        version=version,
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

    @pytest.mark.asyncio
    async def test_cancel_interactive_lease_sends_session_interrupt(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """ql-20260712-001（P0-1）：interactive lease cancel → WS 下发 SESSION_INTERRUPT。

        interactive lease 不进 daemon 心跳循环，必须经 WS Hub 显式中断，否则 SDK
        进程在 daemon 内存里继续烧 token 成僵尸（lease/AgentRun 在 DB 已 killed）。
        """
        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        lease_id, agent_run_id, _claim_token = await _create_run_with_session(
            db_session,
            rt.id,
            user_id,
            change_id=None,
            spec_strategy="platform-managed",
            agent_session_id=None,
        )

        # capture WS send（_send_interactive_cancel 内 lazy import 拿 patched 函数）
        sent: list[tuple] = []
        from app.modules.daemon import ws_hub as ws_hub_mod

        class _FakeHub:
            async def send_session_control(self, daemon_id, msg_type, payload):
                sent.append((daemon_id, msg_type, payload))
                return True

        monkeypatch.setattr(ws_hub_mod, "get_daemon_ws_hub", lambda: _FakeHub())

        svc = DaemonLeaseService(db_session)
        await svc.cancel_lease(agent_run_id)

        # WS 发了 SESSION_INTERRUPT，payload 带 session/lease/runtime
        assert len(sent) == 1
        _daemon_id, msg_type, payload = sent[0]
        assert msg_type == "daemon:session_interrupt"
        assert payload["lease_id"] == str(lease_id)
        assert "session_id" in payload
        assert "runtime_id" in payload
        # lease 仍正常收尾（WS best-effort，DB 已 cancelled）
        lease = await db_session.get(DaemonTaskLease, lease_id)
        assert lease is not None
        assert lease.status == "cancelled"

    @pytest.mark.asyncio
    async def test_cancel_batch_lease_does_not_send_ws(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """ql-20260712-001（P0-1）：batch lease cancel 不发 WS（靠 daemon 心跳感知 cancelled）。"""
        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        agent_run_id = uuid.uuid4()
        ar = AgentRun(id=agent_run_id, agent_type="claude_code", status="running")
        db_session.add(ar)
        await db_session.commit()

        svc = DaemonLeaseService(db_session)
        lease = await svc.claim_task(rt.id, agent_run_id)  # 默认 kind="batch"

        sent: list[tuple] = []
        from app.modules.daemon import ws_hub as ws_hub_mod

        class _FakeHub:
            async def send_session_control(self, daemon_id, msg_type, payload):
                sent.append((daemon_id, msg_type, payload))
                return True

        monkeypatch.setattr(ws_hub_mod, "get_daemon_ws_hub", lambda: _FakeHub())

        await svc.cancel_lease(agent_run_id)

        assert sent == []  # batch 不走 WS（靠心跳 SIGTERM）
        await db_session.refresh(lease)
        assert lease.status == "cancelled"

    @pytest.mark.asyncio
    async def test_cancel_interactive_ws_failure_does_not_block(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """ql-20260712-001（P0-1）：WS 异常 → 不阻塞 cancel（DB 仍 cancelled/killed）。"""
        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        lease_id, agent_run_id, _claim_token = await _create_run_with_session(
            db_session,
            rt.id,
            user_id,
            change_id=None,
            spec_strategy="platform-managed",
            agent_session_id=None,
        )

        from app.modules.daemon import ws_hub as ws_hub_mod

        class _BoomHub:
            async def send_session_control(self, daemon_id, msg_type, payload):
                raise RuntimeError("daemon unreachable")

        monkeypatch.setattr(ws_hub_mod, "get_daemon_ws_hub", lambda: _BoomHub())

        svc = DaemonLeaseService(db_session)
        await svc.cancel_lease(agent_run_id)  # best-effort，不抛

        lease = await db_session.get(DaemonTaskLease, lease_id)
        assert lease is not None
        assert lease.status == "cancelled"


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


class TestRegisterDaemon:
    """Tests for DaemonService.register_daemon (per-daemon, design §5.2 / D-006)."""

    @pytest.mark.asyncio
    async def test_register_daemon_creates_instance_and_runtimes(
        self, db_session: AsyncSession
    ) -> None:
        """验收 1：单 daemon 注册后 daemon_instances 恰好 1 行、daemon_runtimes N 行，
        均挂同一 daemon_instance_id。
        """
        user_id = await _create_user(db_session)
        svc = DaemonService(db_session)
        daemon_local_id = uuid.uuid4()

        result = await svc.register_daemon(
            user_id,
            daemon_local_id=daemon_local_id,
            server_url="http://hub.local",
            hostname="host-a",
            os="linux",
            arch="x86_64",
            allowed_roots=["~/.sillyhub"],
            providers=[
                {"provider": "claude", "version": "1.2.0", "status": "online"},
                {"provider": "codex", "version": "0.1.0", "status": "online"},
            ],
        )

        assert result.daemon_instance_id == daemon_local_id
        providers_returned = {r.provider: r.runtime_id for r in result.runtimes}
        assert set(providers_returned) == {"claude", "codex"}

        # 验收 1：daemon_instances 恰好 1 行
        instances = (await db_session.execute(select(DaemonInstance))).scalars().all()
        assert len(instances) == 1
        inst = instances[0]
        assert inst.id == daemon_local_id
        assert inst.user_id == user_id
        assert inst.hostname == "host-a"
        assert inst.os == "linux"
        assert inst.status == "online"
        assert inst.last_heartbeat_at is not None

        # daemon_runtimes N 行（=上报 provider 数），均挂同一 daemon_instance_id
        runtimes = (
            (
                await db_session.execute(
                    select(DaemonRuntime).where(
                        col(DaemonRuntime.daemon_instance_id) == daemon_local_id
                    )
                )
            )
            .scalars()
            .all()
        )
        assert len(runtimes) == 2
        assert {rt.provider for rt in runtimes} == {"claude", "codex"}
        assert all(rt.daemon_instance_id == daemon_local_id for rt in runtimes)
        # runtime_id 与返回值一致
        for rt in runtimes:
            assert rt.provider is not None
            assert rt.id == providers_returned[rt.provider]

    @pytest.mark.asyncio
    async def test_register_daemon_reuses_identity_on_hostname_change(
        self, db_session: AsyncSession
    ) -> None:
        """验收 2：换 hostname 重启 daemon → daemon_instances.id 不变（复用 daemon_local_id）。"""
        user_id = await _create_user(db_session)
        svc = DaemonService(db_session)
        daemon_local_id = uuid.uuid4()

        await svc.register_daemon(
            user_id,
            daemon_local_id=daemon_local_id,
            server_url="http://hub.local",
            hostname="host-old",
            providers=[{"provider": "claude", "version": "1.0.0"}],
        )
        # 换 hostname 重启
        await svc.register_daemon(
            user_id,
            daemon_local_id=daemon_local_id,
            server_url="http://hub.local",
            hostname="host-new",
            providers=[{"provider": "claude", "version": "1.0.0"}],
        )

        instances = (
            (
                await db_session.execute(
                    select(DaemonInstance).where(col(DaemonInstance.id) == daemon_local_id)
                )
            )
            .scalars()
            .all()
        )
        assert len(instances) == 1
        assert instances[0].hostname == "host-new"
        # runtime 也复用（同 provider 不重建 id）
        runtimes = (
            (
                await db_session.execute(
                    select(DaemonRuntime).where(
                        col(DaemonRuntime.daemon_instance_id) == daemon_local_id
                    )
                )
            )
            .scalars()
            .all()
        )
        assert len(runtimes) == 1

    @pytest.mark.asyncio
    async def test_register_daemon_stale_cleanup_removes_unreported_provider(
        self, db_session: AsyncSession
    ) -> None:
        """验收 3：provider 卸载重注册后，对应 daemon_runtimes 行被删除。"""
        user_id = await _create_user(db_session)
        svc = DaemonService(db_session)
        daemon_local_id = uuid.uuid4()

        first = await svc.register_daemon(
            user_id,
            daemon_local_id=daemon_local_id,
            server_url="http://hub.local",
            hostname="host",
            providers=[
                {"provider": "claude", "version": "1.0.0"},
                {"provider": "codex", "version": "0.5.0"},
            ],
        )
        claude_rid = next(r.runtime_id for r in first.runtimes if r.provider == "claude")
        codex_rid = next(r.runtime_id for r in first.runtimes if r.provider == "codex")

        # 重注册时只报 claude（codex 卸载）→ codex runtime 应被清理
        await svc.register_daemon(
            user_id,
            daemon_local_id=daemon_local_id,
            server_url="http://hub.local",
            hostname="host",
            providers=[{"provider": "claude", "version": "1.1.0"}],
        )

        runtimes = (
            (
                await db_session.execute(
                    select(DaemonRuntime).where(
                        col(DaemonRuntime.daemon_instance_id) == daemon_local_id
                    )
                )
            )
            .scalars()
            .all()
        )
        providers = {rt.provider for rt in runtimes}
        assert providers == {"claude"}
        # claude runtime 复用同一 id
        assert any(rt.id == claude_rid for rt in runtimes)
        # codex runtime 已删除
        assert await db_session.get(DaemonRuntime, codex_rid) is None

    @pytest.mark.asyncio
    async def test_register_daemon_rejects_cross_user_hijack(
        self, db_session: AsyncSession
    ) -> None:
        """归属校验：daemon_local_id 已被其他用户注册 → 403 防劫持。"""
        from app.modules.daemon.service import DaemonInstanceOwnershipMismatch

        owner = await _create_user(db_session)
        intruder = await _create_user(db_session)
        svc = DaemonService(db_session)
        daemon_local_id = uuid.uuid4()

        await svc.register_daemon(
            owner,
            daemon_local_id=daemon_local_id,
            server_url="http://hub.local",
            hostname="host",
            providers=[{"provider": "claude", "version": "1.0.0"}],
        )

        with pytest.raises(DaemonInstanceOwnershipMismatch) as exc_info:
            await svc.register_daemon(
                intruder,
                daemon_local_id=daemon_local_id,
                server_url="http://hub.local",
                hostname="host",
                providers=[{"provider": "claude", "version": "1.0.0"}],
            )
        assert exc_info.value.http_status == 403


class TestDeleteRuntime:
    """Tests for DaemonService.delete_runtime (ql-012)."""

    @pytest.mark.asyncio
    async def test_delete_runtime_removes_row(self, db_session: AsyncSession) -> None:
        """delete_runtime physically removes the runtime row."""
        user_id = await _create_user(db_session)
        svc = DaemonService(db_session)
        rt = await _legacy_register_runtime(
            db_session, user_id, name="to-delete", provider="claude_code"
        )

        await svc.delete_runtime(rt.id, user_id)

        assert await svc.get_runtime(rt.id) is None

    @pytest.mark.asyncio
    async def test_delete_runtime_other_owner_not_found(self, db_session: AsyncSession) -> None:
        """Cross-user delete surfaces as DaemonRuntimeNotFound (no existence leak)."""
        owner = await _create_user(db_session)
        intruder = await _create_user(db_session)
        svc = DaemonService(db_session)
        rt = await _legacy_register_runtime(db_session, owner, name="owned", provider="claude_code")

        with pytest.raises(DaemonRuntimeNotFound):
            await svc.delete_runtime(rt.id, intruder)

        # 归属者的 runtime 未被越权删除
        assert await svc.get_runtime(rt.id) is not None

    @pytest.mark.asyncio
    async def test_delete_runtime_blocked_when_inflight_lease(
        self, db_session: AsyncSession
    ) -> None:
        """D-003@v1（2026-07-05-daemon-client-change-binding-fix）：runtime 仍有
        in-flight lease 时删除被拒 → DaemonRuntimeInUse (409)。

        替代旧 test_delete_runtime_blocked_when_workspace_bound（测 workspace 绑定阻止删除，
        daemon-entity-binding 后 workspaces.daemon_runtime_id 恒 NULL，该 RESTRICT 失效）。
        新链路 RESTRICT 改查 daemon_task_leases + daemon_change_writes 的 in-flight runtime_id。
        """
        user_id = await _create_user(db_session)
        svc = DaemonService(db_session)
        rt = await _legacy_register_runtime(
            db_session, user_id, name="inflight-daemon", provider="claude_code"
        )
        # in-flight lease 引用本 runtime → 应阻止删除。
        db_session.add(
            DaemonTaskLease(
                id=uuid.uuid4(),
                runtime_id=rt.id,
                status="pending",
            )
        )
        await db_session.commit()

        with pytest.raises(DaemonRuntimeInUse) as exc_info:
            await svc.delete_runtime(rt.id, user_id)

        # runtime 未被删
        assert await svc.get_runtime(rt.id) is not None
        # details 带 in-flight 计数 + 状态码 409
        assert exc_info.value.http_status == 409
        details = exc_info.value.details
        assert details is not None
        assert details["inflight_leases"] == 1

    @pytest.mark.asyncio
    async def test_delete_runtime_allows_when_workspace_soft_deleted(
        self, db_session: AsyncSession
    ) -> None:
        """软删 workspace 引用的 runtime：直接删除（task-09 D-007 P0-4）。

        原 ql-002-7c3a 应用层 SET NULL 解绑段已删除——legacy
        ``workspaces.daemon_runtime_id`` 列在 D-007 中 DROP（task-01），新链路
        binding 不再写该列，删除 runtime 不再触碰 workspaces 表。本测试守护新契约：
        软删 workspace 存在时不阻塞 runtime 物理删除（CASCADE 清理 bound 行，
        无需 SET NULL 解绑）。
        """
        user_id = await _create_user(db_session)
        svc = DaemonService(db_session)
        rt = await _legacy_register_runtime(
            db_session, user_id, name="freed-daemon", provider="claude_code"
        )

        ws = Workspace(
            id=uuid.uuid4(),
            name="soft-deleted-ws",
            slug=f"soft-ws-{rt.id.hex[:8]}",
            root_path="/tmp/soft",
            deleted_at=datetime.now(UTC),
        )
        db_session.add(ws)
        await db_session.commit()

        await svc.delete_runtime(rt.id, user_id)
        # runtime 已删（软删 workspace 不再阻塞，legacy daemon_runtime_id 列已 DROP）
        assert await svc.get_runtime(rt.id) is None


class TestDaemonHeartbeat:
    """Tests for DaemonService.heartbeat_daemon (per-daemon, task-07)."""

    @pytest.mark.asyncio
    async def test_heartbeat_daemon_refreshes_instance_and_provider_status(
        self, db_session: AsyncSession
    ) -> None:
        """per-daemon 心跳刷新 daemon_instances.last_heartbeat_at + 各 runtime.status。"""
        user_id = await _create_user(db_session)
        svc = DaemonService(db_session)
        result = await svc.register_daemon(
            user_id,
            daemon_local_id=uuid.uuid4(),
            server_url="http://test.local",
            hostname="hb-daemon",
            providers=[
                {"provider": "claude", "version": "1.0"},
                {"provider": "codex", "version": "2.0"},
            ],
        )
        daemon_local_id = result.daemon_instance_id

        # 把 instance + runtime 心跳拨旧，验证心跳能拉回 fresh。
        old_hb = datetime.now(UTC) - timedelta(seconds=30)
        instance = await db_session.get(DaemonInstance, daemon_local_id)
        assert instance is not None
        instance.last_heartbeat_at = old_hb
        instance.status = "offline"  # 模拟曾被 stale 标 offline
        db_session.add(instance)
        for rt in result.runtimes:
            r = await db_session.get(DaemonRuntime, rt.runtime_id)
            assert r is not None
            r.last_heartbeat_at = old_hb
            r.status = "offline"
            db_session.add(r)
        await db_session.commit()

        import asyncio

        await asyncio.sleep(0.01)

        updated = await svc.heartbeat_daemon(
            daemon_local_id,
            providers=[
                {"provider": "claude", "status": "online"},
                {"provider": "codex", "status": "online"},
            ],
        )
        assert updated.id == daemon_local_id
        assert updated.status == "online"
        updated_hb = updated.last_heartbeat_at
        assert updated_hb is not None
        if updated_hb.tzinfo is None:
            updated_hb = updated_hb.replace(tzinfo=UTC)
        assert updated_hb > old_hb
        # 各 runtime status 跟随上报值（online）+ last_heartbeat_at 同步刷新。
        for rt in result.runtimes:
            r = await db_session.get(DaemonRuntime, rt.runtime_id)
            assert r is not None
            assert r.status == "online"
            assert r.last_heartbeat_at is not None
            rt_hb = r.last_heartbeat_at
            if rt_hb.tzinfo is None:
                rt_hb = rt_hb.replace(tzinfo=UTC)
            assert rt_hb > old_hb

    @pytest.mark.asyncio
    async def test_heartbeat_daemon_when_instance_not_found(self, db_session: AsyncSession) -> None:
        """heartbeat_daemon on non-existent daemon_local_id raises DaemonRuntimeNotFound."""
        svc = DaemonService(db_session)
        with pytest.raises(DaemonRuntimeNotFound):
            await svc.heartbeat_daemon(uuid.uuid4(), providers=[])

    @pytest.mark.asyncio
    async def test_heartbeat_daemon_preserves_disabled_runtime(
        self, db_session: AsyncSession
    ) -> None:
        """disabled runtime 不被心跳拉回 online（管理员禁用意图保留）。"""
        user_id = await _create_user(db_session)
        svc = DaemonService(db_session)
        result = await svc.register_daemon(
            user_id,
            daemon_local_id=uuid.uuid4(),
            server_url="http://test.local",
            hostname="disabled-hb",
            providers=[{"provider": "claude"}],
        )
        rt_id = result.runtimes[0].runtime_id
        # 先 disable 该 runtime（管理员禁用）
        await svc.disable_runtime(rt_id, user_id)

        updated = await svc.heartbeat_daemon(
            result.daemon_instance_id,
            providers=[{"provider": "claude", "status": "online"}],
        )
        assert updated.status == "online"  # daemon 实体被拉回 online
        r = await db_session.get(DaemonRuntime, rt_id)
        assert r is not None
        assert r.status == "disabled"  # runtime 保留 disabled

    @pytest.mark.asyncio
    async def test_enable_runtime_uses_heartbeat_freshness(self, db_session: AsyncSession) -> None:
        """Enable restores online only for runtimes with a fresh heartbeat."""
        user_id = await _create_user(db_session)
        svc = DaemonService(db_session)
        rt = await _legacy_register_runtime(
            db_session, user_id, name="enable-hb", provider="claude_code"
        )

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
    async def test_cleanup_stale_runtimes_marks_daemon_offline_and_cascades(
        self, db_session: AsyncSession
    ) -> None:
        """cleanup_stale_runtimes: daemon 实体心跳过期 → instance offline + 其下 runtime 联动 offline (task-07)。"""
        user_id = await _create_user(db_session)
        svc = DaemonService(db_session)

        # stale daemon（两 provider，heartbeat 拨旧）
        stale_result = await svc.register_daemon(
            user_id,
            daemon_local_id=uuid.uuid4(),
            server_url="http://stale.local",
            hostname="stale",
            providers=[{"provider": "claude"}, {"provider": "codex"}],
        )
        stale_instance = await db_session.get(DaemonInstance, stale_result.daemon_instance_id)
        assert stale_instance is not None
        stale_instance.last_heartbeat_at = datetime.now(UTC) - timedelta(seconds=180)
        db_session.add(stale_instance)
        # fresh daemon（heartbeat fresh）
        fresh_result = await svc.register_daemon(
            user_id,
            daemon_local_id=uuid.uuid4(),
            server_url="http://fresh.local",
            hostname="fresh",
            providers=[{"provider": "gemini"}],
        )
        fresh_instance = await db_session.get(DaemonInstance, fresh_result.daemon_instance_id)
        assert fresh_instance is not None
        fresh_instance.last_heartbeat_at = datetime.now(UTC)
        db_session.add(fresh_instance)
        await db_session.commit()

        count = await svc.cleanup_stale_runtimes(max_age_seconds=120)

        assert count == 1  # 1 个 daemon 实体被标 offline
        await db_session.refresh(stale_instance)
        await db_session.refresh(fresh_instance)
        assert stale_instance.status == "offline"
        assert fresh_instance.status == "online"
        # stale daemon 下两个 runtime 联动 offline
        for rt in stale_result.runtimes:
            r = await db_session.get(DaemonRuntime, rt.runtime_id)
            assert r is not None
            assert r.status == "offline"
        # fresh daemon 的 runtime 仍 online
        for rt in fresh_result.runtimes:
            r = await db_session.get(DaemonRuntime, rt.runtime_id)
            assert r is not None
            assert r.status == "online"

    @pytest.mark.asyncio
    async def test_cleanup_stale_runtimes_ignores_disabled_runtimes(
        self, db_session: AsyncSession
    ) -> None:
        """Disabled runtimes stay disabled even when their daemon heartbeat is stale."""
        user_id = await _create_user(db_session)
        svc = DaemonService(db_session)
        result = await svc.register_daemon(
            user_id,
            daemon_local_id=uuid.uuid4(),
            server_url="http://test.local",
            hostname="disabled-stale",
            providers=[{"provider": "claude"}],
        )
        rt_id = result.runtimes[0].runtime_id
        await svc.disable_runtime(rt_id, user_id)
        instance = await db_session.get(DaemonInstance, result.daemon_instance_id)
        assert instance is not None
        instance.last_heartbeat_at = datetime.now(UTC) - timedelta(seconds=180)
        db_session.add(instance)
        await db_session.commit()

        count = await svc.cleanup_stale_runtimes(max_age_seconds=45)

        # daemon 实体仍被标 offline（实体级 status 不受 runtime disabled 影响），
        # 但其下 disabled runtime 保留 disabled（不被 stale 覆盖成 offline）。
        assert count == 1
        await db_session.refresh(instance)
        assert instance.status == "offline"
        r = await db_session.get(DaemonRuntime, rt_id)
        assert r is not None
        assert r.status == "disabled"


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


@pytest.mark.asyncio
async def test_build_claim_payload_batch_null_agent_run_raises(
    db_session: AsyncSession,
) -> None:
    """ql-004: batch lease（非 interactive）agent_run_id NULL → DaemonLeaseNoAgentRun。

    静默返回 agent_run_id=None 的 payload 会让 daemon 发空 agent_run_id
    submitMessages → backend 422 风暴 → 连接池耗尽。fail-fast 抛错暴露。
    """
    from app.modules.daemon.service import DaemonLeaseNoAgentRun

    user_id = await _create_user(db_session)
    rt = await _create_runtime(db_session, user_id)
    lease = DaemonTaskLease(
        id=uuid.uuid4(),
        runtime_id=rt.id,
        agent_run_id=None,  # batch lease NULL — 异常（dispatch 必填）
        status="claimed",
        kind="batch",
        claimed_at=datetime.now(UTC),
        lease_expires_at=datetime.now(UTC) + timedelta(seconds=60),
        metadata_={"claim_token": "tok"},
    )
    db_session.add(lease)
    await db_session.commit()
    await db_session.refresh(lease)

    # task-06：_build_claim_payload 已从 DaemonService 迁出为
    # app.modules.daemon.lease.context.build_claim_payload 模块级函数。
    from app.modules.daemon.lease.context import build_claim_payload

    with pytest.raises(DaemonLeaseNoAgentRun):
        await build_claim_payload(db_session, lease)


# ── task-03（2026-06-22-agent-run-pipeline-fix）interactive claim payload 透传 specRoot ──


async def _create_interactive_lease(
    session: AsyncSession,
    runtime_id: uuid.UUID,
    *,
    metadata: dict,
) -> DaemonTaskLease:
    """构造 interactive lease 行（kind='interactive', agent_run_id=NULL）。"""
    now = datetime.now(UTC)
    lease = DaemonTaskLease(
        id=uuid.uuid4(),
        runtime_id=runtime_id,
        agent_run_id=None,  # D-005: interactive lease agent_run_id 列恒为 NULL
        status="claimed",
        kind="interactive",
        claimed_at=now,
        lease_expires_at=None,  # interactive lease 不过期
        metadata_=metadata,
        created_at=now,
        updated_at=now,
    )
    session.add(lease)
    await session.commit()
    await session.refresh(lease)
    return lease


class TestBuildClaimPayloadInteractiveSpecRoot:
    """task-03：interactive claim payload 透传 specRoot/runtimeRoot 给 daemon。

    覆盖 design.md §4.1 A1 第 3 层（backend 防御性透传）：
    - AC-01: lease_meta.spec_root 存在 → payload 双写 specRoot / spec_root
    - AC-02: lease_meta.spec_root 缺、workspace_id 存在 + SpecWorkspace.spec_root 存在 → 查 DB 回填
    - AC-03: lease_meta 既无 spec_root 也无 workspace_id → payload 不含 specRoot（向后兼容）
    - AC-04: batch lease payload 不含 specRoot（batch 分支未污染）
    """

    @pytest.mark.asyncio
    async def test_interactive_spec_root_from_meta(self, db_session: AsyncSession) -> None:
        """AC-01: lease_meta.spec_root 存在 → payload.specRoot = lease_meta.spec_root。"""
        from app.modules.daemon.lease.context import build_claim_payload

        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        lease = await _create_interactive_lease(
            db_session,
            rt.id,
            metadata={
                "session_id": str(uuid.uuid4()),
                "run_id": str(uuid.uuid4()),
                "prompt": "hello",
                "provider": "claude_code",
                "claim_token": "tok",
                "spec_root": "/data/spec-workspaces/abc-123",
                "runtime_root": "/data/spec-workspaces/abc-123/runtime",
            },
        )

        payload = await build_claim_payload(db_session, lease)

        # camelCase + snake_case 双写（对齐既有 rootPath/root_path 模式）
        assert payload["specRoot"] == "/data/spec-workspaces/abc-123"
        assert payload["spec_root"] == "/data/spec-workspaces/abc-123"
        assert payload["runtimeRoot"] == "/data/spec-workspaces/abc-123/runtime"
        assert payload["runtime_root"] == "/data/spec-workspaces/abc-123/runtime"

    @pytest.mark.asyncio
    async def test_interactive_spec_root_from_workspace_lookup(
        self, db_session: AsyncSession
    ) -> None:
        """AC-02: lease_meta 无 spec_root，含 workspace_id；SpecWorkspace.spec_root 回填。"""
        from app.modules.daemon.lease.context import build_claim_payload
        from app.modules.spec_workspace.model import SpecWorkspace
        from app.modules.workspace.model import Workspace

        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)

        # 建真实 Workspace + SpecWorkspace 行
        ws_id = uuid.uuid4()
        ws = Workspace(
            id=ws_id,
            name="test-ws",
            slug="test-ws",
            root_path="/repos/test",
            status="active",
        )
        db_session.add(ws)
        spec_ws = SpecWorkspace(
            id=uuid.uuid4(),
            workspace_id=ws_id,
            spec_root="/data/spec-workspaces/from-db-xyz",
            strategy="platform-managed",
        )
        db_session.add(spec_ws)
        await db_session.commit()

        lease = await _create_interactive_lease(
            db_session,
            rt.id,
            metadata={
                "session_id": str(uuid.uuid4()),
                "run_id": str(uuid.uuid4()),
                "prompt": "scan me",
                "provider": "claude_code",
                "claim_token": "tok",
                "workspace_id": str(ws_id),  # 字符串形式（对齐 placement.py:494）
                # 故意不写 spec_root，走 DB 回填路径
            },
        )

        payload = await build_claim_payload(db_session, lease)

        assert payload["specRoot"] == "/data/spec-workspaces/from-db-xyz"
        assert payload["spec_root"] == "/data/spec-workspaces/from-db-xyz"
        # lease_meta 没有 runtime_root → runtimeRoot 不应出现
        assert "runtimeRoot" not in payload
        assert "runtime_root" not in payload

    @pytest.mark.asyncio
    async def test_interactive_no_spec_root_no_workspace_id(self, db_session: AsyncSession) -> None:
        """AC-03: quick-chat 场景 lease_meta 无 spec_root 无 workspace_id → 不透传。

        向后兼容：旧 daemon 收到不含 specRoot 的 payload → 完全回退 prompt 翻译。
        """
        from app.modules.daemon.lease.context import build_claim_payload

        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        lease = await _create_interactive_lease(
            db_session,
            rt.id,
            metadata={
                "session_id": str(uuid.uuid4()),
                "run_id": str(uuid.uuid4()),
                "prompt": "quick chat",
                "provider": "claude_code",
                "claim_token": "tok",
                # 无 spec_root，无 workspace_id（quick-chat 路径）
            },
        )

        payload = await build_claim_payload(db_session, lease)

        # 向后兼容：字段不存在（不是 None），daemon execPayload.specRoot === undefined
        assert "specRoot" not in payload
        assert "spec_root" not in payload
        assert "runtimeRoot" not in payload
        assert "runtime_root" not in payload
        # 其它字段照常
        assert payload["kind"] == "interactive"
        assert payload["prompt"] == "quick chat"

    @pytest.mark.asyncio
    async def test_interactive_spec_root_missing_workspace_id_present_but_no_spec_ws(
        self, db_session: AsyncSession
    ) -> None:
        """AC-03 变体：lease_meta 有 workspace_id 但 SpecWorkspace 行不存在 → 不报错，不透传。

        边界 #3：SpecWorkspace 查不到 → spec_root 保持 None → payload 不含键。
        """
        from app.modules.daemon.lease.context import build_claim_payload

        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        # workspace_id 指向一个不存在的 workspace（无 SpecWorkspace 行）
        lease = await _create_interactive_lease(
            db_session,
            rt.id,
            metadata={
                "session_id": str(uuid.uuid4()),
                "run_id": str(uuid.uuid4()),
                "prompt": "x",
                "provider": "claude_code",
                "claim_token": "tok",
                "workspace_id": str(uuid.uuid4()),
            },
        )

        payload = await build_claim_payload(db_session, lease)

        assert "specRoot" not in payload
        assert "spec_root" not in payload

    @pytest.mark.asyncio
    async def test_batch_payload_has_no_spec_root(self, db_session: AsyncSession) -> None:
        """AC-04: batch lease payload 不含 specRoot（batch 分支未污染）。

        即使 lease_meta 写了 spec_root（dispatch_to_daemon 的 scan 字段），
        batch 分支也不透传——batch 不走 interactive prompt 翻译路径。
        """
        from app.modules.daemon.lease.context import build_claim_payload

        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)

        # 建 AgentRun 行（batch 分支要求 agent_run_id 非 NULL）
        agent_run_id = uuid.uuid4()
        ar = AgentRun(id=agent_run_id, agent_type="claude_code", status="pending")
        db_session.add(ar)
        await db_session.commit()

        now = datetime.now(UTC)
        lease = DaemonTaskLease(
            id=uuid.uuid4(),
            runtime_id=rt.id,
            agent_run_id=agent_run_id,
            status="claimed",
            kind="batch",
            claimed_at=now,
            lease_expires_at=now + timedelta(seconds=60),
            metadata_={
                "claim_token": "tok",
                # 故意写 spec_root，验证 batch 分支不会把它加进 payload
                "spec_root": "/data/spec-workspaces/should-not-leak",
                "runtime_root": "/data/spec-workspaces/should-not-leak/runtime",
            },
        )
        db_session.add(lease)
        await db_session.commit()
        await db_session.refresh(lease)

        payload = await build_claim_payload(db_session, lease)

        # batch 分支不透传 specRoot（task-03 实现要求 §4）
        assert "specRoot" not in payload
        assert "spec_root" not in payload
        assert "runtimeRoot" not in payload
        assert "runtime_root" not in payload
        assert payload["kind"] == "batch"


# ── 2026-06-25-interactive-idle-timeout-fix task-05（D-002@v1）──────────────────
# 完成驱动 end：complete_lease 收尾对 scan/stage run 主动调 facade.end_session。
# 覆盖 FR-3/4/5/6 + SC-1/5/6。DaemonService._lease._facade = self，故
# complete_lease 内 self._facade.end_session == DaemonService.end_session。


async def _create_run_with_session(
    db_session: AsyncSession,
    runtime_id: uuid.UUID,
    user_id: uuid.UUID,
    *,
    change_id: uuid.UUID | None,
    spec_strategy: str | None,
    agent_session_id: uuid.UUID | None,
) -> tuple[uuid.UUID, uuid.UUID, str]:
    """构造 lease + AgentSession + AgentRun，返回 (lease_id, run_id, claim_token)。

    scan run: change_id=None + spec_strategy='platform-managed'
    stage run: change_id 非空
    多轮对话: change_id=None + spec_strategy 非 'platform-managed'（如 'interactive'）
    """
    now = datetime.now(UTC)
    run_id = uuid.uuid4()
    sess_id = agent_session_id or uuid.uuid4()
    claim_token = "tok-" + uuid.uuid4().hex[:8]

    lease = DaemonTaskLease(
        id=uuid.uuid4(),
        runtime_id=runtime_id,
        agent_run_id=run_id,
        status="claimed",
        kind="interactive",
        claimed_at=now,
        lease_expires_at=None,
        metadata_={"claim_token": claim_token, "session_id": str(sess_id)},
        created_at=now,
        updated_at=now,
    )
    session = AgentSession(
        id=sess_id,
        user_id=user_id,
        provider="claude",
        status="active",
        config={},
        turn_count=1,
        runtime_id=runtime_id,
        lease_id=lease.id,
        last_active_at=now,
        created_at=now,
    )
    run = AgentRun(
        id=run_id,
        agent_type="claude_code",
        provider="claude",
        status="running",
        spec_strategy=spec_strategy,
        change_id=change_id,
        agent_session_id=sess_id,
    )
    db_session.add_all([lease, session, run])
    await db_session.commit()
    return lease.id, run_id, claim_token


class TestCompleteLeaseEndSession:
    """D-002@v1: complete_lease 完成驱动 end_session。"""

    @pytest.mark.asyncio
    async def test_scan_run_complete_ends_session(self, db_session: AsyncSession) -> None:
        """FR-3 / SC-1: scan run（change_id=None + platform-managed）完成 → end_session 被调。"""
        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        lease_id, _run_id, claim_token = await _create_run_with_session(
            db_session,
            rt.id,
            user_id,
            change_id=None,
            spec_strategy="platform-managed",
            agent_session_id=None,
        )

        svc = DaemonService(db_session)
        called: list[tuple] = []
        original_end = svc.end_session

        async def spy_end(session_id, uid, *, reason="manual", actor_runtime_owner_id=None):
            called.append((session_id, uid, reason, actor_runtime_owner_id))
            return await original_end(
                session_id, uid, reason=reason, actor_runtime_owner_id=actor_runtime_owner_id
            )

        svc.end_session = spy_end
        await svc.complete_lease(lease_id, claim_token, {"status": "completed"})

        assert len(called) == 1
        assert called[0][2] == "task_completed"
        # session 已被 end（状态 ended）
        sess = await db_session.get(AgentSession, called[0][0])
        assert sess is not None
        assert sess.status == "ended"

    @pytest.mark.asyncio
    async def test_stage_run_complete_ends_session(self, db_session: AsyncSession) -> None:
        """FR-4 / SC-5: stage run（change_id 非空）完成 → end_session 被调。

        SQLite 测试库不强制 FK，change_id 给随机 UUID 即可触发 stage 分支判定，
        无需建完整 Change 行（避免 Workspace root_path 等 NOT NULL 链）。
        """
        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        lease_id, _run_id, claim_token = await _create_run_with_session(
            db_session,
            rt.id,
            user_id,
            change_id=uuid.uuid4(),  # 非空 = stage run
            spec_strategy="platform-managed",
            agent_session_id=None,
        )

        svc = DaemonService(db_session)
        called: list[tuple] = []

        async def spy_end(session_id, uid, *, reason="manual", actor_runtime_owner_id=None):
            called.append((session_id, uid, reason))
            return None

        svc.end_session = spy_end
        await svc.complete_lease(lease_id, claim_token, {"status": "completed"})

        assert len(called) == 1
        assert called[0][2] == "task_completed"

    @pytest.mark.asyncio
    async def test_multiturn_chat_not_ended(self, db_session: AsyncSession) -> None:
        """FR-5: 多轮对话（非 platform-managed，change_id=None）完成 → 不调 end_session。"""
        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        lease_id, _run_id, claim_token = await _create_run_with_session(
            db_session,
            rt.id,
            user_id,
            change_id=None,
            spec_strategy="interactive",  # 非 platform-managed = 多轮对话
            agent_session_id=None,
        )

        svc = DaemonService(db_session)
        called: list[tuple] = []

        async def spy_end(*args, **kwargs):
            called.append((args, kwargs))
            return None

        svc.end_session = spy_end
        await svc.complete_lease(lease_id, claim_token, {"status": "completed"})

        assert called == []  # 多轮对话不自动 end

    @pytest.mark.asyncio
    async def test_end_session_failure_does_not_block_lease(self, db_session: AsyncSession) -> None:
        """FR-6 / SC-6: end_session 抛异常 → lease 仍 completed（容错）。"""
        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        lease_id, _run_id, claim_token = await _create_run_with_session(
            db_session,
            rt.id,
            user_id,
            change_id=None,
            spec_strategy="platform-managed",
            agent_session_id=None,
        )

        svc = DaemonService(db_session)

        async def boom_end(*args, **kwargs):
            raise RuntimeError("daemon unreachable")

        svc.end_session = boom_end
        result = await svc.complete_lease(lease_id, claim_token, {"status": "completed"})

        assert result.status == "completed"  # lease 完成不受影响

    @pytest.mark.asyncio
    async def test_no_agent_session_id_skips_end(self, db_session: AsyncSession) -> None:
        """FR-6 边界: agent_session_id 为空 → 跳过 end，lease 仍 completed。"""
        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        lease_id, run_id, claim_token = await _create_run_with_session(
            db_session,
            rt.id,
            user_id,
            change_id=None,
            spec_strategy="platform-managed",
            agent_session_id=None,  # helper 内部会生成一个——这里改成测 None 路径
        )
        # 显式把 agent_run.agent_session_id 清空，测跳过路径
        run = await db_session.get(AgentRun, run_id)
        assert run is not None
        run.agent_session_id = None
        db_session.add(run)
        await db_session.commit()

        svc = DaemonService(db_session)
        called: list = []

        async def spy_end(*args, **kwargs):
            called.append(1)
            return None

        svc.end_session = spy_end
        result = await svc.complete_lease(lease_id, claim_token, {"status": "completed"})

        assert called == []  # 无 agent_session_id → 跳过
        assert result.status == "completed"
