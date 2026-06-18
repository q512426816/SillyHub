"""Tests for DaemonWsHub.send_session_control (task-05).

Covers AC-06/AC-08 control message delivery (online) and the offline-fallback
contract that the service layer relies on (DaemonRuntimeOffline convergence).
No DB dependency — uses a fresh hub + mock WebSocket like test_ws_hub.py.
"""

from __future__ import annotations

import uuid
from typing import Any
from unittest.mock import AsyncMock

import pytest

from app.modules.daemon.protocol import (
    DAEMON_MSG_SESSION_END,
    DAEMON_MSG_SESSION_INJECT,
    DAEMON_MSG_SESSION_INTERRUPT,
)
from app.modules.daemon.ws_hub import DaemonWsHub


def _make_mock_ws() -> AsyncMock:
    ws = AsyncMock()
    ws.sent_messages = []  # type: ignore[attr-defined]

    async def _send_json(message: dict[str, Any]) -> None:
        ws.sent_messages.append(message)

    ws.send_json = AsyncMock(side_effect=_send_json)
    ws.close = AsyncMock()
    return ws


class TestSendSessionControl:
    @pytest.mark.asyncio
    async def test_inject_message_delivered(self) -> None:
        hub = DaemonWsHub()
        rid = uuid.uuid4()
        ws = _make_mock_ws()
        await hub.connect(rid, ws)

        payload = {
            "session_id": "00000000-0000-0000-0000-000000000001",
            "lease_id": "00000000-0000-0000-0000-000000000002",
            "run_id": "00000000-0000-0000-0000-000000000003",
            "prompt": "hello",
        }
        ok = await hub.send_session_control(rid, DAEMON_MSG_SESSION_INJECT, payload)

        assert ok is True
        assert len(ws.sent_messages) == 1
        msg = ws.sent_messages[0]
        assert msg["type"] == DAEMON_MSG_SESSION_INJECT
        assert msg["payload"] == payload

    @pytest.mark.asyncio
    async def test_interrupt_message_uses_control_payload(self) -> None:
        hub = DaemonWsHub()
        rid = uuid.uuid4()
        ws = _make_mock_ws()
        await hub.connect(rid, ws)

        payload = {
            "session_id": "00000000-0000-0000-0000-000000000001",
            "lease_id": "00000000-0000-0000-0000-000000000002",
        }
        ok = await hub.send_session_control(rid, DAEMON_MSG_SESSION_INTERRUPT, payload)

        assert ok is True
        assert ws.sent_messages[0]["type"] == DAEMON_MSG_SESSION_INTERRUPT
        # INTERRUPT carries only session_id + lease_id (no run_id, no prompt)
        assert set(ws.sent_messages[0]["payload"].keys()) == {"session_id", "lease_id"}

    @pytest.mark.asyncio
    async def test_end_message_delivered(self) -> None:
        hub = DaemonWsHub()
        rid = uuid.uuid4()
        ws = _make_mock_ws()
        await hub.connect(rid, ws)

        ok = await hub.send_session_control(
            rid,
            DAEMON_MSG_SESSION_END,
            {"session_id": "s1", "lease_id": "l1"},
        )
        assert ok is True
        assert ws.sent_messages[0]["type"] == DAEMON_MSG_SESSION_END

    @pytest.mark.asyncio
    async def test_offline_runtime_returns_false(self) -> None:
        """No connected runtime → service layer must converge to offline error."""
        hub = DaemonWsHub()
        rid = uuid.uuid4()  # never connected
        ok = await hub.send_session_control(
            rid,
            DAEMON_MSG_SESSION_INJECT,
            {"session_id": "s", "lease_id": "l", "run_id": "r", "prompt": "p"},
        )
        assert ok is False

    @pytest.mark.asyncio
    async def test_slow_connection_evicted_returns_false(self) -> None:
        """A send_json that raises must surface False (end_session keeps reconciling)."""
        import asyncio

        hub = DaemonWsHub()
        rid = uuid.uuid4()
        ws = AsyncMock()

        async def _boom(_msg: dict[str, Any]) -> None:
            raise RuntimeError("broken pipe")

        ws.send_json = AsyncMock(side_effect=_boom)
        ws.close = AsyncMock()
        await hub.connect(rid, ws)

        ok = await hub.send_session_control(
            rid,
            DAEMON_MSG_SESSION_INTERRUPT,
            {"session_id": "s", "lease_id": "l"},
        )
        assert ok is False
        # disconnect path should have evicted the bad connection
        await asyncio.sleep(0)  # let disconnect coroutine settle
        assert hub.is_connected(rid) is False
