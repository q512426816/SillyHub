"""Tests for DaemonWsHub — connection management, wakeup signals, heartbeat,
slow-connection eviction, dedup, and full lifecycle scenarios.

DaemonWsHub has no database dependency, so all tests use a fresh hub instance
and lightweight mock WebSocket objects.
"""

from __future__ import annotations

import uuid
from typing import Any
from unittest.mock import AsyncMock

import pytest

from app.modules.daemon.protocol import (
    DAEMON_MSG_HEARTBEAT_ACK,
    DAEMON_MSG_TASK_AVAILABLE,
)
from app.modules.daemon.ws_hub import DaemonWsHub

# ── Helpers ──────────────────────────────────────────────────────────────────


def _make_mock_ws() -> AsyncMock:
    """Create a mock WebSocket that records sent JSON messages."""
    ws = AsyncMock()
    ws.sent_messages = []

    async def _send_json(message: dict[str, Any]) -> None:
        ws.sent_messages.append(message)

    ws.send_json = AsyncMock(side_effect=_send_json)
    ws.close = AsyncMock()
    return ws


# ── Connection Management ────────────────────────────────────────────────────


class TestConnectAndDisconnect:
    """Tests for connect / disconnect lifecycle."""

    @pytest.mark.asyncio
    async def test_connect_and_disconnect(self) -> None:
        """connect registers a runtime; disconnect removes it."""
        hub = DaemonWsHub()
        rid = uuid.uuid4()
        ws = _make_mock_ws()

        await hub.connect(rid, ws)

        assert hub.is_connected(rid) is True
        assert hub.connected_count == 1
        assert rid in hub.connected_runtime_ids

        await hub.disconnect(rid)

        assert hub.is_connected(rid) is False
        assert hub.connected_count == 0
        assert rid not in hub.connected_runtime_ids

    @pytest.mark.asyncio
    async def test_disconnect_when_not_connected_is_noop(self) -> None:
        """disconnect on an unknown runtime_id is a silent no-op."""
        hub = DaemonWsHub()
        rid = uuid.uuid4()

        # Should not raise
        await hub.disconnect(rid)

        assert hub.connected_count == 0

    @pytest.mark.asyncio
    async def test_connect_replaces_existing(self) -> None:
        """connecting with the same runtime_id closes the old ws and uses the new one."""
        hub = DaemonWsHub()
        rid = uuid.uuid4()

        old_ws = _make_mock_ws()
        new_ws = _make_mock_ws()

        await hub.connect(rid, old_ws)
        assert hub.connected_count == 1

        # Replace with new connection
        await hub.connect(rid, new_ws)

        # Old ws should have been closed
        old_ws.close.assert_awaited_once()
        old_ws.close.assert_awaited_once_with(code=4000, reason="replaced")

        # Hub tracks only the new ws
        assert hub.connected_count == 1
        assert hub.is_connected(rid) is True

        # Sending a message should go to the new ws, not the old one
        msg = {"type": "test", "payload": {}}
        result = await hub.send_to_runtime(rid, msg)
        assert result is True
        assert len(new_ws.sent_messages) == 1
        assert new_ws.sent_messages[0] == msg
        assert len(old_ws.sent_messages) == 0


# ── Wakeup Signals ──────────────────────────────────────────────────────────


class TestSendWakeup:
    """Tests for send_wakeup and notify_task_available."""

    @pytest.mark.asyncio
    async def test_send_wakeup_delivers_message(self) -> None:
        """send_wakeup sends a task_available message with the correct payload."""
        hub = DaemonWsHub()
        rid = uuid.uuid4()
        ws = _make_mock_ws()
        task_id = uuid.uuid4()
        lease_id = uuid.uuid4()

        await hub.connect(rid, ws)

        result = await hub.send_wakeup(rid, task_id=task_id, lease_id=lease_id)

        assert result is True
        assert len(ws.sent_messages) == 1

        msg = ws.sent_messages[0]
        assert msg["type"] == DAEMON_MSG_TASK_AVAILABLE
        assert msg["payload"]["runtime_id"] == str(rid)
        assert msg["payload"]["task_id"] == str(task_id)
        assert msg["payload"]["lease_id"] == str(lease_id)

    @pytest.mark.asyncio
    async def test_send_wakeup_to_offline_runtime(self) -> None:
        """send_wakeup to a disconnected runtime returns False without error."""
        hub = DaemonWsHub()
        rid = uuid.uuid4()

        result = await hub.send_wakeup(rid, task_id=uuid.uuid4())

        assert result is False

    @pytest.mark.asyncio
    async def test_send_wakeup_accepts_string_ids(self) -> None:
        """send_wakeup converts str IDs to UUID automatically."""
        hub = DaemonWsHub()
        rid = uuid.uuid4()
        ws = _make_mock_ws()
        task_id = uuid.uuid4()

        await hub.connect(rid, ws)

        result = await hub.send_wakeup(str(rid), task_id=str(task_id))

        assert result is True
        msg = ws.sent_messages[0]
        assert msg["payload"]["runtime_id"] == str(rid)
        assert msg["payload"]["task_id"] == str(task_id)

    @pytest.mark.asyncio
    async def test_notify_task_available_dedup_skips_same_key(self) -> None:
        """Duplicate notify_task_available calls (same task_id) are deduped."""
        hub = DaemonWsHub()
        rid = uuid.uuid4()
        ws = _make_mock_ws()
        task_id = uuid.uuid4()

        await hub.connect(rid, ws)

        # First call sends the message
        result1 = await hub.notify_task_available(rid, task_id=task_id)
        assert result1 is True
        assert len(ws.sent_messages) == 1

        # Second call with same task_id is deduped — still returns True but no new message
        result2 = await hub.notify_task_available(rid, task_id=task_id)
        assert result2 is True
        assert len(ws.sent_messages) == 1  # No additional message sent

    @pytest.mark.asyncio
    async def test_notify_task_available_dedup_different_keys_sent(self) -> None:
        """Different task_ids are not deduped — each gets a separate message."""
        hub = DaemonWsHub()
        rid = uuid.uuid4()
        ws = _make_mock_ws()

        await hub.connect(rid, ws)

        result1 = await hub.notify_task_available(rid, task_id=uuid.uuid4())
        result2 = await hub.notify_task_available(rid, task_id=uuid.uuid4())

        assert result1 is True
        assert result2 is True
        assert len(ws.sent_messages) == 2

    @pytest.mark.asyncio
    async def test_notify_task_available_dedup_sliding_window_evicts_old_entries(self) -> None:
        """After 128 unique dedup keys, the oldest is evicted and can be re-sent.

        The dedup window uses a deque with maxlen=128. Once 128 distinct keys
        have been pushed, the oldest key falls off and a subsequent call with
        the same key will NOT be deduped (it gets sent again).
        """
        hub = DaemonWsHub()
        rid = uuid.uuid4()
        ws = _make_mock_ws()

        await hub.connect(rid, ws)

        first_task_id = uuid.uuid4()

        # Send the first wakeup — this is the one we'll try to re-send later
        await hub.notify_task_available(rid, task_id=first_task_id)
        assert len(ws.sent_messages) == 1

        # Fill the window with 128 additional unique task_ids
        for _ in range(128):
            await hub.notify_task_available(rid, task_id=uuid.uuid4())

        # Total messages = 1 (first) + 128 (filler) = 129
        assert len(ws.sent_messages) == 129

        # The first task_id has been evicted from the sliding window,
        # so sending it again should NOT be deduped
        result = await hub.notify_task_available(rid, task_id=first_task_id)
        assert result is True
        assert len(ws.sent_messages) == 130  # One more message was actually sent


# ── Heartbeat ACK ───────────────────────────────────────────────────────────


class TestHeartbeatAck:
    """Tests for send_heartbeat_ack."""

    @pytest.mark.asyncio
    async def test_heartbeat_ack_sent(self) -> None:
        """send_heartbeat_ack sends a heartbeat_ack message to the runtime."""
        hub = DaemonWsHub()
        rid = uuid.uuid4()
        ws = _make_mock_ws()

        await hub.connect(rid, ws)

        result = await hub.send_heartbeat_ack(rid)

        assert result is True
        assert len(ws.sent_messages) == 1

        msg = ws.sent_messages[0]
        assert msg["type"] == DAEMON_MSG_HEARTBEAT_ACK
        assert msg["payload"]["runtime_id"] == str(rid)
        assert msg["payload"]["pending_operations"] == {}

    @pytest.mark.asyncio
    async def test_heartbeat_ack_with_pending_ops(self) -> None:
        """send_heartbeat_ack includes pending_operations when provided."""
        hub = DaemonWsHub()
        rid = uuid.uuid4()
        ws = _make_mock_ws()

        await hub.connect(rid, ws)

        pending_ops = {
            "tasks_queued": 3,
            "leases_active": 1,
        }
        result = await hub.send_heartbeat_ack(rid, pending_operations=pending_ops)

        assert result is True
        msg = ws.sent_messages[0]
        assert msg["type"] == DAEMON_MSG_HEARTBEAT_ACK
        assert msg["payload"]["pending_operations"] == pending_ops

    @pytest.mark.asyncio
    async def test_heartbeat_ack_to_offline_runtime(self) -> None:
        """send_heartbeat_ack to disconnected runtime returns False."""
        hub = DaemonWsHub()
        rid = uuid.uuid4()

        result = await hub.send_heartbeat_ack(rid)
        assert result is False


# ── Slow Connection Eviction ────────────────────────────────────────────────


class TestSlowConnectionEviction:
    """Tests for slow-connection eviction via send timeout."""

    @pytest.mark.asyncio
    async def test_slow_connection_evicted(self) -> None:
        """A WebSocket whose send_json hangs is evicted (disconnected) and returns False."""
        hub = DaemonWsHub()
        rid = uuid.uuid4()

        ws = AsyncMock()
        # Simulate a slow send that never completes — will trigger asyncio.wait_for timeout
        ws.send_json = AsyncMock(side_effect=TimeoutError())
        ws.close = AsyncMock()

        await hub.connect(rid, ws)

        # send_to_runtime should catch the timeout, evict the connection, return False
        result = await hub.send_to_runtime(rid, {"type": "test"})

        assert result is False
        assert hub.is_connected(rid) is False

    @pytest.mark.asyncio
    async def test_send_error_evicts_connection(self) -> None:
        """A WebSocket that raises a generic exception during send is evicted."""
        hub = DaemonWsHub()
        rid = uuid.uuid4()

        ws = AsyncMock()
        ws.send_json = AsyncMock(side_effect=RuntimeError("connection reset"))
        ws.close = AsyncMock()

        await hub.connect(rid, ws)

        result = await hub.send_to_runtime(rid, {"type": "test"})

        assert result is False
        assert hub.is_connected(rid) is False

    # 2026-10-26-ws-evict-close：逐出必须对旧 socket 主动 close——否则 daemon
    # 侧 TCP 连接仍在（ping/pong 正常）永不感知、永不重连，backend 路由表缺口
    # 持续到重启（2026-10-26 生产事故实证：15min 全部 session_inject 判死）。

    @pytest.mark.asyncio
    async def test_evicted_socket_gets_closed_on_timeout(self) -> None:
        """Timeout eviction must actively close the evicted socket (code=4000)."""
        hub = DaemonWsHub()
        rid = uuid.uuid4()

        ws = AsyncMock()
        ws.send_json = AsyncMock(side_effect=TimeoutError())
        ws.close = AsyncMock()

        await hub.connect(rid, ws)
        result = await hub.send_to_runtime(rid, {"type": "test"})

        assert result is False
        ws.close.assert_awaited_once()
        assert ws.close.await_args.kwargs.get("code") == 4000

    @pytest.mark.asyncio
    async def test_evicted_socket_gets_closed_on_send_error(self) -> None:
        """Exception eviction must actively close the evicted socket (code=4000)."""
        hub = DaemonWsHub()
        rid = uuid.uuid4()

        ws = AsyncMock()
        ws.send_json = AsyncMock(side_effect=RuntimeError("connection reset"))
        ws.close = AsyncMock()

        await hub.connect(rid, ws)
        result = await hub.send_to_runtime(rid, {"type": "test"})

        assert result is False
        ws.close.assert_awaited_once()
        assert ws.close.await_args.kwargs.get("code") == 4000

    @pytest.mark.asyncio
    async def test_close_failure_does_not_break_eviction(self) -> None:
        """close itself failing must not break eviction semantics (best-effort)."""
        hub = DaemonWsHub()
        rid = uuid.uuid4()

        ws = AsyncMock()
        ws.send_json = AsyncMock(side_effect=TimeoutError())
        ws.close = AsyncMock(side_effect=RuntimeError("transport already closed"))

        await hub.connect(rid, ws)
        result = await hub.send_to_runtime(rid, {"type": "test"})

        assert result is False
        assert hub.is_connected(rid) is False
        ws.close.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_evict_identity_check_spares_reconnected_new_socket(self) -> None:
        """_evict_stale on a replaced socket must not close either socket.

        快速重连：connect 换新 ws 后，旧 ws 触发的逐出（身份校验不过）既不清表、
        也不追加 close——新连接无辜；旧 ws 此前已被 connect 替换路径关闭
        （"replaced" 先例），本断言对比基准次数排除该既有关闭的干扰。
        """
        hub = DaemonWsHub()
        rid = uuid.uuid4()
        old_ws = _make_mock_ws()
        new_ws = _make_mock_ws()
        old_ws.send_json = AsyncMock(side_effect=TimeoutError())
        old_ws.close = AsyncMock()
        new_ws.close = AsyncMock()

        await hub.connect(rid, old_ws)
        await hub.connect(rid, new_ws)  # 替换注册（connect 内已 close 旧 ws）
        replaced_close_count = old_ws.close.await_count

        result = await hub._evict_stale(rid, old_ws)

        assert result is False
        assert hub.is_connected(rid) is True
        assert hub._connections.get(rid) is new_ws
        assert old_ws.close.await_count == replaced_close_count
        new_ws.close.assert_not_awaited()


# ── Broadcast ───────────────────────────────────────────────────────────────


class TestBroadcast:
    """Tests for broadcast method."""

    @pytest.mark.asyncio
    async def test_broadcast_sends_to_all(self) -> None:
        """broadcast sends a message to every connected runtime."""
        hub = DaemonWsHub()

        ws1 = _make_mock_ws()
        ws2 = _make_mock_ws()
        ws3 = _make_mock_ws()
        rid1, rid2, rid3 = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()

        await hub.connect(rid1, ws1)
        await hub.connect(rid2, ws2)
        await hub.connect(rid3, ws3)

        msg = {"type": "announce", "payload": {"info": "hello"}}
        sent = await hub.broadcast(msg)

        assert sent == 3
        assert len(ws1.sent_messages) == 1
        assert len(ws2.sent_messages) == 1
        assert len(ws3.sent_messages) == 1

    @pytest.mark.asyncio
    async def test_broadcast_excludes_runtimes(self) -> None:
        """broadcast with exclude= skips the specified runtime IDs."""
        hub = DaemonWsHub()

        ws1 = _make_mock_ws()
        ws2 = _make_mock_ws()
        rid1, rid2 = uuid.uuid4(), uuid.uuid4()

        await hub.connect(rid1, ws1)
        await hub.connect(rid2, ws2)

        msg = {"type": "announce", "payload": {}}
        sent = await hub.broadcast(msg, exclude={rid1})

        assert sent == 1
        assert len(ws1.sent_messages) == 0
        assert len(ws2.sent_messages) == 1

    @pytest.mark.asyncio
    async def test_broadcast_returns_zero_when_none_connected(self) -> None:
        """broadcast with no connections returns 0."""
        hub = DaemonWsHub()

        sent = await hub.broadcast({"type": "noop"})
        assert sent == 0


# ── Full Lifecycle Integration ──────────────────────────────────────────────


class TestFullLifecycle:
    """End-to-end lifecycle tests: connect -> heartbeat -> wakeup -> disconnect."""

    @pytest.mark.asyncio
    async def test_full_lifecycle_connect_heartbeat_disconnect(self) -> None:
        """A runtime connects, receives heartbeat ack and wakeup, then disconnects."""
        hub = DaemonWsHub()
        rid = uuid.uuid4()
        ws = _make_mock_ws()

        # 1. Connect
        await hub.connect(rid, ws)
        assert hub.is_connected(rid) is True
        assert hub.connected_count == 1

        # 2. Heartbeat ACK
        hb_result = await hub.send_heartbeat_ack(rid)
        assert hb_result is True
        assert ws.sent_messages[-1]["type"] == DAEMON_MSG_HEARTBEAT_ACK

        # 3. Wakeup for a task
        task_id = uuid.uuid4()
        wk_result = await hub.send_wakeup(rid, task_id=task_id)
        assert wk_result is True
        assert ws.sent_messages[-1]["type"] == DAEMON_MSG_TASK_AVAILABLE

        # 4. Second heartbeat with pending ops
        pending = {"tasks_queued": 5}
        hb2_result = await hub.send_heartbeat_ack(rid, pending_operations=pending)
        assert hb2_result is True
        assert ws.sent_messages[-1]["payload"]["pending_operations"] == pending

        # 5. Disconnect
        await hub.disconnect(rid)
        assert hub.is_connected(rid) is False
        assert hub.connected_count == 0

        # 6. After disconnect, further sends fail gracefully
        post_result = await hub.send_heartbeat_ack(rid)
        assert post_result is False

        # Verify message ordering: heartbeat_ack, task_available, heartbeat_ack
        assert len(ws.sent_messages) == 3
        assert ws.sent_messages[0]["type"] == DAEMON_MSG_HEARTBEAT_ACK
        assert ws.sent_messages[1]["type"] == DAEMON_MSG_TASK_AVAILABLE
        assert ws.sent_messages[2]["type"] == DAEMON_MSG_HEARTBEAT_ACK

    @pytest.mark.asyncio
    async def test_reconnect_replaces_and_resumes(self) -> None:
        """A runtime reconnects after disconnect; old connection is replaced."""
        hub = DaemonWsHub()
        rid = uuid.uuid4()

        # First connection
        ws1 = _make_mock_ws()
        await hub.connect(rid, ws1)
        await hub.send_wakeup(rid, task_id=uuid.uuid4())
        assert len(ws1.sent_messages) == 1

        # Disconnect
        await hub.disconnect(rid)
        assert hub.is_connected(rid) is False

        # Reconnect with new ws (simulates client reconnect)
        ws2 = _make_mock_ws()
        await hub.connect(rid, ws2)
        assert hub.is_connected(rid) is True

        # Messages now go to the new connection
        await hub.send_heartbeat_ack(rid)
        assert len(ws2.sent_messages) == 1
        assert ws2.sent_messages[0]["type"] == DAEMON_MSG_HEARTBEAT_ACK

    @pytest.mark.asyncio
    async def test_multiple_runtimes_independent_lifecycle(self) -> None:
        """Multiple runtimes can connect/disconnect independently."""
        hub = DaemonWsHub()

        rid_a, rid_b = uuid.uuid4(), uuid.uuid4()
        ws_a = _make_mock_ws()
        ws_b = _make_mock_ws()

        # Both connect
        await hub.connect(rid_a, ws_a)
        await hub.connect(rid_b, ws_b)
        assert hub.connected_count == 2

        # Send wakeup to only A
        task_a = uuid.uuid4()
        await hub.send_wakeup(rid_a, task_id=task_a)
        assert len(ws_a.sent_messages) == 1
        assert len(ws_b.sent_messages) == 0

        # Disconnect A
        await hub.disconnect(rid_a)
        assert hub.connected_count == 1
        assert hub.is_connected(rid_a) is False
        assert hub.is_connected(rid_b) is True

        # B still receives messages
        await hub.send_heartbeat_ack(rid_b)
        assert len(ws_b.sent_messages) == 1


# ── task-04（2026-10-16-backend-mem-polling / D-004@v1）：泄漏径与身份校验 ────


class TestDisconnectIdentityCheck:
    """disconnect(ws=...) 连接身份校验：旧 handler 收尾不得踢新连接。"""

    @pytest.mark.asyncio
    async def test_stale_handler_disconnect_keeps_new_connection(self) -> None:
        """快速重连：connect 换新 ws 后，旧 handler 的 disconnect(ws=旧) 不清表。"""
        hub = DaemonWsHub()
        rid = uuid.uuid4()
        old_ws = _make_mock_ws()
        new_ws = _make_mock_ws()

        await hub.connect(rid, old_ws)
        await hub.connect(rid, new_ws)  # 替换注册（connect 内关旧 ws）

        await hub.disconnect(rid, ws=old_ws)  # 旧 handler 的滞后收尾

        assert hub.is_connected(rid) is True, "新连接必须幸存"
        assert hub._connections.get(rid) is new_ws

        await hub.disconnect(rid, ws=new_ws)  # 新 handler 正常收尾
        assert hub.is_connected(rid) is False

    @pytest.mark.asyncio
    async def test_disconnect_without_ws_keeps_legacy_semantics(self) -> None:
        """不传 ws 保持旧语义（无条件 pop）——存量调用/测试零回归。"""
        hub = DaemonWsHub()
        rid = uuid.uuid4()
        ws = _make_mock_ws()
        await hub.connect(rid, ws)
        await hub.disconnect(rid)  # 不带身份校验
        assert hub.is_connected(rid) is False


class TestPendingRpcsCleanup:
    """_pending_rpcs 两条泄漏径：外部取消清理 / done future 早退前 pop。"""

    @pytest.mark.asyncio
    async def test_send_rpc_external_cancel_cleans_pending(self) -> None:
        """HTTP 调用方在等待中被取消 → 条目清理，不残留。"""
        hub = DaemonWsHub()
        rid = uuid.uuid4()
        ws = _make_mock_ws()
        await hub.connect(rid, ws)

        import asyncio

        from app.modules.daemon.runtime.service import DaemonRuntimeOffline

        outer = asyncio.create_task(hub.send_rpc(rid, "list_dir", {"path": "/x"}, timeout=5.0))
        await asyncio.sleep(0.05)  # 让 send_rpc 注册 pending 并进入等待
        outer.cancel()
        with pytest.raises((asyncio.CancelledError, DaemonRuntimeOffline)):
            await outer
        await asyncio.sleep(0.05)  # 让 CancelledError 分支的清理完成
        # 外层取消会级联取消内层 wait_for → CancelledError 分支 → _cancel_rpc 清表
        pending = [k for k, v in hub._pending_rpcs.items() if v[0] == rid]
        assert pending == [], f"外部取消后不得残留 pending 条目: {pending}"
        await hub.disconnect(rid)

    @pytest.mark.asyncio
    async def test_resolve_rpc_done_future_pops_entry(self) -> None:
        """迟到回包命中 done future → 早退前 pop（不永久驻留）。"""
        import asyncio

        hub = DaemonWsHub()

        fut: asyncio.Future = asyncio.get_event_loop().create_future()
        fut.set_result({"result": {"first": True}})  # 已完成（模拟超时后被取消/置结果）
        hub._pending_rpcs["rpc-done-1"] = (uuid.uuid4(), fut)

        await hub.resolve_rpc("rpc-done-1", {"result": {"late": True}})

        assert "rpc-done-1" not in hub._pending_rpcs, "done future 早退前必须 pop"


# ── task-06（2026-10-16-backend-mem-polling / D-001@v1）：change-write 轻通知 ─


class TestNotifyChangeWriteAvailable:
    """notify_change_write_available：解析→定向推送；best-effort 三态不抛。"""

    @pytest.mark.asyncio
    async def test_notify_sends_payload_with_resolved_daemon(self, monkeypatch) -> None:
        import app.modules.daemon.ws_hub as hub_mod

        rid, did, wid = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
        sent_messages: list = []

        class _FakeHub:
            async def send_to_runtime(self, daemon_id, message):
                sent_messages.append((daemon_id, message))
                return True

        monkeypatch.setattr(hub_mod, "get_daemon_ws_hub", lambda: _FakeHub())

        async def _fake_resolve(session, runtime_id):
            assert runtime_id == rid
            return did

        monkeypatch.setattr(
            "app.modules.daemon.session.service._resolve_daemon_id_for_runtime", _fake_resolve
        )
        # 间接引用（helper 内函数级 import 从源模块取属性——testing-gotchas 惯例）

        ok = await hub_mod.notify_change_write_available(None, rid, wid)
        assert ok is True
        assert sent_messages == [
            (
                did,
                {
                    "type": "daemon:change_write_available",
                    "payload": {"runtime_id": str(rid), "workspace_id": str(wid)},
                },
            )
        ]

    @pytest.mark.asyncio
    async def test_notify_no_daemon_returns_false_without_send(self, monkeypatch) -> None:
        import app.modules.daemon.ws_hub as hub_mod

        rid = uuid.uuid4()
        called = []

        class _FakeHub:
            async def send_to_runtime(self, *a, **k):  # pragma: no cover - 不应被调
                called.append(a)
                return True

        monkeypatch.setattr(hub_mod, "get_daemon_ws_hub", lambda: _FakeHub())

        async def _none_resolve(session, runtime_id):
            return None

        monkeypatch.setattr(
            "app.modules.daemon.session.service._resolve_daemon_id_for_runtime", _none_resolve
        )
        assert await hub_mod.notify_change_write_available(None, rid) is False
        assert called == []

    @pytest.mark.asyncio
    async def test_notify_send_exception_swallowed(self, monkeypatch) -> None:
        import app.modules.daemon.ws_hub as hub_mod

        rid, did = uuid.uuid4(), uuid.uuid4()

        class _FakeHub:
            async def send_to_runtime(self, daemon_id, message):
                raise RuntimeError("ws broken")

        monkeypatch.setattr(hub_mod, "get_daemon_ws_hub", lambda: _FakeHub())

        async def _ok_resolve(session, runtime_id):
            return did

        monkeypatch.setattr(
            "app.modules.daemon.session.service._resolve_daemon_id_for_runtime", _ok_resolve
        )
        # 发送异常被吞（best-effort），返回 False 不抛
        assert await hub_mod.notify_change_write_available(None, rid) is False
