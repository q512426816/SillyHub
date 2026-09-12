"""全链集成验证：上游故障轮三分支自动恢复（2026-09-12-chat-turn-auto-recovery）.

六场景（design §12 验收 / task-07 goal，真实 DB 事务非 mock 断言）：
1. 瞬时+干净轮：close(failed, provider_error) → 排队 origin 条目 → 派发 →
   新 run metadata_.auto_resume_of 打标（原文重放）；
2. 瞬时+工具活动：nudge 文案入队（不重放原文）；
3. quota+reset_at：close → 定时条目（dispatch_at≈reset+120s）→ sweep 派发 →
   条目 dispatched + 新 run 打标；
4. G10：排期后 source run 被更新 run 超越 → sweep 置 cancelled(superseded)；
5. 开关关闭：全分支不动作（NFR-3）；
6. 静默中断（task-02 合成 error 形态 + 工具活动）→ nudge 自动续跑。

daemon 侧（task-01/02）不在 backend 集成面——以 daemon 回传形态的 error
payload 直灌 close_interactive_run 模拟（design task-07 implementation 口径）。
fixture 范式照 test_auto_resume_integration.py。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.model import (
    AgentRun,
    AgentRunLog,
    AgentSession,
    AgentSessionQueuedMessage,
    AgentSessionScheduledMessage,
)
from app.modules.agent.placement import RunPlacementService
from app.modules.daemon.model import DaemonRuntime
from app.modules.daemon.model_error import ModelErrorDTO, ModelErrorType
from app.modules.daemon.scheduled_send import scheduled_send_sweep_once
from app.modules.daemon.service import DaemonService

RESET_AT_ISO = (datetime.now(UTC) + timedelta(hours=2)).strftime("%Y-%m-%dT%H:%M:%S+08:00")


async def _create_user(db: AsyncSession) -> uuid.UUID:
    from app.modules.auth.model import User

    uid = uuid.uuid4()
    db.add(
        User(
            id=uid,
            email=f"acr-{uid}@example.com",
            password_hash="x",
            display_name="T",
            status="active",
        )
    )
    await db.commit()
    return uid


async def _seed(
    db: AsyncSession,
    uid: uuid.UUID,
    *,
    prompt: str = "把登录模块重构完",
    config: dict | None = None,
) -> tuple[uuid.UUID, uuid.UUID, str, uuid.UUID]:
    """active 主会话 + running run + user_input 日志。返回
    (session_id, run_id, claim_token, lease_id)。"""
    rt = DaemonRuntime(
        id=uuid.uuid4(),
        user_id=uid,
        name="daemon",
        provider="claude",
        status="online",
        last_heartbeat_at=datetime.now(UTC),
    )
    db.add(rt)
    await db.commit()
    placement = RunPlacementService(db)
    session_id = uuid.uuid4()
    run_id = uuid.uuid4()
    dispatch = await placement.prepare_interactive_dispatch(
        agent_session_id=session_id,
        agent_run_id=run_id,
        user_id=uid,
        provider="claude",
        prompt=prompt,
        model=None,
    )
    db.add_all(
        [
            AgentSession(
                id=session_id,
                user_id=uid,
                provider="claude",
                status="active",
                config=dict(config) if config is not None else {},
                turn_count=1,
                runtime_id=rt.id,
                lease_id=dispatch.lease_id,
                last_active_at=datetime.now(UTC),
                created_at=datetime.now(UTC),
            ),
            AgentRun(
                id=run_id,
                agent_type="claude_code",
                provider="claude",
                status="running",
                spec_strategy="interactive",
                agent_session_id=session_id,
                user_id=uid,
                started_at=datetime.now(UTC),
            ),
            AgentRunLog(
                run_id=run_id,
                channel="user_input",
                content_redacted=prompt,
                timestamp=datetime.now(UTC),
            ),
        ]
    )
    await db.commit()
    return session_id, run_id, dispatch.claim_token, dispatch.lease_id


async def _close_failed(
    db: AsyncSession,
    lease_id: uuid.UUID,
    run_id: uuid.UUID,
    token: str,
    error: ModelErrorDTO,
) -> None:
    with patch(
        "app.modules.daemon.session.service.dispatch_next_queued_message",
        new=AsyncMock(),
    ):
        svc = DaemonService(db)
        await svc.close_interactive_run(
            lease_id,
            run_id,
            token,
            status="error",
            is_error=True,
            error=error,
        )


def _stream_error() -> ModelErrorDTO:
    return ModelErrorDTO(
        type=ModelErrorType.PROVIDER_ERROR,
        code=None,
        message="运行失败",
        retryable=True,
        hint=None,
        raw="Stream ended without finish_reason",
    )


def _silent_truncation_error() -> ModelErrorDTO:
    return ModelErrorDTO(
        type=ModelErrorType.PROVIDER_ERROR,
        code=None,
        message="运行失败",
        retryable=True,
        hint=None,
        raw=(
            "[silent stream truncation] 上一轮输出流中断，未产生收尾回复"
            "（api_calls=8, final_text=y）"
        ),
    )


def _quota_error() -> ModelErrorDTO:
    return ModelErrorDTO(
        type=ModelErrorType.QUOTA_EXCEEDED,
        code="1308",
        message="额度或配额已耗尽",
        retryable=False,
        hint=None,
        raw="[1308][已达到 5 小时的使用上限。您的限额将重置。]",
        reset_at=RESET_AT_ISO,
    )


async def _queue_rows(db: AsyncSession, sid: uuid.UUID):
    return list(
        (
            await db.execute(
                select(AgentSessionQueuedMessage).where(
                    AgentSessionQueuedMessage.agent_session_id == sid
                )
            )
        ).scalars()
    )


async def _scheduled_rows(db: AsyncSession, sid: uuid.UUID):
    return list(
        (
            await db.execute(
                select(AgentSessionScheduledMessage).where(
                    AgentSessionScheduledMessage.agent_session_id == sid
                )
            )
        ).scalars()
    )


async def _runs(db: AsyncSession, sid: uuid.UUID):
    return list(
        (await db.execute(select(AgentRun).where(AgentRun.agent_session_id == sid))).scalars()
    )


@pytest.fixture()
def mocked_redis():
    redis = AsyncMock()
    redis.publish = AsyncMock()
    with (
        patch("app.modules.daemon.run_sync.service.get_redis", return_value=redis),
        patch("app.modules.daemon.session.service.get_redis", return_value=redis),
    ):
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


@pytest.mark.asyncio
class TestAutoRecoverFullChain:
    async def test_1_transient_clean_replay_dispatch_tagged(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        """瞬时+干净轮 → 原 prompt 重放 → 派发 → 新 run 打标（契约表：自动恢复
        入队/排队派发两事件）。"""
        uid = await _create_user(db_session)
        sid, run1, token, lease_id = await _seed(db_session, uid)
        await _close_failed(db_session, lease_id, run1, token, _stream_error())

        rows = await _queue_rows(db_session, sid)
        assert len(rows) == 1
        assert rows[0].origin == f"auto_resume:{run1}"
        assert rows[0].prompt == "把登录模块重构完"
        assert rows[0].status == "pending"

        svc = DaemonService(db_session)
        await svc.dispatch_queued_messages(sid)
        assert await _queue_rows(db_session, sid) == []
        run2 = next(r for r in await _runs(db_session, sid) if r.id != run1)
        assert run2.metadata_ == {"auto_resume_of": str(run1)}

    async def test_2_transient_tool_activity_nudge(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        """瞬时+工具活动（副作用已落地）→ nudge 文案入队（不重放原文）。"""
        uid = await _create_user(db_session)
        sid, run1, token, lease_id = await _seed(db_session, uid)
        db_session.add(
            AgentRunLog(
                run_id=run1,
                channel="tool_call",
                content_redacted='{"tool":"bash"}',
                timestamp=datetime.now(UTC),
            )
        )
        await db_session.commit()
        await _close_failed(db_session, lease_id, run1, token, _stream_error())

        rows = await _queue_rows(db_session, sid)
        assert len(rows) == 1
        assert rows[0].origin == f"auto_resume:{run1}"
        assert rows[0].prompt.startswith("[系统续跑]")
        assert "把登录模块重构完" not in rows[0].prompt

    async def test_3_quota_schedule_then_sweep_dispatch(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        """quota+reset_at → 定时条目（+120s）→ 到点 sweep 派发 → dispatched +
        新 run 打标（契约表：自动恢复排期/定时到点派发两事件）。"""
        uid = await _create_user(db_session)
        sid, run1, token, lease_id = await _seed(db_session, uid)
        await _close_failed(db_session, lease_id, run1, token, _quota_error())

        assert await _queue_rows(db_session, sid) == []
        scheduled = await _scheduled_rows(db_session, sid)
        assert len(scheduled) == 1
        assert scheduled[0].origin == f"auto_resume:{run1}"
        assert scheduled[0].prompt.startswith("[系统续跑]")
        assert scheduled[0].status == "pending"

        # 推到到期（dispatch_at = reset+120s；直接回拨为已到期走 sweep）。
        db_session.expire_all()
        entry = (await _scheduled_rows(db_session, sid))[0]
        entry.dispatch_at = datetime.now(UTC) - timedelta(seconds=1)
        await db_session.commit()

        processed = await scheduled_send_sweep_once(db_session)
        assert processed == 1
        db_session.expire_all()
        entry = (await _scheduled_rows(db_session, sid))[0]
        assert entry.status == "dispatched"
        assert entry.dispatched_at is not None
        run2 = next(r for r in await _runs(db_session, sid) if r.id != run1)
        assert run2.metadata_ == {"auto_resume_of": str(run1)}

    async def test_4_g10_superseded_cancelled(self, db_session, mocked_hub, mocked_redis) -> None:
        """排期后 source run 被更新 run 超越（用户已手动重发）→ sweep 置
        cancelled(superseded)，不派发（契约表：G10 超越守卫事件）。"""
        uid = await _create_user(db_session)
        sid, run1, token, lease_id = await _seed(db_session, uid)
        await _close_failed(db_session, lease_id, run1, token, _quota_error())

        # 用户手动重发（新 run，更新 created_at）。
        db_session.add(
            AgentRun(
                id=uuid.uuid4(),
                agent_type="claude_code",
                provider="claude",
                status="running",
                spec_strategy="interactive",
                agent_session_id=sid,
                user_id=uid,
                created_at=datetime.now(UTC) + timedelta(seconds=5),
            )
        )
        await db_session.commit()
        db_session.expire_all()
        entry = (await _scheduled_rows(db_session, sid))[0]
        entry.dispatch_at = datetime.now(UTC) - timedelta(seconds=1)
        await db_session.commit()

        processed = await scheduled_send_sweep_once(db_session)
        assert processed == 1
        db_session.expire_all()
        entry = (await _scheduled_rows(db_session, sid))[0]
        assert entry.status == "cancelled"
        assert entry.error_code == "superseded"

    async def test_5_switch_off_full_manual(self, db_session, mocked_hub, mocked_redis) -> None:
        """开关关闭 → 三类全不动作（NFR-3：完全回到手动模式）。"""
        uid = await _create_user(db_session)
        sid, run1, token, lease_id = await _seed(
            db_session, uid, config={"auto_resume_interrupted": False}
        )
        await _close_failed(db_session, lease_id, run1, token, _stream_error())
        assert await _queue_rows(db_session, sid) == []
        assert await _scheduled_rows(db_session, sid) == []
        await _close_failed(db_session, lease_id, run1, token, _quota_error())
        assert await _queue_rows(db_session, sid) == []
        assert await _scheduled_rows(db_session, sid) == []

    async def test_6_silent_truncation_recovers(self, db_session, mocked_hub, mocked_redis) -> None:
        """静默中断（task-02 合成 error 形态）+ 工具活动 → nudge 自动续跑。"""
        uid = await _create_user(db_session)
        sid, run1, token, lease_id = await _seed(db_session, uid)
        db_session.add(
            AgentRunLog(
                run_id=run1,
                channel="tool_call",
                content_redacted='{"tool":"edit"}',
                timestamp=datetime.now(UTC),
            )
        )
        await db_session.commit()
        await _close_failed(db_session, lease_id, run1, token, _silent_truncation_error())

        rows = await _queue_rows(db_session, sid)
        assert len(rows) == 1
        assert rows[0].origin == f"auto_resume:{run1}"
        assert rows[0].prompt.startswith("[系统续跑]")
