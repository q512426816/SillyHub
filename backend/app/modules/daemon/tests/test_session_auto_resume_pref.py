"""2026-09-10-auto-resume-interrupted-turn / FR-06 / D-010@v2：会话级自动续跑开关。

覆盖：
1. service.update_auto_resume_pref：关闭/恢复/幂等（缺省=开归一）/属主校验
   （404 语义）；
2. config merge 保留既有键（manual_approval 等不丢）；
3. 路由 PATCH /sessions/{id}/auto-resume：owner 204 + 非 owner 404（资源隐藏）。

fixture 范式照 test_session_ctx_window.py（db_session + DaemonService 直调）。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.model import AgentSession
from app.modules.daemon.model import DaemonRuntime
from app.modules.daemon.service import DaemonService
from app.modules.daemon.session.service import DaemonSessionNotFound


async def _create_user(session: AsyncSession) -> uuid.UUID:
    from app.modules.auth.model import User

    uid = uuid.uuid4()
    session.add(
        User(
            id=uid,
            email=f"autores-{uid}@example.com",
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
    db_session: AsyncSession, user_id: uuid.UUID, rt: DaemonRuntime, config: dict | None
) -> AgentSession:
    sess = AgentSession(
        id=uuid.uuid4(),
        user_id=user_id,
        runtime_id=rt.id,
        provider="claude",
        status="active",
        agent_session_id="sdk-1",
        config=config,
        turn_count=1,
        created_at=datetime.now(UTC),
        last_active_at=datetime.now(UTC),
    )
    db_session.add(sess)
    await db_session.commit()
    await db_session.refresh(sess)
    return sess


@pytest.fixture()
def mocked_redis():
    from unittest.mock import AsyncMock, patch

    redis = AsyncMock()
    redis.publish = AsyncMock()
    with patch("app.modules.daemon.session.service.get_redis", return_value=redis):
        yield redis


class TestUpdateAutoResumePref:
    @pytest.mark.asyncio
    async def test_disable_writes_false_and_keeps_other_keys(
        self, db_session, mocked_redis
    ) -> None:
        """关闭：写 False 且 manual_approval 等既有键保留（merge 非整包覆写）。"""
        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)
        sess = await _make_session(db_session, uid, rt, {"manual_approval": True, "model": "glm-5"})

        await DaemonService(db_session).update_auto_resume_pref(sess.id, uid, enabled=False)

        await db_session.refresh(sess)
        assert (sess.config or {})["auto_resume_interrupted"] is False
        assert (sess.config or {})["manual_approval"] is True
        assert (sess.config or {})["model"] == "glm-5"

    @pytest.mark.asyncio
    async def test_reenable_writes_true_and_idempotent(self, db_session, mocked_redis) -> None:
        """恢复：写 True；重复设置幂等（值稳定）；缺省开 + enabled=True 幂等不写。"""
        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)
        sess = await _make_session(db_session, uid, rt, None)

        svc = DaemonService(db_session)
        # 缺省=开：enabled=True 是幂等早退（config 仍无键，语义等价开）。
        await svc.update_auto_resume_pref(sess.id, uid, enabled=True)
        await db_session.refresh(sess)
        assert "auto_resume_interrupted" not in (sess.config or {})

        await svc.update_auto_resume_pref(sess.id, uid, enabled=False)
        await svc.update_auto_resume_pref(sess.id, uid, enabled=False)  # 幂等
        await db_session.refresh(sess)
        assert (sess.config or {})["auto_resume_interrupted"] is False

        await svc.update_auto_resume_pref(sess.id, uid, enabled=True)
        await db_session.refresh(sess)
        assert (sess.config or {})["auto_resume_interrupted"] is True

    @pytest.mark.asyncio
    async def test_non_owner_404(self, db_session, mocked_redis) -> None:
        """非属主 → 404 资源隐藏（照 ctx-window 口径）。"""
        uid = await _create_user(db_session)
        other = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)
        sess = await _make_session(db_session, uid, rt, None)

        with pytest.raises(DaemonSessionNotFound):
            await DaemonService(db_session).update_auto_resume_pref(sess.id, other, False)

    @pytest.mark.asyncio
    async def test_recover_g2_respects_disabled_flag(self, db_session, mocked_redis) -> None:
        """开关联动：关闭后 recover 不再自动入队（G2 消费本开关）。"""
        from sqlalchemy import select

        from app.modules.agent.model import AgentRun, AgentRunLog, AgentSessionQueuedMessage

        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)
        sess = await _make_session(db_session, uid, rt, {"auto_resume_interrupted": False})
        run = AgentRun(
            id=uuid.uuid4(),
            agent_type="claude_code",
            provider="claude",
            status="running",
            spec_strategy="interactive",
            agent_session_id=sess.id,
        )
        db_session.add(run)
        db_session.add(
            AgentRunLog(
                run_id=run.id,
                channel="user_input",
                content_redacted="任务",
                timestamp=datetime.now(UTC),
            )
        )
        await db_session.commit()

        from app.modules.daemon.model import DaemonTaskLease

        now = datetime.now(UTC)
        lease_row = DaemonTaskLease(
            id=uuid.uuid4(),
            runtime_id=rt.id,
            status="claimed",
            kind="interactive",
            claimed_at=now,
            lease_expires_at=now,
            metadata_={"claim_token": "tok"},
        )
        db_session.add(lease_row)
        sess.lease_id = lease_row.id
        await db_session.commit()

        await DaemonService(db_session).recover_session_after_daemon_restart(
            sess.id,
            runtime_id=rt.id,
            lease_id=lease_row.id,
            provider="claude",
            agent_session_id="sdk-1",
            interrupted_run_id=run.id,
        )
        rows = list(
            (
                await db_session.execute(
                    select(AgentSessionQueuedMessage).where(
                        AgentSessionQueuedMessage.agent_session_id == sess.id
                    )
                )
            )
            .scalars()
            .all()
        )
        assert rows == []
