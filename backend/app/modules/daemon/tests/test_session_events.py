"""session_events 发布辅助单测（task-01）。

monkeypatch 模块级 ``get_redis``，断言频道名 / payload JSON 四字段；
``user_id=None`` 跳过发布；Redis 异常静默不向上传播。
"""

from __future__ import annotations

import json
import uuid
from datetime import datetime
from unittest.mock import AsyncMock

import pytest

import app.modules.daemon.session_events as session_events_mod
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
