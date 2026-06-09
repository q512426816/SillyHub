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
    ws.sent_messages = []  # type: ignore[attr-defined]

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
