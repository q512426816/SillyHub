"""Wave 5 integration tests — patch apply, status sync, lease expiry rollback.

Tests the complete daemon lifecycle: register → lease → claim → start →
heartbeat → messages → complete, plus the error/recovery paths for patch
conflicts, status sync, and lease expiry with automatic rollback.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import col

from app.modules.agent.model import AgentRun
from app.modules.daemon.model import DaemonRuntime, DaemonTaskLease
from app.modules.daemon.service import (
    DaemonInvalidClaimToken,
    DaemonLeaseNotClaimed,
    DaemonService,
    PatchApplyError,
)
from app.modules.workspace.model import AgentRunWorkspace, Workspace

# ── Helpers ──────────────────────────────────────────────────────────────────


async def _create_user(session: AsyncSession) -> uuid.UUID:
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


async def _create_agent_run(
    session: AsyncSession,
    *,
    status: str = "pending",
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


async def _create_workspace(
    session: AsyncSession,
    *,
    root_path: str = "/tmp/test-workspace",
) -> Workspace:
    ws = Workspace(
        id=uuid.uuid4(),
        name=f"test-ws-{uuid.uuid4().hex[:8]}",
        slug=f"test-ws-{uuid.uuid4().hex[:8]}",
        root_path=root_path,
        status="active",
    )
    session.add(ws)
    await session.commit()
    await session.refresh(ws)
    return ws


async def _link_run_to_workspace(
    session: AsyncSession,
    run_id: uuid.UUID,
    workspace_id: uuid.UUID,
) -> None:
    link = AgentRunWorkspace(agent_run_id=run_id, workspace_id=workspace_id)
    session.add(link)
    await session.commit()


# ── Test: Patch apply ────────────────────────────────────────────────────────


class TestPatchApply:
    """Tests for DaemonService._apply_patch_to_worktree."""

    @pytest.mark.asyncio
    async def test_patch_apply_no_workspace_raises(self, db_session: AsyncSession) -> None:
        """_apply_patch_to_worktree raises PatchApplyError if no workspace linked."""
        svc = DaemonService(db_session)
        agent_run = await _create_agent_run(db_session)

        with pytest.raises(PatchApplyError):
            await svc._apply_patch_to_worktree(
                agent_run_id=agent_run.id,
                patch_data="diff --git a/file.txt b/file.txt\n",
            )

    @pytest.mark.asyncio
    async def test_patch_apply_workspace_not_found_raises(self, db_session: AsyncSession) -> None:
        """_apply_patch_to_worktree raises PatchApplyError if workspace is missing."""
        svc = DaemonService(db_session)
        agent_run = await _create_agent_run(db_session)
        fake_ws_id = uuid.uuid4()
        await _link_run_to_workspace(db_session, agent_run.id, fake_ws_id)

        with pytest.raises(PatchApplyError):
            await svc._apply_patch_to_worktree(
                agent_run_id=agent_run.id,
                patch_data="diff --git a/file.txt b/file.txt\n",
            )


# ── Test: AgentRun status sync ──────────────────────────────────────────────


class TestAgentRunStatusSync:
    """Tests for DaemonService.sync_agent_run_status."""

    @pytest.mark.asyncio
    async def test_sync_status_to_running(self, db_session: AsyncSession) -> None:
        """sync_agent_run_status updates AgentRun to running."""
        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        agent_run = await _create_agent_run(db_session, status="pending")

        # Create and claim a lease
        svc = DaemonService(db_session)
        lease = DaemonTaskLease(
            id=uuid.uuid4(),
            runtime_id=rt.id,
            agent_run_id=agent_run.id,
            status="claimed",
            claimed_at=datetime.now(UTC),
            lease_expires_at=datetime.now(UTC) + timedelta(seconds=60),
            metadata_={"claim_token": "test-token-123"},
        )
        db_session.add(lease)
        await db_session.commit()
        await db_session.refresh(lease)

        result = await svc.sync_agent_run_status(lease.id, "test-token-123", "running")

        assert result is not None
        assert result.status == "running"
        assert result.started_at is not None

    @pytest.mark.asyncio
    async def test_sync_status_to_failed_with_error(self, db_session: AsyncSession) -> None:
        """sync_agent_run_status sets output_redacted on failure."""
        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        agent_run = await _create_agent_run(db_session, status="running")

        lease = DaemonTaskLease(
            id=uuid.uuid4(),
            runtime_id=rt.id,
            agent_run_id=agent_run.id,
            status="claimed",
            claimed_at=datetime.now(UTC),
            lease_expires_at=datetime.now(UTC) + timedelta(seconds=60),
            metadata_={"claim_token": "tok"},
        )
        db_session.add(lease)
        await db_session.commit()

        svc = DaemonService(db_session)
        result = await svc.sync_agent_run_status(lease.id, "tok", "failed", error="OOM killed")

        assert result is not None
        assert result.status == "failed"
        assert result.finished_at is not None
        assert result.output_redacted == "OOM killed"

    @pytest.mark.asyncio
    async def test_sync_status_no_agent_run_linked(self, db_session: AsyncSession) -> None:
        """sync_agent_run_status returns None if lease has no agent_run_id."""
        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)

        lease = DaemonTaskLease(
            id=uuid.uuid4(),
            runtime_id=rt.id,
            agent_run_id=None,
            status="claimed",
            claimed_at=datetime.now(UTC),
            lease_expires_at=datetime.now(UTC) + timedelta(seconds=60),
            metadata_={"claim_token": "tok"},
        )
        db_session.add(lease)
        await db_session.commit()

        svc = DaemonService(db_session)
        result = await svc.sync_agent_run_status(lease.id, "tok", "running")

        assert result is None

    @pytest.mark.asyncio
    async def test_sync_status_wrong_token_raises(self, db_session: AsyncSession) -> None:
        """sync_agent_run_status raises on wrong claim_token."""
        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)

        lease = DaemonTaskLease(
            id=uuid.uuid4(),
            runtime_id=rt.id,
            agent_run_id=uuid.uuid4(),
            status="claimed",
            claimed_at=datetime.now(UTC),
            lease_expires_at=datetime.now(UTC) + timedelta(seconds=60),
            metadata_={"claim_token": "real-token"},
        )
        db_session.add(lease)
        await db_session.commit()

        svc = DaemonService(db_session)
        with pytest.raises(DaemonInvalidClaimToken):
            await svc.sync_agent_run_status(lease.id, "bad-token", "running")


# ── Test: Submit messages with status sync ───────────────────────────────────


class TestSubmitMessagesSync:
    """Tests for DaemonService.submit_messages with AgentRun status sync."""

    @pytest.mark.asyncio
    async def test_submit_messages_activates_pending_run(self, db_session: AsyncSession) -> None:
        """submit_messages changes AgentRun from pending to running."""
        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        agent_run = await _create_agent_run(db_session, status="pending")

        lease = DaemonTaskLease(
            id=uuid.uuid4(),
            runtime_id=rt.id,
            agent_run_id=agent_run.id,
            status="claimed",
            claimed_at=datetime.now(UTC),
            lease_expires_at=datetime.now(UTC) + timedelta(seconds=60),
            metadata_={"claim_token": "msg-token"},
        )
        db_session.add(lease)
        await db_session.commit()

        svc = DaemonService(db_session)
        count = await svc.submit_messages(
            lease.id,
            "msg-token",
            agent_run.id,
            [{"channel": "stdout", "content": "Hello from daemon"}],
        )

        assert count == 1
        await db_session.refresh(agent_run)
        assert agent_run.status == "running"
        assert agent_run.started_at is not None

    @pytest.mark.asyncio
    async def test_submit_messages_does_not_downgrade_running(
        self, db_session: AsyncSession
    ) -> None:
        """submit_messages keeps AgentRun as running if already running."""
        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        agent_run = await _create_agent_run(db_session, status="running")
        old_started = agent_run.started_at

        lease = DaemonTaskLease(
            id=uuid.uuid4(),
            runtime_id=rt.id,
            agent_run_id=agent_run.id,
            status="claimed",
            claimed_at=datetime.now(UTC),
            lease_expires_at=datetime.now(UTC) + timedelta(seconds=60),
            metadata_={"claim_token": "msg-token"},
        )
        db_session.add(lease)
        await db_session.commit()

        svc = DaemonService(db_session)
        await svc.submit_messages(
            lease.id,
            "msg-token",
            agent_run.id,
            [{"channel": "stdout", "content": "More output"}],
        )

        await db_session.refresh(agent_run)
        assert agent_run.status == "running"
        assert agent_run.started_at == old_started

    @pytest.mark.asyncio
    async def test_submit_messages_extracts_usage_from_content_message(
        self, db_session: AsyncSession
    ) -> None:
        """ql-20260617-001：daemon 把 usage 透传到带 content 的首条 message（[ASSISTANT]
        text 行），backend 必须从这种 message 提取 usage 实时回写 AgentRun。
        旧实现仅处理 content="" 的 message，导致 token 永远停留在「等待用量」。
        """
        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        agent_run = await _create_agent_run(db_session, status="running")

        lease = DaemonTaskLease(
            id=uuid.uuid4(),
            runtime_id=rt.id,
            agent_run_id=agent_run.id,
            status="claimed",
            claimed_at=datetime.now(UTC),
            lease_expires_at=datetime.now(UTC) + timedelta(seconds=60),
            metadata_={"claim_token": "usage-tok"},
        )
        db_session.add(lease)
        await db_session.commit()

        svc = DaemonService(db_session)
        # 模拟 task-runner.ts _eventToMessages 真实输出：首条 [ASSISTANT] 带 content
        # 同时 usage 透传，第二条 tool_call JSON 也带 usage snapshot。
        await svc.submit_messages(
            lease.id,
            "usage-tok",
            agent_run.id,
            [
                {
                    "event_type": "text",
                    "channel": "stdout",
                    "content": "[ASSISTANT] Hello world",
                    "session_id": "sess-abc-123",
                    "usage": {"input_tokens": 1500, "output_tokens": 200},
                },
                {
                    "event_type": "tool_use",
                    "channel": "tool_call",
                    "content": '{"tool":"Bash","args":{}}',
                    "usage": {"input_tokens": 1800, "output_tokens": 350},
                },
            ],
        )

        await db_session.refresh(agent_run)
        # max(1500, 1800) = 1800；max(200, 350) = 350
        assert agent_run.input_tokens == 1800
        assert agent_run.output_tokens == 350
        assert agent_run.session_id == "sess-abc-123"

    @pytest.mark.asyncio
    async def test_submit_messages_usage_takes_max_across_batches(
        self, db_session: AsyncSession
    ) -> None:
        """多次 submit_messages（assistant 事件流）应单调递增，取最大值。"""
        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        agent_run = await _create_agent_run(db_session, status="running")

        lease = DaemonTaskLease(
            id=uuid.uuid4(),
            runtime_id=rt.id,
            agent_run_id=agent_run.id,
            status="claimed",
            claimed_at=datetime.now(UTC),
            lease_expires_at=datetime.now(UTC) + timedelta(seconds=120),
            metadata_={"claim_token": "max-tok"},
        )
        db_session.add(lease)
        await db_session.commit()

        svc = DaemonService(db_session)
        await svc.submit_messages(
            lease.id,
            "max-tok",
            agent_run.id,
            [
                {
                    "channel": "stdout",
                    "content": "[ASSISTANT] turn 1",
                    "usage": {"input_tokens": 1000, "output_tokens": 50},
                }
            ],
        )
        await svc.submit_messages(
            lease.id,
            "max-tok",
            agent_run.id,
            [
                {
                    "channel": "stdout",
                    "content": "[ASSISTANT] turn 2",
                    "usage": {"input_tokens": 2500, "output_tokens": 120},
                }
            ],
        )

        await db_session.refresh(agent_run)
        assert agent_run.input_tokens == 2500
        assert agent_run.output_tokens == 120


# ── Test: Lease expiry and rollback ─────────────────────────────────────────


class TestLeaseExpiryRollback:
    """Tests for DaemonService.handle_lease_expiry and handle_expired_leases_batch."""

    @pytest.mark.asyncio
    async def test_handle_lease_expiry_rollback_to_pending(self, db_session: AsyncSession) -> None:
        """handle_lease_expiry resets AgentRun to pending for re-execution."""
        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        agent_run = await _create_agent_run(db_session, status="running")

        # Create an expired lease
        past = datetime.now(UTC) - timedelta(seconds=120)
        lease = DaemonTaskLease(
            id=uuid.uuid4(),
            runtime_id=rt.id,
            agent_run_id=agent_run.id,
            status="expired",
            claimed_at=past,
            lease_expires_at=past,
            attempt_number=1,
            metadata_={},
        )
        db_session.add(lease)
        await db_session.commit()

        svc = DaemonService(db_session)
        await svc.handle_lease_expiry(agent_run.id)

        await db_session.refresh(agent_run)
        assert agent_run.status == "pending"
        assert agent_run.started_at is None
        assert agent_run.finished_at is None

        # Verify a new pending lease was created with attempt_number=2
        stmt = (
            select(DaemonTaskLease)
            .where(
                col(DaemonTaskLease.agent_run_id) == agent_run.id,
                col(DaemonTaskLease.status) == "pending",
            )
            .order_by(col(DaemonTaskLease.created_at).desc())
        )
        new_lease = (await db_session.execute(stmt)).scalars().first()
        assert new_lease is not None
        assert new_lease.attempt_number == 2

    @pytest.mark.asyncio
    async def test_handle_lease_expiry_max_retries_marks_failed(
        self, db_session: AsyncSession
    ) -> None:
        """handle_lease_expiry marks AgentRun as failed after 3 attempts."""
        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        agent_run = await _create_agent_run(db_session, status="running")

        past = datetime.now(UTC) - timedelta(seconds=120)
        lease = DaemonTaskLease(
            id=uuid.uuid4(),
            runtime_id=rt.id,
            agent_run_id=agent_run.id,
            status="expired",
            claimed_at=past,
            lease_expires_at=past,
            attempt_number=3,
            metadata_={},
        )
        db_session.add(lease)
        await db_session.commit()

        svc = DaemonService(db_session)
        await svc.handle_lease_expiry(agent_run.id)

        await db_session.refresh(agent_run)
        assert agent_run.status == "failed"
        assert agent_run.finished_at is not None
        assert agent_run.exit_code == -1
        assert "3 attempt" in (agent_run.output_redacted or "")

    @pytest.mark.asyncio
    async def test_handle_lease_expiry_skips_terminal_state(self, db_session: AsyncSession) -> None:
        """handle_lease_expiry skips AgentRun already in terminal state."""
        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        agent_run = await _create_agent_run(db_session, status="completed")

        past = datetime.now(UTC) - timedelta(seconds=120)
        lease = DaemonTaskLease(
            id=uuid.uuid4(),
            runtime_id=rt.id,
            agent_run_id=agent_run.id,
            status="expired",
            claimed_at=past,
            lease_expires_at=past,
            attempt_number=1,
            metadata_={},
        )
        db_session.add(lease)
        await db_session.commit()

        svc = DaemonService(db_session)
        await svc.handle_lease_expiry(agent_run.id)

        await db_session.refresh(agent_run)
        assert agent_run.status == "completed"

    @pytest.mark.asyncio
    async def test_handle_expired_leases_batch(self, db_session: AsyncSession) -> None:
        """handle_expired_leases_batch processes multiple expired leases."""
        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)

        run_a = await _create_agent_run(db_session, status="running")
        run_b = await _create_agent_run(db_session, status="running")

        past = datetime.now(UTC) - timedelta(seconds=120)
        for run in [run_a, run_b]:
            lease = DaemonTaskLease(
                id=uuid.uuid4(),
                runtime_id=rt.id,
                agent_run_id=run.id,
                status="claimed",
                claimed_at=past,
                lease_expires_at=past,
                attempt_number=1,
                metadata_={"claim_token": "tok"},
            )
            db_session.add(lease)
        await db_session.commit()

        svc = DaemonService(db_session)
        count = await svc.handle_expired_leases_batch()

        assert count == 2

        await db_session.refresh(run_a)
        await db_session.refresh(run_b)
        assert run_a.status == "pending"
        assert run_b.status == "pending"

    @pytest.mark.asyncio
    async def test_handle_lease_expiry_no_expired_lease_is_noop(
        self, db_session: AsyncSession
    ) -> None:
        """handle_lease_expiry is a no-op if no expired lease exists."""
        agent_run = await _create_agent_run(db_session, status="running")

        svc = DaemonService(db_session)
        await svc.handle_lease_expiry(agent_run.id)

        await db_session.refresh(agent_run)
        assert agent_run.status == "running"


# ── Test: Start lease with Redis event ──────────────────────────────────────


class TestStartLeaseRedis:
    """Tests for start_lease method with AgentRun status and Redis event."""

    @pytest.mark.asyncio
    async def test_start_lease_updates_agent_run(self, db_session: AsyncSession) -> None:
        """start_lease sets AgentRun to running with started_at."""
        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        agent_run = await _create_agent_run(db_session, status="pending")

        lease = DaemonTaskLease(
            id=uuid.uuid4(),
            runtime_id=rt.id,
            agent_run_id=agent_run.id,
            status="claimed",
            claimed_at=datetime.now(UTC),
            lease_expires_at=datetime.now(UTC) + timedelta(seconds=60),
            metadata_={"claim_token": "start-tok"},
        )
        db_session.add(lease)
        await db_session.commit()

        svc = DaemonService(db_session)
        result = await svc.start_lease(lease.id, "start-tok")

        assert result is not None
        await db_session.refresh(agent_run)
        assert agent_run.status == "running"
        assert agent_run.started_at is not None

    @pytest.mark.asyncio
    async def test_start_lease_wrong_status_raises(self, db_session: AsyncSession) -> None:
        """start_lease raises if lease is not claimed."""
        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)

        lease = DaemonTaskLease(
            id=uuid.uuid4(),
            runtime_id=rt.id,
            agent_run_id=None,
            status="pending",
            metadata_={"claim_token": "tok"},
        )
        db_session.add(lease)
        await db_session.commit()

        svc = DaemonService(db_session)
        with pytest.raises(DaemonLeaseNotClaimed):
            await svc.start_lease(lease.id, "tok")


# ── Test: Complete lease with result ────────────────────────────────────────


class TestCompleteLeaseWithResult:
    """Tests for complete_lease with AgentRun stats update."""

    @pytest.mark.asyncio
    async def test_complete_lease_updates_agent_run_stats(self, db_session: AsyncSession) -> None:
        """complete_lease writes usage stats to AgentRun."""
        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        agent_run = await _create_agent_run(db_session, status="running")

        lease = DaemonTaskLease(
            id=uuid.uuid4(),
            runtime_id=rt.id,
            agent_run_id=agent_run.id,
            status="claimed",
            claimed_at=datetime.now(UTC),
            lease_expires_at=datetime.now(UTC) + timedelta(seconds=60),
            metadata_={"claim_token": "comp-tok"},
        )
        db_session.add(lease)
        await db_session.commit()

        svc = DaemonService(db_session)
        result = await svc.complete_lease(
            lease.id,
            "comp-tok",
            {
                "status": "completed",
                "stats": {
                    "total_cost_usd": 0.05,
                    "duration_ms": 12000,
                    "input_tokens": 1000,
                    "output_tokens": 500,
                    "session_id": "sess-123",
                    "exit_code": 0,
                },
            },
        )

        assert result.status == "completed"
        await db_session.refresh(agent_run)
        assert agent_run.status == "completed"
        assert agent_run.total_cost_usd == 0.05
        assert agent_run.duration_ms == 12000
        assert agent_run.input_tokens == 1000
        assert agent_run.output_tokens == 500
        assert agent_run.session_id == "sess-123"
        assert agent_run.exit_code == 0

    @pytest.mark.asyncio
    async def test_complete_lease_does_not_overwrite_killed_with_cancelled(
        self, db_session: AsyncSession
    ) -> None:
        """ql-20260616-006：AgentRun 已 killed（syncStatus 写入）时，
        complete_lease 上报 cancelled 不应降级覆盖。"""
        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        agent_run = await _create_agent_run(db_session, status="killed")
        # 模拟 syncStatus 已写入 finished_at
        agent_run.finished_at = datetime.now(UTC)
        db_session.add(agent_run)
        await db_session.commit()

        lease = DaemonTaskLease(
            id=uuid.uuid4(),
            runtime_id=rt.id,
            agent_run_id=agent_run.id,
            status="claimed",
            claimed_at=datetime.now(UTC),
            lease_expires_at=datetime.now(UTC) + timedelta(seconds=60),
            metadata_={"claim_token": "kill-tok"},
        )
        db_session.add(lease)
        await db_session.commit()

        svc = DaemonService(db_session)
        # daemon cancel 后会 complete_lease with status='cancelled'
        result = await svc.complete_lease(
            lease.id,
            "kill-tok",
            {"status": "cancelled", "error": "task cancelled"},
        )

        assert result.status == "completed"  # lease 标 completed（自身生命周期结束）
        await db_session.refresh(agent_run)
        # AgentRun 不应被 cancelled 覆盖（killed 优先级更高）
        assert agent_run.status == "killed"
