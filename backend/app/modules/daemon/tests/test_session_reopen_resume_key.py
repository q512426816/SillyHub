"""ql-20260821-001: AgentSession.agent_session_id（SDK resume key）写入与自愈。

根因：SDK session id（claude session_id / codex thread id）经 daemon 消息流只
落到 run 级列 ``AgentRun.session_id``，session 级列 ``AgentSession.agent_session_id``
在生产链路从未被写入 → reopen（POST /sessions/{id}/reopen）必命中 409
``DaemonSessionNoAgentSession``。测试均直接写列的旧夹具掩盖了该缺口。

双修验证：
  1. submit_messages 收到消息携带 session_id 时回填 session 级列
     （NULL→id 首填 + fork 轮换 last-write-wins）；
  2. reopen 发现列 NULL 时从该会话历史 run 的最新非空 session_id 兜底恢复
     并持久化；无任何 run 记录过 id 才真正 409。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.model import AgentRun, AgentSession
from app.modules.auth.model import User
from app.modules.daemon.model import DaemonRuntime, DaemonTaskLease
from app.modules.daemon.service import DaemonService

# ── Helpers ──────────────────────────────────────────────────────────────────


async def _create_user(db_session: AsyncSession) -> User:
    uid = uuid.uuid4()
    user = User(
        id=uid,
        email=f"rk-{uid}@example.com",
        password_hash="x",
        display_name="T",
        status="active",
    )
    db_session.add(user)
    await db_session.commit()
    return user


async def _create_runtime(db_session: AsyncSession, user_id: uuid.UUID) -> DaemonRuntime:
    rt = DaemonRuntime(
        id=uuid.uuid4(),
        user_id=user_id,
        name="daemon",
        provider="claude",
        status="online",
        last_heartbeat_at=datetime.now(UTC),
    )
    db_session.add(rt)
    await db_session.commit()
    return rt


async def _make_ended_session(
    db_session: AsyncSession,
    user_id: uuid.UUID,
    runtime_id: uuid.UUID,
    *,
    agent_session_id: str | None = None,
) -> AgentSession:
    """ended 会话（lease_id=None 的简化形态——reopen 前置检查只读 status/provider/runtime）。"""
    now = datetime.now(UTC)
    sess = AgentSession(
        id=uuid.uuid4(),
        user_id=user_id,
        runtime_id=runtime_id,
        lease_id=None,
        provider="claude",
        status="ended",
        agent_session_id=agent_session_id,
        config={},
        turn_count=1,
        cwd="/w/p",
        created_at=now,
        last_active_at=now,
        ended_at=now,
    )
    db_session.add(sess)
    await db_session.commit()
    return sess


async def _make_run(
    db_session: AsyncSession,
    session_id: uuid.UUID,
    *,
    session_id_sdk: str | None,
    created_at: datetime | None = None,
    status: str = "completed",
) -> AgentRun:
    run = AgentRun(
        id=uuid.uuid4(),
        agent_type="claude_code",
        provider="claude",
        status=status,
        spec_strategy="interactive",
        agent_session_id=session_id,
        session_id=session_id_sdk,
        created_at=created_at or datetime.now(UTC),
    )
    db_session.add(run)
    await db_session.commit()
    return run


def _mock_hub() -> MagicMock:
    hub = MagicMock()
    hub.is_connected.return_value = True
    hub.send_session_control = AsyncMock(return_value=True)
    return hub


@pytest.fixture()
def mocked_hub():
    with patch("app.modules.daemon.ws_hub.get_daemon_ws_hub", return_value=_mock_hub()) as hub:
        yield hub


@pytest.fixture()
def mocked_redis():
    redis = AsyncMock()
    redis.publish = AsyncMock()
    with (
        patch("app.modules.daemon.session.service.get_redis", return_value=redis),
        patch("app.modules.daemon.run_sync.service.get_redis", return_value=redis),
    ):
        yield redis


# ── 1. submit_messages 回填 session 级列 ─────────────────────────────────────


class TestSubmitMessagesSyncsSessionSdkId:
    @pytest.mark.asyncio
    async def test_message_session_id_backfills_session_column(
        self, db_session: AsyncSession, mocked_redis
    ) -> None:
        """run 级 session_id 写入的同时，session 级列从 NULL 回填为同一值。"""
        user = await _create_user(db_session)
        rt = await _create_runtime(db_session, user.id)
        sess = await _make_ended_session(db_session, user.id, rt.id)
        # service 内部 commit/rollback 会 expire ORM 对象，之后同步读属性触发
        # 懒加载 IO（MissingGreenlet）——id 提前捕获为标量。
        sid = sess.id

        # 交互 run（pending）+ interactive lease（submit_messages 鉴权需要）。
        run = await _make_run(db_session, sid, session_id_sdk=None, status="pending")
        now = datetime.now(UTC)
        lease = DaemonTaskLease(
            runtime_id=rt.id,
            agent_run_id=None,
            kind="interactive",
            status="claimed",
            claimed_at=now,
            attempt_number=1,
            metadata_={
                "session_id": str(sid),
                "run_id": str(run.id),
                "provider": "claude",
                "claim_token": "tok-1",
            },
        )
        db_session.add(lease)
        await db_session.commit()

        svc = DaemonService(db_session)
        await svc.submit_messages(
            lease.id,
            "tok-1",
            run.id,
            [{"event_type": "assistant", "content": "hi", "session_id": "sdk-abc"}],
        )

        db_session.expire_all()
        row = (
            await db_session.execute(
                select(AgentSession.agent_session_id).where(AgentSession.id == sid)
            )
        ).scalar_one()
        assert row == "sdk-abc"

    @pytest.mark.asyncio
    async def test_forked_session_id_overwrites_last_write_wins(
        self, db_session: AsyncSession, mocked_redis
    ) -> None:
        """fork 轮换出新 id 时，后续消息覆盖旧值（对齐 daemon _onMessage 允许覆盖语义）。"""
        user = await _create_user(db_session)
        rt = await _create_runtime(db_session, user.id)
        sess = await _make_ended_session(db_session, user.id, rt.id, agent_session_id="sdk-old")
        sid = sess.id
        run = await _make_run(db_session, sid, session_id_sdk="sdk-old", status="pending")
        now = datetime.now(UTC)
        lease = DaemonTaskLease(
            runtime_id=rt.id,
            agent_run_id=None,
            kind="interactive",
            status="claimed",
            claimed_at=now,
            attempt_number=1,
            metadata_={
                "session_id": str(sid),
                "run_id": str(run.id),
                "provider": "claude",
                "claim_token": "tok-2",
            },
        )
        db_session.add(lease)
        await db_session.commit()

        svc = DaemonService(db_session)
        await svc.submit_messages(
            lease.id,
            "tok-2",
            run.id,
            [{"event_type": "assistant", "content": "hi", "session_id": "sdk-new"}],
        )

        db_session.expire_all()
        row = (
            await db_session.execute(
                select(AgentSession.agent_session_id).where(AgentSession.id == sid)
            )
        ).scalar_one()
        assert row == "sdk-new"


# ── 2. reopen 从历史 run 兜底恢复 ────────────────────────────────────────────


class TestReopenHealsResumeKeyFromRuns:
    @pytest.mark.asyncio
    async def test_reopen_heals_from_latest_run_session_id(
        self, db_session: AsyncSession, mocked_hub, mocked_redis
    ) -> None:
        """NULL 列 + runs 记录过 session id → reopen 成功且列被治愈为最新 run 的值。"""
        user = await _create_user(db_session)
        rt = await _create_runtime(db_session, user.id)
        sess = await _make_ended_session(db_session, user.id, rt.id)
        uid, sid = user.id, sess.id

        base = datetime.now(UTC) - timedelta(hours=2)
        await _make_run(db_session, sid, session_id_sdk="sdk-turn-1", created_at=base)
        await _make_run(
            db_session,
            sid,
            session_id_sdk="sdk-turn-2",
            created_at=base + timedelta(hours=1),
        )
        # 最新 run 无 id（如该轮失败未拿到）→ 恢复取次新的非空值。
        await _make_run(db_session, sid, session_id_sdk=None, created_at=base + timedelta(hours=2))

        svc = DaemonService(db_session)
        result = await svc.reopen_session(sid, uid)
        assert result.status == "reconnecting"

        db_session.expire_all()
        row = (
            await db_session.execute(
                select(AgentSession.agent_session_id).where(AgentSession.id == sid)
            )
        ).scalar_one()
        assert row == "sdk-turn-2"

        # 新 lease metadata 携带治愈后的 resume key（daemon SESSION_RESUME 消费）。
        lease_id_row = (
            await db_session.execute(select(AgentSession.lease_id).where(AgentSession.id == sid))
        ).scalar_one()
        assert lease_id_row is not None
        lease_meta = (
            await db_session.execute(
                select(DaemonTaskLease.metadata_).where(DaemonTaskLease.id == lease_id_row)
            )
        ).scalar_one()
        assert lease_meta["agent_session_id"] == "sdk-turn-2"

    @pytest.mark.asyncio
    async def test_reopen_without_any_run_session_id_still_409(
        self, db_session: AsyncSession, mocked_hub, mocked_redis
    ) -> None:
        """runs 全都没记录过 session id → 真 D-004，仍 409。"""
        from app.core.errors import AppError

        user = await _create_user(db_session)
        rt = await _create_runtime(db_session, user.id)
        sess = await _make_ended_session(db_session, user.id, rt.id)
        uid, sid = user.id, sess.id
        await _make_run(db_session, sid, session_id_sdk=None)

        svc = DaemonService(db_session)
        with pytest.raises(AppError) as exc_info:
            await svc.reopen_session(sid, uid)
        assert "NO_AGENT_SESSION" in exc_info.value.code

        # 会话行未被改动（D-004：不可恢复则不动）。
        db_session.expire_all()
        row = (
            await db_session.execute(
                select(AgentSession.status, AgentSession.agent_session_id).where(
                    AgentSession.id == sid
                )
            )
        ).one()
        assert row.status == "ended"
        assert row.agent_session_id is None
