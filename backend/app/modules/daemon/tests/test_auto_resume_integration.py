"""全链集成验证：daemon 重启自动续跑（2026-09-10-auto-resume-interrupted-turn）.

模拟真实序列（design §5 时序 + §8.5 生命周期契约表）：

1. recover → 中断 run 收敛 failed(daemon_restarted) + 续跑条目入队（队首）；
2. confirm → 翻 active；派发 → 新 run 落地（prompt 含包装头 + metadata_.
   auto_resume_of 指向源轮）；
3. 链上限：第二次中断仍自动（深度 1）→ 第三次中断不再入队（深度 2）；
4. G10：入队后、派发前用户手动重发 → 续跑条目删行跳过不派发；
5. 恢复失败：mark_session_recovery_failed → 续跑 pending 条目收敛 failed。

真实 DB 事务（非 mock 断言），integration-critical 证据（design 风险判级）。
fixture 范式照 test_session_recovery.py。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.model import AgentRun, AgentRunLog, AgentSession, AgentSessionQueuedMessage
from app.modules.daemon.model import DaemonRuntime, DaemonTaskLease
from app.modules.daemon.service import DaemonService


async def _create_user(session: AsyncSession) -> uuid.UUID:
    from app.modules.auth.model import User

    uid = uuid.uuid4()
    session.add(
        User(
            id=uid,
            email=f"ari-{uid}@example.com",
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


async def _seed_active_with_running_turn(
    db_session: AsyncSession, uid: uuid.UUID, rt: DaemonRuntime
) -> tuple[AgentSession, AgentRun, DaemonTaskLease]:
    now = datetime.now(UTC)
    lease = DaemonTaskLease(
        id=uuid.uuid4(),
        runtime_id=rt.id,
        status="claimed",
        kind="interactive",
        claimed_at=now,
        lease_expires_at=now,
        metadata_={"claim_token": "tok"},
    )
    db_session.add(lease)
    await db_session.flush()
    sess = AgentSession(
        id=uuid.uuid4(),
        user_id=uid,
        runtime_id=rt.id,
        lease_id=lease.id,
        provider="claude",
        status="active",
        agent_session_id="sdk-ari",
        config={"manual_approval": False},
        turn_count=1,
        created_at=now,
        last_active_at=now,
    )
    db_session.add(sess)
    await db_session.flush()
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
            content_redacted="把登录模块重构完",
            timestamp=now,
        )
    )
    await db_session.commit()
    return sess, run, lease


async def _queue_rows(db_session: AsyncSession, session_id: uuid.UUID) -> list:
    return list(
        (
            await db_session.execute(
                select(AgentSessionQueuedMessage)
                .where(AgentSessionQueuedMessage.agent_session_id == session_id)
                .order_by(AgentSessionQueuedMessage.position)
                .execution_options(populate_existing=True)
            )
        ).scalars()
    )


async def _runs(db_session: AsyncSession, session_id: uuid.UUID) -> list:
    return list(
        (
            await db_session.execute(
                select(AgentRun)
                .where(AgentRun.agent_session_id == session_id)
                .order_by(AgentRun.created_at, AgentRun.id)
                .execution_options(populate_existing=True)
            )
        ).scalars()
    )


async def _recover(
    db_session,
    rt_id: uuid.UUID,
    lease_id: uuid.UUID,
    sid: uuid.UUID,
    agent_sid: str,
    run_id: uuid.UUID,
):
    """纯 id 参数（种子期捕获）——服务层 commit 过期 ORM 实例后属性访问会触发
    懒加载 MissingGreenlet，本链路测试全部传值。"""
    svc = DaemonService(db_session)
    return await svc.recover_session_after_daemon_restart(
        sid,
        runtime_id=rt_id,
        lease_id=lease_id,
        provider="claude",
        agent_session_id=agent_sid,
        interrupted_run_id=run_id,
    )


@pytest.fixture()
def mocked_redis():
    redis = AsyncMock()
    redis.publish = AsyncMock()
    with patch("app.modules.daemon.session.service.get_redis", return_value=redis):
        yield redis


def _mock_hub(*, connected: bool = True) -> MagicMock:
    hub = MagicMock()
    hub.is_connected.return_value = connected
    hub.connected_runtime_ids = []
    hub.connected_daemon_ids = []
    hub.send_wakeup = AsyncMock(return_value=True)
    hub.send_session_control = AsyncMock(return_value=connected)
    return hub


@pytest.fixture()
def mocked_hub():
    hub = _mock_hub()
    with patch("app.modules.daemon.ws_hub.get_daemon_ws_hub", return_value=hub):
        yield hub


@pytest.fixture(autouse=True)
def _no_bg_dispatch():
    """禁用 confirm 的后台派发 fire（D-008 钩子行为已有 recovery 单测覆盖）——
    显式 dispatch_queued_messages 驱动，防后台任务与显式调用双消费同一队列
    条目（SQLite 无真行锁，竞态产生双活跃 run 触发不变式）。
    """
    from app.modules.daemon.session.service import SessionService

    with patch.object(
        SessionService, "_fire_background_task", staticmethod(lambda coro: coro.close())
    ):
        yield


@pytest.mark.asyncio
class TestAutoResumeFullChain:
    async def test_full_chain_recover_confirm_dispatch_chain_limit(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)
        svc = DaemonService(db_session)
        sess, run1, lease = await _seed_active_with_running_turn(db_session, uid, rt)
        # 种子期捕获全部 id（后续服务层 commit 会过期 ORM 实例）。
        sid, rt_id, lease_id, run1_id = sess.id, rt.id, lease.id, run1.id
        agent_sid = sess.agent_session_id

        # ① recover：收敛 + 入队（队首）。
        r1 = await _recover(db_session, rt_id, lease_id, sid, agent_sid, run1_id)
        assert r1.status == "reconnecting"
        assert r1.interrupted_run_status == "failed"
        rows = await _queue_rows(db_session, sid)
        assert len(rows) == 1
        assert rows[0].origin == f"auto_resume:{run1_id}"
        assert rows[0].prompt.startswith("[系统续跑提示]")
        assert "把登录模块重构完" in rows[0].prompt

        # ② confirm：翻 active（D-008 钩子在真实运行时 fire；测试直调派发同链路）。
        assert await svc.confirm_session_reconnected(sid, runtime_id=rt_id) == "active"
        await svc.dispatch_queued_messages(sid)
        assert await _queue_rows(db_session, sid) == []
        runs = await _runs(db_session, sid)
        run2 = next(r for r in runs if r.id != run1_id)
        assert run2.metadata_ == {"auto_resume_of": str(run1_id)}

        # ③ 第二次中断（run2 为续跑轮，链深度 1）→ 仍自动入队。
        db_session.add(
            AgentRunLog(
                run_id=run2.id,
                channel="user_input",
                content_redacted="[系统续跑提示] ……继续把登录模块重构完",
                timestamp=datetime.now(UTC),
            )
        )
        await db_session.commit()
        r2 = await _recover(db_session, rt_id, lease_id, sid, agent_sid, run2.id)
        assert r2.status == "reconnecting"
        assert len(await _queue_rows(db_session, sid)) == 1
        await svc.confirm_session_reconnected(sid, runtime_id=rt_id)
        await svc.dispatch_queued_messages(sid)
        run3 = next(r for r in await _runs(db_session, sid) if r.id not in (run1_id, run2.id))
        assert run3.metadata_ == {"auto_resume_of": str(run2.id)}

        # ④ 第三次中断（链深度 2）→ 不再自动入队（手动按钮兜底）。
        db_session.add(
            AgentRunLog(
                run_id=run3.id,
                channel="user_input",
                content_redacted="[系统续跑提示] ……再次续跑",
                timestamp=datetime.now(UTC),
            )
        )
        await db_session.commit()
        r3 = await _recover(db_session, rt_id, lease_id, sid, agent_sid, run3.id)
        assert r3.status == "reconnecting"
        assert await _queue_rows(db_session, sid) == []

    async def test_g10_integration_manual_resend_skips_entry(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        """入队后、派发前用户手动重发 → 派发时 G10 命中删行，不产生第 4 轮。"""
        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)
        svc = DaemonService(db_session)
        sess, run1, lease = await _seed_active_with_running_turn(db_session, uid, rt)
        # 种子期捕获全部 id（后续服务层 commit 会过期 ORM 实例）。
        sid, rt_id, lease_id, run1_id = sess.id, rt.id, lease.id, run1.id
        agent_sid = sess.agent_session_id

        await _recover(db_session, rt_id, lease_id, sid, agent_sid, run1_id)

        # 入队后、派发前：用户手动重发（直插已完结 run——会话仍 reconnecting，
        # 手动重发在真实时序里发生于 confirm 翻回 active 之后、后台派发之前，
        # 这里等效构造「source 之后存在更新 run」的终态）。
        from datetime import timedelta

        manual = AgentRun(
            id=uuid.uuid4(),
            agent_type="claude_code",
            provider="claude",
            status="completed",
            spec_strategy="interactive",
            agent_session_id=sess.id,
            created_at=datetime.now(UTC) + timedelta(seconds=5),
        )
        db_session.add(manual)
        await db_session.commit()

        await svc.confirm_session_reconnected(sid, runtime_id=rt_id)
        await svc.dispatch_queued_messages(sid)
        assert await _queue_rows(db_session, sid) == []
        runs = await _runs(db_session, sid)
        # run1（源）+ manual（手动）——续跑条目被 G10 删行，未派生成第 3 轮。
        assert len(runs) == 2
        assert runs[0].id == run1_id

    async def test_recovery_failure_converges_entry_failed(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        """恢复失败：mark_session_recovery_failed → 续跑 pending 条目收敛 failed。"""
        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)
        svc = DaemonService(db_session)
        sess, run1, lease = await _seed_active_with_running_turn(db_session, uid, rt)
        # 种子期捕获全部 id（后续服务层 commit 会过期 ORM 实例）。
        sid, rt_id, lease_id, run1_id = sess.id, rt.id, lease.id, run1.id
        agent_sid = sess.agent_session_id

        await _recover(db_session, rt_id, lease_id, sid, agent_sid, run1_id)
        assert len(await _queue_rows(db_session, sid)) == 1

        assert (
            await svc.mark_session_recovery_failed(sid, runtime_id=rt.id, reason="restore_failed")
            == "failed"
        )
        rows = await _queue_rows(db_session, sid)
        assert len(rows) == 1
        assert rows[0].status == "failed"
