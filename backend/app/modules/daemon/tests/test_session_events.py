"""session_events 发布辅助单测（task-01）+ SessionService 埋点断言（task-02）。

task-01：monkeypatch 模块级 ``get_redis``，断言频道名 / payload JSON 四字段；
``user_id=None`` 跳过发布；Redis 异常静默不向上传播。

task-02（2026-08-24-sessions-live-updates / design §3 生命周期契约表）：3 条
代表路径（create / end / delete）断言 SessionService 写入点发布列表信号——
monkeypatch ``app.modules.daemon.session.service.publish_sessions_changed``
捕获调用参数；夹具范式镜像 ``test_session_create_config.py`` /
``test_session_delete_active.py``（in-memory SQLite + hub/redis mock）。
"""

from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

import app.modules.daemon.session.service as svc_mod
import app.modules.daemon.session_events as session_events_mod
import app.modules.daemon.ws_hub as ws_hub_mod
from app.modules.agent.model import AgentRun, AgentSession
from app.modules.daemon.model import DaemonRuntime, DaemonTaskLease
from app.modules.daemon.session.service import SessionService
from app.modules.daemon.session_events import (
    SESSIONS_CHANGED_CHANNEL,
    publish_sessions_changed,
)


@pytest.fixture
def mock_redis(monkeypatch: pytest.MonkeyPatch) -> AsyncMock:
    """把 session_events 模块级 get_redis 替换为 AsyncMock 单例。"""
    redis = AsyncMock()
    monkeypatch.setattr(session_events_mod, "get_redis", lambda: redis)
    return redis


class TestPublishSessionsChanged:
    async def test_publishes_to_sessions_changed_channel(self, mock_redis: AsyncMock) -> None:
        """三类事件均发布到 agent_sessions:changed，payload 含四个字段。"""
        session_id = uuid.uuid4()
        user_id = uuid.uuid4()
        await publish_sessions_changed("created", session_id, user_id)

        mock_redis.publish.assert_awaited_once()
        args = mock_redis.publish.await_args.args
        assert args[0] == SESSIONS_CHANGED_CHANNEL == "agent_sessions:changed"

        payload = json.loads(args[1])
        assert payload["event"] == "created"
        assert payload["session_id"] == str(session_id)
        assert payload["user_id"] == str(user_id)
        # at 为可解析的 UTC ISO 时间戳
        assert datetime.fromisoformat(payload["at"]).tzinfo is not None

    @pytest.mark.parametrize("event", ["created", "status_changed", "deleted"])
    async def test_event_kinds_roundtrip(self, mock_redis: AsyncMock, event: str) -> None:
        """created / status_changed / deleted 三类事件均可正常发布。"""
        await publish_sessions_changed(event, uuid.uuid4(), uuid.uuid4())

        assert mock_redis.publish.await_count == 1
        payload = json.loads(mock_redis.publish.await_args.args[1])
        assert payload["event"] == event
        assert set(payload) == {"event", "session_id", "user_id", "at"}

    async def test_none_user_id_skips_publish(self, mock_redis: AsyncMock) -> None:
        """user_id 为 None 时跳过发布——无主数据不进列表视图。"""
        await publish_sessions_changed("deleted", uuid.uuid4(), None)

        mock_redis.publish.assert_not_awaited()

    async def test_redis_error_is_swallowed(self, mock_redis: AsyncMock) -> None:
        """Redis 抛异常时静默容错，不向上传播（对齐 _publish_session_event）。"""
        mock_redis.publish.side_effect = ConnectionError("redis down")

        # 不抛即通过
        await publish_sessions_changed("status_changed", uuid.uuid4(), uuid.uuid4())

        assert mock_redis.publish.await_count == 1

    async def test_get_redis_failure_is_swallowed(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """get_redis 本身抛异常（如配置缺失）同样静默容错。"""
        monkeypatch.setattr(
            session_events_mod,
            "get_redis",
            lambda: (_ for _ in ()).throw(RuntimeError("no redis client")),
        )

        await publish_sessions_changed("created", uuid.uuid4(), uuid.uuid4())


# ═════════════════════════════════════════════════════════════════════════════
# task-02：SessionService 埋点断言（design §3 生命周期契约表）
# ═════════════════════════════════════════════════════════════════════════════


@pytest.fixture()
def mocked_hub(monkeypatch: pytest.MonkeyPatch) -> MagicMock:
    """WS hub 打桩（范式镜像 test_session_delete_active.py::_mock_hub）。

    打在源头模块 ``ws_hub.get_daemon_ws_hub``——service/placement 全部是函数级
    lazy import，调用时才解析属性，源头替换即可全覆盖。
    """
    hub = MagicMock()
    hub.is_connected.return_value = True
    hub.connected_runtime_ids = []
    hub.connected_daemon_ids = []
    hub.send_wakeup = AsyncMock(return_value=True)
    hub.send_session_control = AsyncMock(return_value=True)
    monkeypatch.setattr(ws_hub_mod, "get_daemon_ws_hub", lambda: hub)
    return hub


@pytest.fixture()
def mocked_redis(monkeypatch: pytest.MonkeyPatch) -> AsyncMock:
    """SessionService._publish_session_event（per-session 频道）的 redis 打桩。

    列表信号本身（publish_sessions_changed）由 capture_publish 打桩，不经 redis。
    """
    redis = AsyncMock()
    redis.publish = AsyncMock()
    monkeypatch.setattr(svc_mod, "get_redis", lambda: redis)
    return redis


@pytest.fixture()
def capture_publish(monkeypatch: pytest.MonkeyPatch) -> AsyncMock:
    """把 SessionService 命名空间里的列表信号发布打桩，捕获调用参数。

    service.py 顶部 ``from ... import publish_sessions_changed`` 把名字绑进
    自身命名空间，patch ``svc_mod.publish_sessions_changed`` 即拦截全部埋点。
    """
    publish = AsyncMock()
    monkeypatch.setattr(svc_mod, "publish_sessions_changed", publish)
    return publish


async def _create_user(db_session: AsyncSession) -> uuid.UUID:
    from app.modules.auth.model import User

    uid = uuid.uuid4()
    db_session.add(
        User(
            id=uid,
            email=f"t02-{uid}@example.com",
            password_hash="x",
            display_name="T02",
            status="active",
        )
    )
    await db_session.commit()
    return uid


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


async def _make_interactive_session(
    db_session: AsyncSession,
    *,
    uid: uuid.UUID,
    runtime_id: uuid.UUID,
    status: str,
    lease_status: str = "pending",
    run_status: str | None = None,
) -> tuple[AgentSession, DaemonTaskLease, AgentRun]:
    """Build an owned session + interactive lease + a run in one shot.

    逐字镜像 test_session_delete_active.py 同名 helper（fixture 构造参考）。
    """
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
    return session, lease, run


class TestSessionServiceInstrumentation:
    """3 条代表路径的列表信号断言（create / end / delete）。"""

    async def test_create_session_publishes_created_and_status_changed(
        self, db_session, mocked_hub, mocked_redis, capture_publish: AsyncMock
    ) -> None:
        """create_session：commit 落库后发 created + status_changed（→active）。

        INSERT 与 status→active 同事务一体落库（design §3 备注「合并发
        status_changed 一次即可」），两信号均携带新会话 id + 属主 user_id。
        """
        uid = await _create_user(db_session)
        await _create_runtime(db_session, uid)

        svc = SessionService(db_session)
        result = await svc.create_session(uid, provider="claude", prompt="hi")

        calls = [(c.args[0], c.args[1], c.args[2]) for c in capture_publish.await_args_list]
        assert calls == [
            ("created", result.agent_session.id, uid),
            ("status_changed", result.agent_session.id, uid),
        ]

    async def test_end_session_publishes_status_changed(
        self, db_session, mocked_hub, mocked_redis, capture_publish: AsyncMock
    ) -> None:
        """end_session：status→ended 单事务收口 commit 后发 status_changed。"""
        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)
        session, _lease, _run = await _make_interactive_session(
            db_session, uid=uid, runtime_id=rt.id, status="active", run_status="running"
        )

        svc = SessionService(db_session)
        await svc.end_session(session.id, uid)

        capture_publish.assert_awaited_once_with("status_changed", session.id, uid)

    async def test_delete_agent_session_publishes_deleted(
        self, db_session, mocked_hub, mocked_redis, capture_publish: AsyncMock
    ) -> None:
        """delete_agent_session：软删（deleted_at）commit 后发 deleted。"""
        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)
        session, _lease, _run = await _make_interactive_session(
            db_session, uid=uid, runtime_id=rt.id, status="ended", run_status="completed"
        )

        svc = SessionService(db_session)
        await svc.delete_agent_session(session.id, uid)

        capture_publish.assert_awaited_once_with("deleted", session.id, uid)
