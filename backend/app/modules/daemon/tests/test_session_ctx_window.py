"""ql-20260831-002：会话级上下文窗口覆盖（ctx_window_tokens）测试。

覆盖：
1. service.update_ctx_window：设置/清除/幂等/属主校验（404 语义）；
   纯展示配置——不发 agent_sessions:changed 列表信号（列表视图不消费该列）；
2. SessionCtxWindowUpdateRequest 边界（1_000 ~ 100_000_000，None=清除）；
3. AgentSessionRead 序列化携带 ctx_window_tokens（from_attributes 直映）。

fixture 范式参照 test_session_review_fixes.py（db_session + DaemonService 直调）。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest
from pydantic import ValidationError
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.model import AgentSession
from app.modules.daemon.model import DaemonRuntime
from app.modules.daemon.schema import (
    AgentSessionRead,
    SessionCtxWindowUpdateRequest,
)
from app.modules.daemon.service import DaemonService
from app.modules.daemon.session.service import DaemonSessionNotFound


async def _create_user(session: AsyncSession) -> uuid.UUID:
    from app.modules.auth.model import User

    uid = uuid.uuid4()
    session.add(
        User(
            id=uid,
            email=f"ctxwin-{uid}@example.com",
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
    return rt


async def _make_session(
    db_session: AsyncSession, *, uid: uuid.UUID, runtime_id: uuid.UUID
) -> AgentSession:
    now = datetime.now(UTC)
    session = AgentSession(
        id=uuid.uuid4(),
        user_id=uid,
        runtime_id=runtime_id,
        provider="claude",
        status="active",
        turn_count=0,
        created_at=now,
        last_active_at=now,
    )
    db_session.add(session)
    await db_session.commit()
    await db_session.refresh(session)
    return session


class TestUpdateCtxWindow:
    async def test_set_and_clear_override(self, db_session: AsyncSession) -> None:
        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)
        session = await _make_session(db_session, uid=uid, runtime_id=rt.id)

        await DaemonService(db_session).update_ctx_window(session.id, uid, 256_000)
        fresh = await db_session.get(AgentSession, session.id)
        assert fresh is not None and fresh.ctx_window_tokens == 256_000

        # 清除覆盖 → 回 NULL（前端走自动派生链）
        await DaemonService(db_session).update_ctx_window(session.id, uid, None)
        fresh = await db_session.get(AgentSession, session.id)
        assert fresh is not None and fresh.ctx_window_tokens is None

    async def test_idempotent_same_value(self, db_session: AsyncSession) -> None:
        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)
        session = await _make_session(db_session, uid=uid, runtime_id=rt.id)
        sid = session.id  # rollback 会过期实例，先快照主键
        await DaemonService(db_session).update_ctx_window(sid, uid, 1_000_000)
        # 同值重复写无副作用不抛错（rollback 过期实例，用列查询断言避开实例刷新）
        await DaemonService(db_session).update_ctx_window(sid, uid, 1_000_000)
        from sqlalchemy import select

        value = (
            await db_session.execute(
                select(AgentSession.ctx_window_tokens).where(AgentSession.id == sid)
            )
        ).scalar_one()
        assert value == 1_000_000

    async def test_not_found_for_missing_or_foreign_session(self, db_session: AsyncSession) -> None:
        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)
        other = await _create_user(db_session)
        session = await _make_session(db_session, uid=uid, runtime_id=rt.id)

        # 不存在的会话 → 404 语义（DaemonSessionNotFound）
        with pytest.raises(DaemonSessionNotFound):
            await DaemonService(db_session).update_ctx_window(uuid.uuid4(), uid, 1_000_000)
        # 他人会话 → 同样 404 语义（不泄露存在性）
        with pytest.raises(DaemonSessionNotFound):
            await DaemonService(db_session).update_ctx_window(session.id, other, 1_000_000)

    async def test_display_only_no_list_signal(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """纯展示配置：不发 agent_sessions:changed 列表变更信号。"""
        calls: list[tuple] = []

        async def _fake_publish(event, session_id, user_id):
            calls.append((event, session_id, user_id))

        monkeypatch.setattr(
            "app.modules.daemon.session.service.publish_sessions_changed",
            _fake_publish,
        )
        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)
        session = await _make_session(db_session, uid=uid, runtime_id=rt.id)

        await DaemonService(db_session).update_ctx_window(session.id, uid, 512_000)
        assert calls == []


class TestCtxWindowRequestDto:
    def test_bounds(self) -> None:
        assert SessionCtxWindowUpdateRequest(ctx_window_tokens=1_000).ctx_window_tokens == 1_000
        assert (
            SessionCtxWindowUpdateRequest(ctx_window_tokens=100_000_000).ctx_window_tokens
            == 100_000_000
        )
        assert SessionCtxWindowUpdateRequest().ctx_window_tokens is None

    @pytest.mark.parametrize("bad", [999, 0, -1, 100_000_001])
    def test_out_of_bounds_rejected(self, bad: int) -> None:
        with pytest.raises(ValidationError):
            SessionCtxWindowUpdateRequest(ctx_window_tokens=bad)


class TestAgentSessionReadField:
    async def test_read_serializes_ctx_window_tokens(self, db_session: AsyncSession) -> None:
        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)
        session = await _make_session(db_session, uid=uid, runtime_id=rt.id)
        await DaemonService(db_session).update_ctx_window(session.id, uid, 300_000)

        fresh = await db_session.get(AgentSession, session.id)
        assert fresh is not None
        read = AgentSessionRead.model_validate(fresh)
        assert read.ctx_window_tokens == 300_000
