"""task-11 轻重构④定向测试：同构 Redis publish helper 共享核心。

覆盖两个层面：

- 核心 ``publish_json_event`` 单元路径：正常发布（精确序列化断言）、
  ``default=str`` 兜底序列化、publish 抛错吞噬 + ``log.warning``、
  getter（get_redis）自身抛错同样吞噬；
- 五个收敛调用点等价性：session ``_publish_session_event`` / run_sync
  ``publish_session_event``（dict + BaseModel 两形态）与 ``_publish_run_event``
  / group ``_publish_group_channel_event`` 与 ``_publish_group_typing_event``
  ——channel 构造、payload 序列化、失败日志事件名与上下文逐一与收敛前相同，
  且 get_redis 仍经各包命名空间延迟解析（patch 面不变）。
"""

from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.modules.daemon.event_publish import publish_json_event


class TestCorePublishJsonEvent:
    @pytest.mark.asyncio
    async def test_normal_path_publishes_exact_json(self) -> None:
        """正常路径：publish 收到 channel + json.dumps(payload) 精确串。"""
        redis = MagicMock()
        redis.publish = AsyncMock()
        log = MagicMock()
        payload = {"event": "log", "content": "hi", "n": 3}
        await publish_json_event(
            redis_getter=lambda: redis,
            channel="agent_session:s1",
            payload=payload,
            log=log,
            failure_event="x_failed",
            session_id="s1",
        )
        redis.publish.assert_awaited_once_with("agent_session:s1", json.dumps(payload, default=str))
        log.warning.assert_not_called()

    @pytest.mark.asyncio
    async def test_default_str_serializes_non_json_types(self) -> None:
        """default=str 兜底：datetime / UUID 等不可序列化对象转字符串。"""
        redis = MagicMock()
        redis.publish = AsyncMock()
        payload = {"event": "tokens", "ts": datetime(2026, 9, 7, tzinfo=UTC)}
        await publish_json_event(
            redis_getter=lambda: redis,
            channel="c",
            payload=payload,
            log=MagicMock(),
            failure_event="x",
        )
        published = redis.publish.await_args.args[1]
        assert json.loads(published)["ts"] == "2026-09-07 00:00:00+00:00"

    @pytest.mark.asyncio
    async def test_publish_exception_swallowed_and_warned(self) -> None:
        """publish 抛错 → 吞噬不向上抛，log.warning 带事件名与上下文。"""
        boom = RuntimeError("redis down")
        redis = MagicMock()
        redis.publish = AsyncMock(side_effect=boom)
        log = MagicMock()
        await publish_json_event(
            redis_getter=lambda: redis,
            channel="c",
            payload={"event": "typing"},
            log=log,
            failure_event="publish_x_failed",
            group_id="g1",
            redis_event="typing",
        )
        log.warning.assert_called_once()
        args, kwargs = log.warning.call_args
        assert args[0] == "publish_x_failed"
        assert kwargs == {"group_id": "g1", "redis_event": "typing"}

    @pytest.mark.asyncio
    async def test_getter_failure_swallowed_too(self) -> None:
        """getter（get_redis）自身抛错在 try 内同样被吞噬 + warning。"""

        def _boom() -> object:
            raise RuntimeError("no redis pool")

        log = MagicMock()
        await publish_json_event(
            redis_getter=_boom,
            channel="c",
            payload={},
            log=log,
            failure_event="getter_failed",
        )
        log.warning.assert_called_once_with("getter_failed")


class TestSessionWrapper:
    @pytest.mark.asyncio
    async def test_publish_session_event_channel_and_payload(self) -> None:
        """session 包 helper：agent_session:{id} 频道 + payload 原样序列化。"""
        import app.modules.daemon.session.service as session_module
        from app.modules.daemon.session.service.helpers import _publish_session_event

        redis = MagicMock()
        redis.publish = AsyncMock()
        sid = uuid.uuid4()
        payload = {"event": "interrupted", "session_id": str(sid)}
        with patch.object(session_module, "get_redis", lambda: redis):
            await _publish_session_event(object(), sid, payload)
        redis.publish.assert_awaited_once_with(
            f"agent_session:{sid}", json.dumps(payload, default=str)
        )

    @pytest.mark.asyncio
    async def test_publish_session_event_failure_event_name_unchanged(self) -> None:
        """失败路径：仍经 session 模块 log 记 publish_session_event_failed。"""
        import app.modules.daemon.session.service as session_module
        from app.modules.daemon.session.service.helpers import _publish_session_event

        redis = MagicMock()
        redis.publish = AsyncMock(side_effect=RuntimeError("down"))
        with (
            patch.object(session_module, "get_redis", lambda: redis),
            patch.object(session_module.log, "warning") as mock_warn,
        ):
            await _publish_session_event(object(), uuid.uuid4(), {"event": "ended"})
        args, kwargs = mock_warn.call_args
        assert args[0] == "publish_session_event_failed"
        assert kwargs["redis_event"] == "ended"


class TestRunSyncWrappers:
    @pytest.mark.asyncio
    async def test_publish_session_event_dict_passthrough(self) -> None:
        """run_sync publish_session_event：dict payload 原样透传发布。"""
        import app.modules.daemon.run_sync.service as rs_module
        from app.modules.daemon.run_sync.service.publish import publish_session_event

        redis = MagicMock()
        redis.publish = AsyncMock()
        sid = uuid.uuid4()
        payload = {"event": "bash_status", "k": 1}
        with patch.object(rs_module, "get_redis", lambda: redis):
            await publish_session_event(sid, payload)
        redis.publish.assert_awaited_once_with(
            f"agent_session:{sid}", json.dumps(payload, default=str)
        )

    @pytest.mark.asyncio
    async def test_publish_session_event_base_model_dump_by_alias(self) -> None:
        """BaseModel payload 走 model_dump(mode=json, by_alias=True) 后发布。"""
        import app.modules.daemon.run_sync.service as rs_module
        from app.modules.daemon.run_sync.service.publish import publish_session_event
        from app.modules.daemon.schema import BashChunkEvent

        redis = MagicMock()
        redis.publish = AsyncMock()
        sid, rid = uuid.uuid4(), uuid.uuid4()
        event = BashChunkEvent(
            session_id=sid,
            run_id=rid,
            command="ls",
            channel="stdout",
            content="out",
        )
        with patch.object(rs_module, "get_redis", lambda: redis):
            await publish_session_event(sid, event)
        channel, message = redis.publish.await_args.args
        assert channel == f"agent_session:{sid}"
        dumped = json.loads(message)
        assert dumped == {
            "event": "bash_chunk",
            "session_id": str(sid),
            "run_id": str(rid),
            "command": "ls",
            "channel": "stdout",
            "content": "out",
            "is_final": False,
        }

    @pytest.mark.asyncio
    async def test_publish_session_event_failure_name_unchanged(self) -> None:
        """失败路径：事件名 session_event_redis_publish_failed、event_type 上下文。"""
        import app.modules.daemon.run_sync.service as rs_module
        from app.modules.daemon.run_sync.service.publish import publish_session_event

        redis = MagicMock()
        redis.publish = AsyncMock(side_effect=RuntimeError("down"))
        with (
            patch.object(rs_module, "get_redis", lambda: redis),
            patch.object(rs_module.log, "warning") as mock_warn,
        ):
            await publish_session_event(uuid.uuid4(), {"event": "bash_chunk"})
        args, kwargs = mock_warn.call_args
        assert args[0] == "session_event_redis_publish_failed"
        assert kwargs["event_type"] == "bash_chunk"

    @pytest.mark.asyncio
    async def test_publish_run_event_channel_payload_and_failure(self) -> None:
        """_publish_run_event：agent_run:{id} 频道 + extra 合并 + 失败事件名。"""
        import app.modules.daemon.run_sync.service as rs_module
        from app.modules.daemon.run_sync.service.publish import _publish_run_event

        redis = MagicMock()
        redis.publish = AsyncMock()
        run_id = uuid.uuid4()
        with patch.object(rs_module, "get_redis", lambda: redis):
            await _publish_run_event(
                object(), run_id, event="status_changed", status="completed", lease_id="L1"
            )
        channel, message = redis.publish.await_args.args
        assert channel == f"agent_run:{run_id}"
        assert json.loads(message) == {
            "event": "status_changed",
            "status": "completed",
            "lease_id": "L1",
        }

        redis_fail = MagicMock()
        redis_fail.publish = AsyncMock(side_effect=RuntimeError("down"))
        with (
            patch.object(rs_module, "get_redis", lambda: redis_fail),
            patch.object(rs_module.log, "warning") as mock_warn,
        ):
            await _publish_run_event(object(), run_id, event="status_changed", status="failed")
        args, kwargs = mock_warn.call_args
        assert args[0] == "publish_run_event_failed"
        assert kwargs == {"agent_run_id": str(run_id), "redis_event": "status_changed"}


class TestGroupWrappers:
    @pytest.mark.asyncio
    async def test_publish_group_channel_event_channel_and_failure(self) -> None:
        """group 频道 helper：agent_session:{id} 频道 + 失败事件名与上下文。"""
        import app.modules.daemon.group.service as group_module
        from app.modules.daemon.group.service.typing_presence import (
            _publish_group_channel_event,
        )

        redis = MagicMock()
        redis.publish = AsyncMock()
        sid = uuid.uuid4()
        payload = {"event": "log", "channel": "system", "content": "x"}
        with patch.object(group_module, "get_redis", lambda: redis):
            await _publish_group_channel_event(sid, payload)
        redis.publish.assert_awaited_once_with(
            f"agent_session:{sid}", json.dumps(payload, default=str)
        )

        redis_fail = MagicMock()
        redis_fail.publish = AsyncMock(side_effect=RuntimeError("down"))
        with (
            patch.object(group_module, "get_redis", lambda: redis_fail),
            patch.object(group_module.log, "warning") as mock_warn,
        ):
            await _publish_group_channel_event(sid, payload)
        args, kwargs = mock_warn.call_args
        assert args[0] == "publish_group_channel_event_failed"
        assert kwargs["redis_event"] == "log"
        assert kwargs["session_id"] == str(sid)

    @pytest.mark.asyncio
    async def test_publish_group_typing_event_channel_and_failure(self) -> None:
        """group typing helper：group_typing:{id} 频道（单源 channel 构造）+ 失败。"""
        import app.modules.daemon.group.service as group_module
        from app.modules.daemon.group.service.typing_presence import (
            _publish_group_typing_event,
        )

        redis = MagicMock()
        redis.publish = AsyncMock()
        gid = uuid.uuid4()
        payload = {"event": "typing", "member_name": "a"}
        with patch.object(group_module, "get_redis", lambda: redis):
            await _publish_group_typing_event(gid, payload)
        redis.publish.assert_awaited_once_with(
            f"group_typing:{gid}", json.dumps(payload, default=str)
        )

        redis_fail = MagicMock()
        redis_fail.publish = AsyncMock(side_effect=RuntimeError("down"))
        with (
            patch.object(group_module, "get_redis", lambda: redis_fail),
            patch.object(group_module.log, "warning") as mock_warn,
        ):
            await _publish_group_typing_event(gid, payload)
        args, kwargs = mock_warn.call_args
        assert args[0] == "publish_group_typing_event_failed"
        assert kwargs["group_id"] == str(gid)
        assert kwargs["redis_event"] == "typing"
