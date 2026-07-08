"""Tests for RunPlacementService interactive two-phase dispatch (task-05, D-005@v1).

Covers the D-005@v1 triple contract:
- interactive lease has agent_run_id=NULL
- kind='interactive'
- lease_expires_at=NULL (so expire_leases naturally skips it — AC-15)
- first turn run_id/prompt live in lease metadata only
- batch dispatch_to_daemon() signature/behaviour unchanged (FR-09, AC-14)

Uses the in-memory SQLite session fixture from backend/conftest.py.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.model import AgentRun
from app.modules.agent.placement import (
    NoOnlineDaemonError,
    RunPlacementService,
)
from app.modules.daemon.model import DaemonRuntime, DaemonTaskLease

# ── Helpers ──────────────────────────────────────────────────────────────────


async def _create_user(session: AsyncSession) -> uuid.UUID:
    from app.modules.auth.model import User

    uid = uuid.uuid4()
    session.add(
        User(
            id=uid,
            email=f"test-{uid}@example.com",
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


# ── prepare_interactive_dispatch ─────────────────────────────────────────────


class TestPrepareInteractiveDispatch:
    @pytest.mark.asyncio
    async def test_creates_interactive_lease_with_null_run_fk(
        self, db_session: AsyncSession
    ) -> None:
        """D-005@v1: lease.agent_run_id must be NULL even though we know the run id."""
        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)

        session_id = uuid.uuid4()
        run_id = uuid.uuid4()
        placement = RunPlacementService(db_session)
        dispatch = await placement.prepare_interactive_dispatch(
            agent_session_id=session_id,
            agent_run_id=run_id,
            user_id=uid,
            provider="claude",
            prompt="hi",
            model=None,
            manual_approval=False,
        )

        assert dispatch.run_id == run_id
        assert dispatch.runtime_id == rt.id

        lease = await db_session.get(DaemonTaskLease, dispatch.lease_id)
        assert lease is not None
        # D-005@v1 core contract
        assert lease.agent_run_id is None
        assert lease.kind == "interactive"
        assert lease.lease_expires_at is None
        assert lease.status == "pending"
        assert lease.runtime_id == rt.id

        # First-turn parameters live in metadata only
        meta = lease.metadata_ or {}
        assert meta["session_id"] == str(session_id)
        assert meta["run_id"] == str(run_id)
        assert meta["prompt"] == "hi"
        assert meta["provider"] == "claude"
        assert meta["manual_approval"] is True
        assert meta["ask_user_only"] is True

    @pytest.mark.asyncio
    async def test_model_field_stored_in_metadata(self, db_session: AsyncSession) -> None:
        uid = await _create_user(db_session)
        await _create_runtime(db_session, uid)
        placement = RunPlacementService(db_session)
        dispatch = await placement.prepare_interactive_dispatch(
            agent_session_id=uuid.uuid4(),
            agent_run_id=uuid.uuid4(),
            user_id=uid,
            provider="claude",
            prompt="hi",
            model="claude-sonnet-4",
            manual_approval=True,
        )
        lease = await db_session.get(DaemonTaskLease, dispatch.lease_id)
        meta = lease.metadata_ or {}
        assert meta["model"] == "claude-sonnet-4"
        assert meta["manual_approval"] is True

    @pytest.mark.asyncio
    async def test_no_online_runtime_raises(self, db_session: AsyncSession) -> None:
        """No online runtime → NoOnlineDaemonError (create_session must converge)."""
        uid = await _create_user(db_session)
        # no runtime created
        placement = RunPlacementService(db_session)
        with pytest.raises(NoOnlineDaemonError):
            await placement.prepare_interactive_dispatch(
                agent_session_id=uuid.uuid4(),
                agent_run_id=uuid.uuid4(),
                user_id=uid,
                provider="claude",
                prompt="hi",
                model=None,
            )

    @pytest.mark.asyncio
    async def test_does_not_commit_caller_controls_transaction(
        self, db_session: AsyncSession
    ) -> None:
        """prepare only flushes; if the caller rolls back the lease vanishes."""
        uid = await _create_user(db_session)
        await _create_runtime(db_session, uid)
        placement = RunPlacementService(db_session)
        dispatch = await placement.prepare_interactive_dispatch(
            agent_session_id=uuid.uuid4(),
            agent_run_id=uuid.uuid4(),
            user_id=uid,
            provider="claude",
            prompt="hi",
            model=None,
        )
        # lease is flushed and visible in this session
        lease = await db_session.get(DaemonTaskLease, dispatch.lease_id)
        assert lease is not None

        await db_session.rollback()
        # after rollback the lease is gone
        lease_after = await db_session.get(DaemonTaskLease, dispatch.lease_id)
        assert lease_after is None


# ── notify_interactive_dispatch ──────────────────────────────────────────────


class TestNotifyInteractiveDispatch:
    @pytest.mark.asyncio
    async def test_returns_true_when_connected(self, db_session: AsyncSession) -> None:
        uid = await _create_user(db_session)
        await _create_runtime(db_session, uid)
        placement = RunPlacementService(db_session)
        dispatch = await placement.prepare_interactive_dispatch(
            agent_session_id=uuid.uuid4(),
            agent_run_id=uuid.uuid4(),
            user_id=uid,
            provider="claude",
            prompt="hi",
            model=None,
        )
        from unittest.mock import MagicMock

        mock_hub = MagicMock()
        mock_hub.is_connected.return_value = True
        mock_hub.send_wakeup = AsyncMock()
        with patch("app.modules.daemon.ws_hub.get_daemon_ws_hub", return_value=mock_hub):
            ok = await placement.notify_interactive_dispatch(dispatch)
        assert ok is True
        mock_hub.send_wakeup.assert_awaited()

    @pytest.mark.asyncio
    async def test_returns_false_when_offline(self, db_session: AsyncSession) -> None:
        uid = await _create_user(db_session)
        await _create_runtime(db_session, uid)
        placement = RunPlacementService(db_session)
        dispatch = await placement.prepare_interactive_dispatch(
            agent_session_id=uuid.uuid4(),
            agent_run_id=uuid.uuid4(),
            user_id=uid,
            provider="claude",
            prompt="hi",
            model=None,
        )
        from unittest.mock import MagicMock

        mock_hub = MagicMock()
        mock_hub.is_connected.return_value = False
        mock_hub.connected_daemon_ids = []
        with patch("app.modules.daemon.ws_hub.get_daemon_ws_hub", return_value=mock_hub):
            ok = await placement.notify_interactive_dispatch(dispatch)
        assert ok is False


# ── dispatch_to_daemon lease 守护（bfaa9256 起 stage 改 interactive） ────────


class TestDispatchToDaemonBindsRun:
    """dispatch_to_daemon 创建的 interactive lease 必须绑定 agent_run_id（非 NULL）。

    bfaa9256 起 dispatch_to_daemon 的 lease kind 从 batch 改为 interactive（让
    daemon 走 SessionManager 实时转发）。它与 prepare_interactive_dispatch 的对话
    lease 同为 kind='interactive'，区别在 agent_run_id：dispatch_to_daemon 非 NULL
    （stage dispatch 绑定 run，close_interactive_run 据此定位 + stage 回写），
    prepare_interactive_dispatch 为 NULL（D-005@v1，首 turn run_id 仅存 metadata）。
    """

    @pytest.mark.asyncio
    async def test_dispatch_to_daemon_interactive_lease_binds_run(
        self, db_session: AsyncSession
    ) -> None:
        uid = await _create_user(db_session)
        await _create_runtime(db_session, uid)
        # dispatch_to_daemon 只写 lease 行引用 agent_run_id；FK 在 delete 时 SET NULL，
        # SQLite 默认不强制 FK，插入悬空 id 也可容忍。插入 run 保持真实。
        run = AgentRun(id=uuid.uuid4(), agent_type="claude_code", status="pending")
        db_session.add(run)
        await db_session.commit()

        from unittest.mock import MagicMock

        mock_hub = MagicMock()
        mock_hub.is_connected.return_value = True
        mock_hub.send_wakeup = AsyncMock()
        with patch("app.modules.daemon.ws_hub.get_daemon_ws_hub", return_value=mock_hub):
            placement = RunPlacementService(db_session)
            lease_id = await placement.dispatch_to_daemon(
                agent_run_id=run.id,
                user_id=uid,
                provider="claude",
                prompt="batch job",
            )
        assert lease_id is not None
        lease = await db_session.get(DaemonTaskLease, lease_id)
        # dispatch_to_daemon 产 interactive lease（bfaa9256 起），与 prepare 同 kind，
        # 但 agent_run_id 非 NULL —— 这是 stage lease 区别于对话 lease 的关键。
        assert lease.kind == "interactive"
        assert lease.agent_run_id == run.id  # stage dispatch 绑定 FK

    @pytest.mark.asyncio
    async def test_expire_leases_skips_interactive_lease(self, db_session: AsyncSession) -> None:
        """AC-15: an interactive lease with NULL lease_expires_at is never expired."""
        from app.modules.daemon.service import DaemonService

        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)
        # interactive lease: lease_expires_at NULL even though status=pending
        interactive = DaemonTaskLease(
            id=uuid.uuid4(),
            runtime_id=rt.id,
            agent_run_id=None,
            kind="interactive",
            status="pending",
            lease_expires_at=None,
            created_at=datetime.now(UTC),
            updated_at=datetime.now(UTC),
        )
        # batch lease already past expiry → must be expired
        expired_batch = DaemonTaskLease(
            id=uuid.uuid4(),
            runtime_id=rt.id,
            agent_run_id=None,
            kind="batch",
            status="pending",
            lease_expires_at=datetime.now(UTC) - timedelta(minutes=5),
            created_at=datetime.now(UTC),
            updated_at=datetime.now(UTC),
        )
        db_session.add_all([interactive, expired_batch])
        await db_session.commit()

        svc = DaemonService(db_session)
        expired = await svc.expire_leases()
        expired_ids = {str(e.id) for e in expired}

        assert str(expired_batch.id) in expired_ids
        # the interactive lease must NOT be in the expired set
        assert str(interactive.id) not in expired_ids

        # And it stays pending
        await db_session.refresh(interactive)
        assert interactive.status == "pending"
