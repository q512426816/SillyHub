"""Tests for ``app.modules.daemon.host_fs.ws_rpc.send_host_fs_rpc``.

Covers task-02 of change ``2026-07-06-daemon-host-fs-delegate``.

Four-path coverage mirroring ``test_ws_rpc.py`` style (mock ``ws_hub`` +
``resolve_rpc``):

* success — ``send_rpc`` returns the daemon ``result`` dict, ``send_host_fs_rpc``
  passes it through verbatim and packs ``workspace_id`` + ``args`` into params.
* timeout — ``send_rpc`` raises ``DaemonRpcTimeout``; the wrapper re-raises
  verbatim (no swallowing; task-04's HostFsDelegate layer owns the
  downgrade-to-warn policy per D-006).
* offline — ``send_rpc`` raises ``DaemonRuntimeOffline``; verbatim re-raise.
* remote_error — ``send_rpc`` raises ``DaemonRpcRemoteError``; verbatim re-raise.

Plus envelope-shape assertions: method gets the ``host_fs.`` prefix, params
carry ``workspace_id`` as a string, and the 30s default timeout is forwarded
(overridable per call).
"""

from __future__ import annotations

import asyncio
import uuid
from typing import Any
from unittest.mock import AsyncMock

import pytest

from app.modules.daemon.host_fs.ws_rpc import send_host_fs_rpc
from app.modules.daemon.service import (
    DaemonRpcRemoteError,
    DaemonRpcTimeout,
    DaemonRuntimeOffline,
)


def _make_mock_ws_hub() -> AsyncMock:
    """Build a mock DaemonWsHub exposing ``send_rpc`` as an AsyncMock.

    The mock records the call args so envelope-shape assertions can inspect
    ``method`` / ``params`` / ``timeout`` without spinning a real hub.
    """
    hub = AsyncMock()
    hub.send_rpc = AsyncMock()
    return hub


# ── success path ─────────────────────────────────────────────────────────────


class TestSendHostFsRpcSuccess:
    async def test_success_returns_result_and_packs_params(self) -> None:
        hub = _make_mock_ws_hub()
        hub.send_rpc.return_value = {"ok": True, "conflict_detail": None}

        daemon_id = uuid.uuid4()
        workspace_id = uuid.uuid4()

        result = await send_host_fs_rpc(
            hub,
            daemon_id,
            method="git_apply",
            workspace_id=workspace_id,
            args={"patch_data": "diff --git a/x b/x", "use_3way": True},
        )

        assert result == {"ok": True, "conflict_detail": None}

        # Envelope shape: host_fs. prefix + workspace_id packed into params +
        # args merged in + daemon_id forwarded as routing key.
        hub.send_rpc.assert_awaited_once()
        call = hub.send_rpc.await_args
        assert call.args == (daemon_id,)
        assert call.kwargs["method"] == "host_fs.git_apply"
        assert call.kwargs["params"] == {
            "workspace_id": str(workspace_id),
            "patch_data": "diff --git a/x b/x",
            "use_3way": True,
        }
        # 30s default timeout forwarded (D-006).
        assert call.kwargs["timeout"] == 30.0

    async def test_success_forwards_custom_timeout(self) -> None:
        hub = _make_mock_ws_hub()
        hub.send_rpc.return_value = {"entries": []}

        await send_host_fs_rpc(
            hub,
            uuid.uuid4(),
            method="list_dir",
            workspace_id=uuid.uuid4(),
            args={"path": "/x"},
            timeout=5.0,
        )

        call = hub.send_rpc.await_args
        assert call.kwargs["timeout"] == 5.0

    async def test_method_already_prefixed_not_double_prefixed(self) -> None:
        """If the caller already passes ``host_fs.foo``, do not prefix again."""
        hub = _make_mock_ws_hub()
        hub.send_rpc.return_value = {}

        await send_host_fs_rpc(
            hub,
            uuid.uuid4(),
            method="host_fs.stat",
            workspace_id=uuid.uuid4(),
            args={"path": "/x"},
        )

        call = hub.send_rpc.await_args
        assert call.kwargs["method"] == "host_fs.stat"

    async def test_workspace_id_serialized_as_string(self) -> None:
        """workspace_id uuid is stringified in params (envelope contract)."""
        hub = _make_mock_ws_hub()
        hub.send_rpc.return_value = {}

        wid = uuid.uuid4()
        await send_host_fs_rpc(
            hub,
            uuid.uuid4(),
            method="stat",
            workspace_id=wid,
            args={"path": "/x"},
        )

        params = hub.send_rpc.await_args.kwargs["params"]
        assert params["workspace_id"] == str(wid)
        assert isinstance(params["workspace_id"], str)


# ── timeout path ─────────────────────────────────────────────────────────────


class TestSendHostFsRpcTimeout:
    async def test_timeout_propagates_verbatim(self) -> None:
        hub = _make_mock_ws_hub()
        hub.send_rpc.side_effect = DaemonRpcTimeout(
            "timed out",
            details={"rpc_id": "r1"},
        )

        with pytest.raises(DaemonRpcTimeout):
            await send_host_fs_rpc(
                hub,
                uuid.uuid4(),
                method="git_apply",
                workspace_id=uuid.uuid4(),
                args={"patch_data": "...", "use_3way": False},
            )

        # Wrapper must not swallow / re-wrap — task-04 owns the D-006 downgrade.
        hub.send_rpc.assert_awaited_once()

    async def test_default_timeout_is_30s_not_10s(self) -> None:
        """The wrapper MUST forward 30s, not the ws_hub 10s default (D-006)."""
        hub = _make_mock_ws_hub()
        hub.send_rpc.side_effect = DaemonRpcTimeout("x", details={})

        with pytest.raises(DaemonRpcTimeout):
            await send_host_fs_rpc(
                hub,
                uuid.uuid4(),
                method="stat",
                workspace_id=uuid.uuid4(),
                args={"path": "/x"},
            )

        assert hub.send_rpc.await_args.kwargs["timeout"] == 30.0


# ── offline path ─────────────────────────────────────────────────────────────


class TestSendHostFsRpcOffline:
    async def test_offline_propagates_verbatim(self) -> None:
        hub = _make_mock_ws_hub()
        hub.send_rpc.side_effect = DaemonRuntimeOffline(
            "daemon offline",
            details={"daemon_id": "d1"},
        )

        with pytest.raises(DaemonRuntimeOffline):
            await send_host_fs_rpc(
                hub,
                uuid.uuid4(),
                method="read_file",
                workspace_id=uuid.uuid4(),
                args={"path": "/x"},
            )

        hub.send_rpc.assert_awaited_once()


# ── remote error path ────────────────────────────────────────────────────────


class TestSendHostFsRpcRemoteError:
    async def test_remote_error_propagates_with_code_and_message(self) -> None:
        hub = _make_mock_ws_hub()
        original = DaemonRpcRemoteError(
            {"code": "forbidden", "message": "path outside allowed_roots"}
        )
        hub.send_rpc.side_effect = original

        with pytest.raises(DaemonRpcRemoteError) as exc_info:
            await send_host_fs_rpc(
                hub,
                uuid.uuid4(),
                method="stat",
                workspace_id=uuid.uuid4(),
                args={"path": "/x"},
            )

        # Same instance, not re-wrapped — caller sees daemon's code/message.
        assert exc_info.value is original
        assert exc_info.value.code == "forbidden"
        assert exc_info.value.message == "path outside allowed_roots"

    async def test_internal_remote_error_propagates(self) -> None:
        hub = _make_mock_ws_hub()
        hub.send_rpc.side_effect = DaemonRpcRemoteError(
            {"code": "internal", "message": "git apply failed"}
        )

        with pytest.raises(DaemonRpcRemoteError) as exc_info:
            await send_host_fs_rpc(
                hub,
                uuid.uuid4(),
                method="git_apply",
                workspace_id=uuid.uuid4(),
                args={"patch_data": "...", "use_3way": True},
            )

        assert exc_info.value.code == "internal"


# ── integration with a real DaemonWsHub (envelope shape end-to-end) ──────────


class TestSendHostFsRpcRealHubEnvelope:
    """Drive a real DaemonWsHub instance + mock WebSocket to verify the
    envelope actually shipped over the wire matches what task-03's daemon
    handler will consume (method prefix, params nesting, rpc_id uuid4).
    """

    async def test_envelope_shape_over_real_hub(self) -> None:
        from app.modules.daemon.protocol import DAEMON_MSG_RPC
        from app.modules.daemon.ws_hub import DaemonWsHub

        hub = DaemonWsHub()
        daemon_id = uuid.uuid4()
        workspace_id = uuid.uuid4()

        ws = AsyncMock()
        ws.sent_messages = []
        ws.close = AsyncMock()

        async def _send_json(message: dict[str, Any]) -> None:
            ws.sent_messages.append(message)
            if message.get("type") == DAEMON_MSG_RPC:
                payload = message.get("payload") or {}
                rpc_id = payload.get("rpc_id")
                # Echo back a success result on the next tick.
                loop = asyncio.get_running_loop()
                loop.call_later(
                    0,
                    lambda: asyncio.ensure_future(
                        hub.resolve_rpc(
                            rpc_id,
                            {"rpc_id": rpc_id, "result": {"ok": True}},
                        )
                    ),
                )

        ws.send_json = AsyncMock(side_effect=_send_json)
        await hub.connect(daemon_id, ws)

        result = await send_host_fs_rpc(
            hub,
            daemon_id,
            method="git_apply",
            workspace_id=workspace_id,
            args={"patch_data": "PATCH", "use_3way": False},
        )

        assert result == {"ok": True}

        # Verify the wire envelope — what task-03's handler will receive.
        rpc_msgs = [m for m in ws.sent_messages if m.get("type") == DAEMON_MSG_RPC]
        assert len(rpc_msgs) == 1
        payload = rpc_msgs[0]["payload"]
        # method carries the host_fs. namespace prefix.
        assert payload["method"] == "host_fs.git_apply"
        # workspace_id + args packed into params (envelope-nested form).
        assert payload["params"] == {
            "workspace_id": str(workspace_id),
            "patch_data": "PATCH",
            "use_3way": False,
        }
        # rpc_id is a uuid4 string (collision-free correlation key).
        uuid.UUID(payload["rpc_id"])  # raises ValueError if malformed
