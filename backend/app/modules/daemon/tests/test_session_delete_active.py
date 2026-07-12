"""2026-07-11-unify-runtime-session-dialog: delete_agent_session 改软删.

FR-05/06 / D-003。DELETE 一个 active/pending/reconnecting 会话：service 先
做 end 收口（best-effort SESSION_END WS + 当前非终态 run 标 killed/exit_code
=-1 + lease 置 completed），再 UPDATE deleted_at 软删（行保留、agent_runs
外键不断、run/log 历史可查；list/get 过滤 deleted_at IS NULL 隐藏）。ended/
failed 直接 UPDATE 软删。daemon 离线时 WS 只 warn，本地软删仍成功。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.model import AgentRun, AgentRunLog, AgentSession
from app.modules.daemon.model import DaemonRuntime, DaemonTaskLease
from app.modules.daemon.service import DaemonService

# ── Fixtures ─────────────────────────────────────────────────────────────────


async def _create_user(session: AsyncSession) -> uuid.UUID:
    from app.modules.auth.model import User

    uid = uuid.uuid4()
    session.add(
        User(
            id=uid,
            email=f"del-{uid}@example.com",
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
    with patch("app.modules.daemon.ws_hub.get_daemon_ws_hub", return_value=hub):
        yield hub


@pytest.fixture()
def mocked_redis():
    redis = _mock_redis()
    with patch("app.modules.daemon.session.service.get_redis", return_value=redis):
        yield redis


async def _make_interactive_session(
    db_session: AsyncSession,
    *,
    uid: uuid.UUID,
    runtime_id: uuid.UUID,
    status: str,
    lease_status: str = "pending",
    run_status: str | None = None,
) -> tuple[AgentSession, DaemonTaskLease, AgentRun]:
    """Build an owned session + interactive lease + a run in one shot."""
    now = datetime.now(UTC)
    lease = DaemonTaskLease(
        id=uuid.uuid4(),
        runtime_id=runtime_id,
        agent_run_id=None,
        kind="interactive",
        status=lease_status,
        created_at=now,
        updated_at=now,
    )
    session = AgentSession(
        id=uuid.uuid4(),
        user_id=uid,
        runtime_id=runtime_id,
        lease_id=lease.id,
        provider="claude",
        status=status,
        turn_count=1,
        created_at=now,
        last_active_at=now,
        ended_at=now if status in ("ended", "failed") else None,
    )
    run = AgentRun(
        id=uuid.uuid4(),
        agent_type="claude_code",
        provider="claude",
        status=run_status or ("running" if status == "active" else "completed"),
        spec_strategy="interactive",
        agent_session_id=session.id,
        started_at=now,
    )
    db_session.add_all([lease, session, run])
    await db_session.commit()
    await db_session.refresh(session)
    await db_session.refresh(lease)
    await db_session.refresh(run)
    return session, lease, run


# ── active session delete ────────────────────────────────────────────────────


class TestDeleteActiveSession:
    @pytest.mark.asyncio
    async def test_delete_active_ends_then_soft_deletes(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)
        session, lease, run = await _make_interactive_session(
            db_session,
            uid=uid,
            runtime_id=rt.id,
            status="active",
            lease_status="pending",
            run_status="running",
        )
        session_id, run_id, lease_id = session.id, run.id, lease.id
        # a log on the run — must be preserved (row soft-deleted, FK intact)
        log_row = AgentRunLog(
            id=uuid.uuid4(),
            run_id=run.id,
            timestamp=datetime.now(UTC),
            channel="stdout",
            content_redacted="agent output",
        )
        db_session.add(log_row)
        await db_session.commit()

        svc = DaemonService(db_session)
        await svc.delete_agent_session(session_id, uid)

        db_session.expire_all()
        deleted = await db_session.get(AgentSession, session_id)
        assert deleted is not None and deleted.deleted_at is not None

        # run kept, foreign key INTACT (soft-delete does not sever FK)
        kept_run = await db_session.get(AgentRun, run_id)
        assert kept_run is not None
        assert kept_run.agent_session_id == session_id
        # run was converged to killed before the soft delete (FK intact)
        assert kept_run.status == "killed"
        assert kept_run.finished_at is not None
        assert kept_run.exit_code == -1

        # lease converged to completed (row kept, same as end_session)
        kept_lease = await db_session.get(DaemonTaskLease, lease_id)
        assert kept_lease is not None
        assert kept_lease.status == "completed"

        # logs preserved
        logs = (
            (await db_session.execute(select(AgentRunLog).where(AgentRunLog.run_id == run_id)))
            .scalars()
            .all()
        )
        assert len(logs) == 1
        assert logs[0].content_redacted == "agent output"

    @pytest.mark.asyncio
    async def test_delete_active_sends_session_end_ws(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)
        session, _lease, _run = await _make_interactive_session(
            db_session, uid=uid, runtime_id=rt.id, status="active", run_status="running"
        )

        mocked_hub.send_session_control.reset_mock()
        svc = DaemonService(db_session)
        await svc.delete_agent_session(session.id, uid)

        assert mocked_hub.send_session_control.await_count == 1
        from app.modules.daemon.protocol import DAEMON_MSG_SESSION_END

        call = mocked_hub.send_session_control.await_args
        assert call.args[1] == DAEMON_MSG_SESSION_END
        assert call.args[2]["session_id"] == str(session.id)


# ── pending / reconnecting ──────────────────────────────────────────────────


class TestDeletePendingReconnecting:
    @pytest.mark.asyncio
    @pytest.mark.parametrize("status", ["pending", "reconnecting"])
    async def test_delete_pending_or_reconnecting_ends_then_deletes(
        self, db_session, mocked_hub, mocked_redis, status: str
    ) -> None:
        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)
        session, lease, run = await _make_interactive_session(
            db_session,
            uid=uid,
            runtime_id=rt.id,
            status=status,
            lease_status="pending",
            run_status="running",
        )
        session_id, run_id, lease_id = session.id, run.id, lease.id

        svc = DaemonService(db_session)
        await svc.delete_agent_session(session_id, uid)

        db_session.expire_all()
        deleted = await db_session.get(AgentSession, session_id)
        assert deleted is not None and deleted.deleted_at is not None
        kept_run = await db_session.get(AgentRun, run_id)
        assert kept_run is not None and kept_run.agent_session_id == session_id
        assert kept_run.status == "killed"
        kept_lease = await db_session.get(DaemonTaskLease, lease_id)
        assert kept_lease is not None and kept_lease.status == "completed"


# ── ended / failed (no end reconciliation) ───────────────────────────────────


class TestDeleteTerminalSession:
    @pytest.mark.asyncio
    @pytest.mark.parametrize("status", ["ended", "failed"])
    async def test_delete_terminal_skips_end_ws(
        self, db_session, mocked_hub, mocked_redis, status: str
    ) -> None:
        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)
        session, _lease, run = await _make_interactive_session(
            db_session,
            uid=uid,
            runtime_id=rt.id,
            status=status,
            lease_status="completed",
            run_status="completed",
        )
        session_id, run_id = session.id, run.id

        mocked_hub.send_session_control.reset_mock()
        svc = DaemonService(db_session)
        await svc.delete_agent_session(session_id, uid)

        db_session.expire_all()
        deleted = await db_session.get(AgentSession, session_id)
        assert deleted is not None and deleted.deleted_at is not None
        # no SESSION_END WS sent on the terminal path
        assert mocked_hub.send_session_control.await_count == 0
        kept_run = await db_session.get(AgentRun, run_id)
        assert kept_run is not None and kept_run.agent_session_id == session_id
        # run status untouched (already terminal)
        assert kept_run.status == "completed"


# ── ownership ────────────────────────────────────────────────────────────────


class TestDeleteOwnership:
    @pytest.mark.asyncio
    async def test_cross_user_delete_is_hidden(self, db_session, mocked_hub, mocked_redis) -> None:
        uid = await _create_user(db_session)
        other = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)
        session, _lease, _run = await _make_interactive_session(
            db_session, uid=uid, runtime_id=rt.id, status="active", run_status="running"
        )
        session_id = session.id

        svc = DaemonService(db_session)
        from app.modules.daemon.service import DaemonSessionNotFound

        with pytest.raises(DaemonSessionNotFound):
            await svc.delete_agent_session(session_id, other)

        # session still exists and NOT soft-deleted (delete aborted on ownership miss)
        db_session.expire_all()
        kept = await db_session.get(AgentSession, session_id)
        assert kept is not None and kept.deleted_at is None


# ── daemon offline best-effort ───────────────────────────────────────────────


class TestDeleteActiveDaemonOffline:
    @pytest.mark.asyncio
    async def test_offline_ws_still_deletes_locally(self, db_session, mocked_redis) -> None:
        """Boundary #1: daemon offline → WS send fails (warn only), local hard
        delete still succeeds. No exception bubbles up to the caller.
        """
        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)
        session, lease, run = await _make_interactive_session(
            db_session, uid=uid, runtime_id=rt.id, status="active", run_status="running"
        )
        session_id, run_id, lease_id = session.id, run.id, lease.id

        bad_hub = _mock_hub(connected=True)
        bad_hub.send_session_control = AsyncMock(return_value=False)
        with patch("app.modules.daemon.ws_hub.get_daemon_ws_hub", return_value=bad_hub):
            svc = DaemonService(db_session)
            # must NOT raise — WS failure is best-effort on the delete path
            await svc.delete_agent_session(session_id, uid)

        db_session.expire_all()
        deleted = await db_session.get(AgentSession, session_id)
        assert deleted is not None and deleted.deleted_at is not None
        kept_run = await db_session.get(AgentRun, run_id)
        assert kept_run is not None and kept_run.status == "killed"
        kept_lease = await db_session.get(DaemonTaskLease, lease_id)
        assert kept_lease is not None and kept_lease.status == "completed"


# ── soft-delete listing / read filtering (FR-07) ─────────────────────────────


class TestSoftDeleteListingFilter:
    """2026-07-11-unify-runtime-session-dialog / FR-07: 软删项从 list/get 隐藏。"""

    @pytest.mark.asyncio
    async def test_soft_deleted_hidden_from_list_and_get(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        from app.modules.daemon.service import DaemonSessionNotFound

        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)
        keep, _lk, _lr = await _make_interactive_session(
            db_session, uid=uid, runtime_id=rt.id, status="active", run_status="running"
        )
        victim, _vl, _vr = await _make_interactive_session(
            db_session, uid=uid, runtime_id=rt.id, status="ended", run_status="completed"
        )

        svc = DaemonService(db_session)
        await svc.delete_agent_session(victim.id, uid)

        items, total = await svc.list_agent_sessions(uid, limit=20, offset=0)
        ids = {s.id for s in items}
        assert victim.id not in ids  # 软删过滤
        assert keep.id in ids
        assert total == 1

        # get 对软删项 → 404（软删视为不存在）
        with pytest.raises(DaemonSessionNotFound):
            await svc.get_agent_session(victim.id, uid)
