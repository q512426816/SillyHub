"""Tests for ws_hub.send_policy_update envelope + offline behavior (task-07 / D-004).

send_policy_update is a thin wrapper around send_to_runtime that emits the
``daemon:policy_update`` downlink carrying runtime_id / allowed_roots / version.
We assert the assembled envelope shape and the best-effort False return when the
runtime is unreachable (heartbeat reconciles later, no raise).
"""

from __future__ import annotations

import uuid
from typing import Any
from unittest.mock import AsyncMock

import pytest


class TestSendPolicyUpdate:
    @pytest.mark.asyncio
    async def test_online_sends_correct_envelope(self) -> None:
        from app.modules.daemon.protocol import DAEMON_MSG_POLICY_UPDATE
        from app.modules.daemon.ws_hub import DaemonWsHub

        hub = DaemonWsHub()
        rid = uuid.uuid4()
        ws = AsyncMock()
        sent: list[dict[str, Any]] = []

        async def _send_json(message: dict[str, Any]) -> None:
            sent.append(message)

        ws.send_json = AsyncMock(side_effect=_send_json)
        ws.close = AsyncMock()
        await hub.connect(rid, ws)

        roots = ["D:/proj", "D:/other"]
        ok = await hub.send_policy_update(rid, roots, version=3)

        assert ok is True
        assert len(sent) == 1
        envelope = sent[0]
        assert envelope["type"] == DAEMON_MSG_POLICY_UPDATE
        assert envelope["payload"] == {
            "runtime_id": str(rid),
            "allowed_roots": roots,
            "version": 3,
        }

    @pytest.mark.asyncio
    async def test_offline_returns_false_no_raise(self) -> None:
        from app.modules.daemon.ws_hub import DaemonWsHub

        hub = DaemonWsHub()
        # Patch send_to_runtime to simulate the offline (False) path explicitly.
        hub.send_to_runtime = AsyncMock(return_value=False)
        ok = await hub.send_policy_update(uuid.uuid4(), ["D:/x"], version=1)
        assert ok is False

    @pytest.mark.asyncio
    async def test_unconnected_runtime_returns_false(self) -> None:
        from app.modules.daemon.ws_hub import DaemonWsHub

        hub = DaemonWsHub()
        # No connect() called — runtime_id absent from the registry.
        ok = await hub.send_policy_update(uuid.uuid4(), ["D:/x"], version=1)
        assert ok is False
