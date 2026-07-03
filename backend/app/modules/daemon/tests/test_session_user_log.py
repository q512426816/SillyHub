"""task-01: create_session / inject_session 落 AgentRunLog(channel="user_input").

FR-01 / design §4.1、§5、§13；decisions D-001@v1、D-005@v1。

回看一致性：首 turn 和后续 turn 各插一条 channel="user_input" 的
AgentRunLog，挂在对应 run 上，prompt 经 content_redacted 脱敏（与
submit_messages 一致的 ``prompt[:5000]`` 截断），user_input channel 显式写、
不经 _channel_from_event_type。get_agent_session_logs 的 SQL 不变，user_input
log 随 JOIN 天然按 run 分组、anchor_ts 排序返回。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.model import AgentRun, AgentRunLog
from app.modules.daemon.model import DaemonRuntime
from app.modules.daemon.service import (
    DaemonRuntimeOffline,
    DaemonService,
    DaemonSessionTurnConflict,
)

# ── Fixtures (mirror test_session_service.py) ────────────────────────────────


async def _create_user(session: AsyncSession) -> uuid.UUID:
    from app.modules.auth.model import User

    uid = uuid.uuid4()
    session.add(
        User(
            id=uid,
            email=f"usr-{uid}@example.com",
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


async def _user_logs_for_run(session: AsyncSession, run_id: uuid.UUID) -> list[AgentRunLog]:
    rows = (
        (
            await session.execute(
                select(AgentRunLog).where(
                    AgentRunLog.run_id == run_id, AgentRunLog.channel == "user_input"
                )
            )
        )
        .scalars()
        .all()
    )
    return list(rows)


# ── create_session ───────────────────────────────────────────────────────────


class TestCreateSessionUserLog:
    @pytest.mark.asyncio
    async def test_first_turn_writes_user_log(self, db_session, mocked_hub, mocked_redis) -> None:
        uid = await _create_user(db_session)
        await _create_runtime(db_session, uid)
        svc = DaemonService(db_session)

        result = await svc.create_session(uid, provider="claude", prompt="hello world")

        logs = await _user_logs_for_run(db_session, result.agent_run.id)
        assert len(logs) == 1
        log_row = logs[0]
        assert log_row.run_id == result.agent_run.id
        assert log_row.channel == "user_input"
        # content_redacted carries the (truncated) prompt — not plain "content"
        assert log_row.content_redacted == "hello world"
        assert log_row.timestamp is not None

    @pytest.mark.asyncio
    async def test_user_log_is_truncated_to_5000(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        uid = await _create_user(db_session)
        await _create_runtime(db_session, uid)
        svc = DaemonService(db_session)

        long_prompt = "x" * 6000
        result = await svc.create_session(uid, provider="claude", prompt=long_prompt)

        logs = await _user_logs_for_run(db_session, result.agent_run.id)
        assert len(logs) == 1
        assert logs[0].content_redacted == "x" * 5000

    @pytest.mark.asyncio
    async def test_offline_daemon_keeps_user_log_with_failed_run(
        self, db_session, mocked_redis
    ) -> None:
        """create_session commits the triple (incl. user log) before waking the
        daemon; wake-up failure converges run→failed but the user log is kept
        (boundary #3 / AC of task-01: user did send the prompt, history shows it
        next to the failed run).
        """
        uid = await _create_user(db_session)
        await _create_runtime(db_session, uid)

        offline_hub = _mock_hub(connected=False)
        offline_hub.is_connected.return_value = False
        offline_hub.connected_runtime_ids = []
        with patch("app.modules.daemon.ws_hub.get_daemon_ws_hub", return_value=offline_hub):
            svc = DaemonService(db_session)
            with pytest.raises(DaemonRuntimeOffline):
                await svc.create_session(uid, provider="claude", prompt="hello")

        user_logs = (
            (
                await db_session.execute(
                    select(AgentRunLog).where(AgentRunLog.channel == "user_input")
                )
            )
            .scalars()
            .all()
        )
        assert len(user_logs) == 1
        assert user_logs[0].content_redacted == "hello"
        # the run this user log hangs off is converged to failed
        failed_runs = (
            (await db_session.execute(select(AgentRun).where(AgentRun.status == "failed")))
            .scalars()
            .all()
        )
        assert len(failed_runs) == 1
        assert failed_runs[0].id == user_logs[0].run_id


# ── inject_session ───────────────────────────────────────────────────────────


class TestInjectSessionUserLog:
    @pytest.mark.asyncio
    async def test_inject_writes_user_log_for_new_run(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        uid = await _create_user(db_session)
        await _create_runtime(db_session, uid)
        svc = DaemonService(db_session)
        created = await svc.create_session(uid, provider="claude", prompt="first")
        # mark first run done so inject can proceed
        created.agent_run.status = "completed"
        created.agent_run.finished_at = datetime.now(UTC)
        await db_session.commit()

        result = await svc.inject_session(created.agent_session.id, uid, prompt="second turn")

        logs = await _user_logs_for_run(db_session, result.agent_run.id)
        assert len(logs) == 1
        assert logs[0].channel == "user_input"
        assert logs[0].content_redacted == "second turn"
        assert logs[0].run_id == result.agent_run.id

        # first run still has exactly one user log, new run has its own
        first_logs = await _user_logs_for_run(db_session, created.agent_run.id)
        assert len(first_logs) == 1

    @pytest.mark.asyncio
    async def test_inject_turn_conflict_writes_no_user_log(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        """Boundary #2: 409 path builds no run → no user log inserted."""
        uid = await _create_user(db_session)
        await _create_runtime(db_session, uid)
        svc = DaemonService(db_session)
        created = await svc.create_session(uid, provider="claude", prompt="first")
        # first run still pending → inject conflicts
        before = (
            (
                await db_session.execute(
                    select(AgentRunLog).where(AgentRunLog.channel == "user_input")
                )
            )
            .scalars()
            .all()
        )

        with pytest.raises(DaemonSessionTurnConflict):
            await svc.inject_session(created.agent_session.id, uid, prompt="blocked")

        after = (
            (
                await db_session.execute(
                    select(AgentRunLog).where(AgentRunLog.channel == "user_input")
                )
            )
            .scalars()
            .all()
        )
        # conflict path must not insert any user log (only create_session's first)
        assert len(after) == len(before)


# ── get_agent_session_logs returns user logs ─────────────────────────────────


class TestSessionLogsIncludeUserChannel:
    @pytest.mark.asyncio
    async def test_user_log_returned_grouped_by_run(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        uid = await _create_user(db_session)
        await _create_runtime(db_session, uid)
        svc = DaemonService(db_session)

        created = await svc.create_session(uid, provider="claude", prompt="user turn 1")
        # Add an agent output log on the same run (stdout), later timestamp.
        db_session.add(
            AgentRunLog(
                id=uuid.uuid4(),
                run_id=created.agent_run.id,
                timestamp=datetime.now(UTC),
                channel="stdout",
                content_redacted="agent reply",
            )
        )
        await db_session.commit()

        logs = await svc.get_agent_session_logs(created.agent_session.id, uid)
        channels = [entry.channel for entry in logs]
        contents = [entry.content_redacted for entry in logs]
        # user log present, and ordered before the stdout reply in the same run
        assert "user_input" in channels
        assert "user turn 1" in contents
        user_idx = channels.index("user_input")
        stdout_idx = channels.index("stdout")
        assert user_idx < stdout_idx
