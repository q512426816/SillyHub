"""Tests for the daemon WS RPC channel + POST /runtimes/{id}/list-dir endpoint.

Covers task-04 of change ``2026-06-18-workspace-client-path``:

* ws_hub.send_rpc — success / timeout / offline / remote-error / rpc_id conflict
* ws_hub correlation invariants — disconnect cancels pending RPCs, late results
  discarded, result/error mapping.
* router POST /runtimes/{runtime_id}/list-dir — 200 / 404 (not owned) / 403
  (forbidden) / 504 (offline) / 504 (timeout) / 502 (other remote error).

ws_hub-level tests use a fresh DaemonWsHub + mock WebSocket (no DB). Endpoint
tests go through the root ``client`` / ``auth_headers`` fixtures from
``backend/conftest.py`` and patch the ws_hub singleton to inject a controlled
hub.
"""

from __future__ import annotations

import asyncio
import uuid
from datetime import UTC, datetime
from typing import Any
from unittest.mock import AsyncMock

import pytest
from httpx import AsyncClient

from app.modules.daemon import ws_hub as ws_hub_module
from app.modules.daemon.model import DaemonRuntime
from app.modules.daemon.protocol import (
    DAEMON_MSG_RPC,
    DAEMON_MSG_RPC_RESULT,
    RpcRequestPayload,
    RpcResultPayload,
)
from app.modules.daemon.service import (
    DaemonRpcConflict,
    DaemonRpcForbiddenError,
    DaemonRpcGatewayError,
    DaemonRpcRemoteError,
    DaemonRpcRemoteGatewayError,
    DaemonRpcTimeout,
    DaemonRuntimeOffline,
)
from app.modules.daemon.ws_hub import DaemonWsHub

# ── Helpers ──────────────────────────────────────────────────────────────────


def _make_mock_ws() -> AsyncMock:
    """Mock WebSocket that records sent JSON messages."""
    ws = AsyncMock()
    ws.sent_messages = []

    async def _send_json(message: dict[str, Any]) -> None:
        ws.sent_messages.append(message)

    ws.send_json = AsyncMock(side_effect=_send_json)
    ws.close = AsyncMock()
    return ws


async def _create_user(session: Any) -> uuid.UUID:
    """Insert a User row so FK constraints on daemon_runtimes are satisfied."""
    from app.modules.auth.model import User

    uid = uuid.uuid4()
    user = User(
        id=uid,
        email=f"rpc-{uid}@example.com",
        password_hash="irrelevant",
        display_name="RPC Tester",
        status="active",
    )
    session.add(user)
    await session.commit()
    return uid


async def _create_runtime(
    session: Any,
    user_id: uuid.UUID,
    *,
    status: str = "online",
) -> DaemonRuntime:
    rt = DaemonRuntime(
        id=uuid.uuid4(),
        user_id=user_id,
        name="rpc-daemon",
        provider="claude_code",
        status=status,
        last_heartbeat_at=datetime.now(UTC),
    )
    session.add(rt)
    await session.commit()
    await session.refresh(rt)
    return rt


async def _admin_user_id(session: Any) -> uuid.UUID:
    """Resolve the platform admin user id created by ``auth_admin_token``.

    The list-dir endpoint calls ``_get_owned_runtime(runtime_id, user.id)``,
    so the runtime must belong to the *authenticated* user — i.e. the admin
    whose JWT the ``auth_headers`` fixture carries.
    """
    from sqlalchemy import select

    from app.modules.auth.model import User

    stmt = select(User).where(User.email == "admin@example.com").limit(1)
    user = (await session.execute(stmt)).scalars().first()
    assert user is not None, "admin user must be created by auth_admin_token first"
    return user.id


# ── Protocol constants ───────────────────────────────────────────────────────


class TestProtocolConstants:
    """Verify the literal strings align with task-05 (daemon protocol.ts)."""

    def test_rpc_constants_match_plan(self) -> None:
        assert DAEMON_MSG_RPC == "daemon:rpc"
        assert DAEMON_MSG_RPC_RESULT == "daemon:rpc_result"

    def test_rpc_payload_models_round_trip(self) -> None:
        req = RpcRequestPayload(rpc_id="r1", method="list_dir", params={"path": "/x"})
        assert req.method == "list_dir"

        res_ok = RpcResultPayload(rpc_id="r1", result={"entries": []})
        assert res_ok.error is None

        res_err = RpcResultPayload(
            rpc_id="r1",
            error={"code": "forbidden", "message": "outside allowed_roots"},
        )
        assert res_err.result is None


# ── ws_hub.send_rpc ──────────────────────────────────────────────────────────


class TestSendRpcSuccess:
    async def test_success_returns_result_and_clears_map(self) -> None:
        hub = DaemonWsHub()
        rid = uuid.uuid4()
        ws = _make_mock_ws()
        await hub.connect(rid, ws)

        async def _responder() -> None:
            # Wait for the daemon:rpc message to land, then echo back the reply.
            while not ws.sent_messages:
                await asyncio.sleep(0.005)
            sent = ws.sent_messages[-1]
            assert sent["type"] == DAEMON_MSG_RPC
            rpc_id = sent["payload"]["rpc_id"]
            assert sent["payload"]["method"] == "list_dir"
            assert sent["payload"]["params"] == {"path": "/etc"}
            await hub.resolve_rpc(
                rpc_id,
                {
                    "rpc_id": rpc_id,
                    "result": {"entries": [{"name": "foo", "type": "dir"}]},
                },
            )

        responder = asyncio.create_task(_responder())
        try:
            result = await hub.send_rpc(rid, "list_dir", {"path": "/etc"}, timeout=2.0)
        finally:
            await responder

        assert result == {"entries": [{"name": "foo", "type": "dir"}]}
        # Map must be cleaned up on the success path.
        assert hub._pending_rpcs == {}


class TestSendRpcOffline:
    async def test_offline_runtime_raises(self) -> None:
        hub = DaemonWsHub()
        rid = uuid.uuid4()
        # No connect() call — runtime is offline.
        with pytest.raises(DaemonRuntimeOffline):
            await hub.send_rpc(rid, "list_dir", {"path": "/x"}, timeout=1.0)
        # Nothing should have been registered.
        assert hub._pending_rpcs == {}

    async def test_send_failure_treated_as_offline(self) -> None:
        hub = DaemonWsHub()
        rid = uuid.uuid4()
        ws = AsyncMock()
        # send_json raises → send_to_runtime evicts + returns False.
        ws.send_json = AsyncMock(side_effect=RuntimeError("connection reset"))
        ws.close = AsyncMock()
        await hub.connect(rid, ws)

        with pytest.raises(DaemonRuntimeOffline):
            await hub.send_rpc(rid, "list_dir", {"path": "/x"}, timeout=1.0)
        # send_to_runtime's disconnect also cancels; the future must be gone.
        assert hub._pending_rpcs == {}
        assert hub.is_connected(rid) is False


class TestSendRpcTimeout:
    async def test_timeout_raises_and_clears_map(self) -> None:
        hub = DaemonWsHub()
        rid = uuid.uuid4()
        ws = _make_mock_ws()
        await hub.connect(rid, ws)

        with pytest.raises(DaemonRpcTimeout):
            await hub.send_rpc(rid, "list_dir", {"path": "/x"}, timeout=0.05)
        assert hub._pending_rpcs == {}

    async def test_late_result_after_timeout_is_discarded(self) -> None:
        hub = DaemonWsHub()
        rid = uuid.uuid4()
        ws = _make_mock_ws()
        await hub.connect(rid, ws)

        with pytest.raises(DaemonRpcTimeout):
            await hub.send_rpc(rid, "list_dir", {"path": "/x"}, timeout=0.05)

        # Daemon finally replies after timeout cleanup — must not raise.
        rpc_id = ws.sent_messages[0]["payload"]["rpc_id"]
        await hub.resolve_rpc(
            rpc_id,
            {"rpc_id": rpc_id, "result": {"entries": []}},
        )
        assert hub._pending_rpcs == {}


class TestSendRpcRemoteError:
    async def test_forbidden_error_carried_up(self) -> None:
        hub = DaemonWsHub()
        rid = uuid.uuid4()
        ws = _make_mock_ws()
        await hub.connect(rid, ws)

        async def _reply() -> None:
            while not ws.sent_messages:
                await asyncio.sleep(0.005)
            rpc_id = ws.sent_messages[-1]["payload"]["rpc_id"]
            await hub.resolve_rpc(
                rpc_id,
                {
                    "rpc_id": rpc_id,
                    "error": {"code": "forbidden", "message": "outside allowed_roots"},
                },
            )

        t = asyncio.create_task(_reply())
        try:
            with pytest.raises(DaemonRpcRemoteError) as exc_info:
                await hub.send_rpc(rid, "list_dir", {"path": "/x"}, timeout=2.0)
        finally:
            await t

        assert exc_info.value.code == "forbidden"
        assert hub._pending_rpcs == {}


class TestSendRpcConflict:
    async def test_rpc_id_collision_raises_conflict(self, monkeypatch: pytest.MonkeyPatch) -> None:
        hub = DaemonWsHub()
        rid = uuid.uuid4()
        ws = _make_mock_ws()
        await hub.connect(rid, ws)

        fixed = uuid.UUID("00000000-0000-0000-0000-000000000001")
        monkeypatch.setattr(ws_hub_module.uuid, "uuid4", lambda: fixed)
        # Pre-register the same rpc_id to simulate the (practically impossible)
        # collision path.
        loop = asyncio.get_running_loop()
        hub._pending_rpcs[str(fixed)] = loop.create_future()

        with pytest.raises(DaemonRpcConflict):
            await hub.send_rpc(rid, "list_dir", {"path": "/x"}, timeout=1.0)


class TestDisconnectCancelsPending:
    async def test_disconnect_cancels_pending_rpc(self) -> None:
        hub = DaemonWsHub()
        rid = uuid.uuid4()
        ws = _make_mock_ws()
        await hub.connect(rid, ws)

        async def _await_rpc() -> Any:
            return await hub.send_rpc(rid, "list_dir", {"path": "/x"}, timeout=2.0)

        task = asyncio.create_task(_await_rpc())
        # Yield so the task registers the pending future and sends the rpc.
        await asyncio.sleep(0.02)
        assert len(hub._pending_rpcs) == 1

        # Disconnect the runtime → cancel_all_pending should fire.
        await hub.disconnect(rid)

        with pytest.raises((DaemonRuntimeOffline, asyncio.CancelledError)):
            await task
        assert hub._pending_rpcs == {}
        assert hub.is_connected(rid) is False


class TestResolveRpcEdgeCases:
    async def test_unknown_rpc_id_silently_dropped(self) -> None:
        hub = DaemonWsHub()
        # No pending future for this rpc_id.
        await hub.resolve_rpc("nope", {"rpc_id": "nope", "result": {}})
        assert hub._pending_rpcs == {}

    async def test_already_done_future_dropped(self) -> None:
        hub = DaemonWsHub()
        loop = asyncio.get_running_loop()
        fut: asyncio.Future[Any] = loop.create_future()
        fut.set_result({"rpc_id": "r1", "result": {}})
        hub._pending_rpcs["r1"] = fut

        await hub.resolve_rpc("r1", {"rpc_id": "r1", "result": {"entries": []}})
        # Already resolved — map untouched (the entry we added manually stays).
        assert "r1" in hub._pending_rpcs


# ── Endpoint: POST /api/daemon/runtimes/{id}/list-dir ────────────────────────


@pytest.fixture()
def fresh_ws_hub(monkeypatch: pytest.MonkeyPatch) -> DaemonWsHub:
    """Replace the process-wide ws_hub singleton with a fresh DaemonWsHub."""
    hub = DaemonWsHub()
    monkeypatch.setattr(ws_hub_module, "_ws_hub", hub)
    return hub


class TestListDirEndpoint:
    """HTTP-level coverage of the list-dir forwarding endpoint."""

    async def test_list_dir_200(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: Any,
        fresh_ws_hub: DaemonWsHub,
    ) -> None:
        uid = await _admin_user_id(db_session)
        rt = await _create_runtime(db_session, uid)

        # Wire a mock ws whose send_json resolves the RPC inline once the
        # daemon:rpc message lands. This mirrors the real daemon→backend
        # reply path (resolve_rpc) without needing a sibling coroutine that
        # would deadlock against the blocking httpx ASGI post call.
        ws = AsyncMock()
        ws.sent_messages = []
        ws.close = AsyncMock()

        async def _send_json(message: dict[str, Any]) -> None:
            ws.sent_messages.append(message)
            if message.get("type") == DAEMON_MSG_RPC:
                payload = message.get("payload") or {}
                rpc_id = payload.get("rpc_id")
                # Defer the reply one tick so send_to_runtime returns True
                # before the future is resolved (matches real network timing).
                loop = asyncio.get_running_loop()
                loop.call_later(
                    0,
                    lambda: asyncio.ensure_future(
                        fresh_ws_hub.resolve_rpc(
                            rpc_id,
                            {
                                "rpc_id": rpc_id,
                                "result": {
                                    "entries": [
                                        {"name": "src", "type": "dir"},
                                        {"name": "README.md", "type": "file"},
                                    ]
                                },
                            },
                        )
                    ),
                )

        ws.send_json = AsyncMock(side_effect=_send_json)
        await fresh_ws_hub.connect(rt.id, ws)

        resp = await client.post(
            f"/api/daemon/runtimes/{rt.id}/list-dir",
            json={"path": "/home"},
            headers=auth_headers,
        )

        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["entries"] == [
            {"name": "src", "type": "dir"},
            {"name": "README.md", "type": "file"},
        ]
        # The rpc message was actually sent over the (mock) ws.
        assert any(m.get("type") == DAEMON_MSG_RPC for m in ws.sent_messages)

    async def test_list_dir_404_not_owned(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: Any,
        fresh_ws_hub: DaemonWsHub,
    ) -> None:
        # Runtime owned by a different user.
        other_uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, other_uid)

        resp = await client.post(
            f"/api/daemon/runtimes/{rt.id}/list-dir",
            json={"path": "/x"},
            headers=auth_headers,
        )
        assert resp.status_code == 404, resp.text
        assert resp.json()["code"] == "HTTP_404_DAEMON_RUNTIME_NOT_FOUND"

    async def test_list_dir_504_offline(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: Any,
        fresh_ws_hub: DaemonWsHub,
    ) -> None:
        uid = await _admin_user_id(db_session)
        rt = await _create_runtime(db_session, uid)
        # No connect() → hub.is_connected False → DaemonRuntimeOffline → 504.

        resp = await client.post(
            f"/api/daemon/runtimes/{rt.id}/list-dir",
            json={"path": "/x"},
            headers=auth_headers,
        )
        assert resp.status_code == 504, resp.text
        assert resp.json()["code"] == "HTTP_504_DAEMON_RPC_GATEWAY"

    async def test_list_dir_504_timeout(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: Any,
        fresh_ws_hub: DaemonWsHub,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        uid = await _admin_user_id(db_session)
        rt = await _create_runtime(db_session, uid)
        ws = _make_mock_ws()
        await fresh_ws_hub.connect(rt.id, ws)
        # Never reply → force a fast timeout.
        monkeypatch.setattr(ws_hub_module, "RPC_DEFAULT_TIMEOUT", 0.05)

        resp = await client.post(
            f"/api/daemon/runtimes/{rt.id}/list-dir",
            json={"path": "/x"},
            headers=auth_headers,
        )
        assert resp.status_code == 504, resp.text
        assert resp.json()["code"] == "HTTP_504_DAEMON_RPC_GATEWAY"

    async def test_list_dir_403_forbidden(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: Any,
        fresh_ws_hub: DaemonWsHub,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        uid = await _admin_user_id(db_session)
        rt = await _create_runtime(db_session, uid)

        async def _raise(
            self,
            runtime_id: uuid.UUID,
            method: str,
            params: dict[str, Any],
            *,
            timeout: float = 1.0,
        ) -> dict[str, Any]:
            raise DaemonRpcRemoteError(
                {"code": "forbidden", "message": "path outside allowed_roots"}
            )

        monkeypatch.setattr(DaemonWsHub, "send_rpc", _raise)

        resp = await client.post(
            f"/api/daemon/runtimes/{rt.id}/list-dir",
            json={"path": "/x"},
            headers=auth_headers,
        )
        assert resp.status_code == 403, resp.text
        assert resp.json()["code"] == "HTTP_403_DAEMON_RPC_FORBIDDEN"

    async def test_list_dir_502_other_remote_error(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: Any,
        fresh_ws_hub: DaemonWsHub,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        uid = await _admin_user_id(db_session)
        rt = await _create_runtime(db_session, uid)

        async def _raise(
            self,
            runtime_id: uuid.UUID,
            method: str,
            params: dict[str, Any],
            *,
            timeout: float = 1.0,
        ) -> dict[str, Any]:
            raise DaemonRpcRemoteError({"code": "internal", "message": "boom"})

        monkeypatch.setattr(DaemonWsHub, "send_rpc", _raise)

        resp = await client.post(
            f"/api/daemon/runtimes/{rt.id}/list-dir",
            json={"path": "/x"},
            headers=auth_headers,
        )
        assert resp.status_code == 502, resp.text
        assert resp.json()["code"] == "HTTP_502_DAEMON_RPC_REMOTE"

    async def test_list_dir_400_empty_path(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: Any,
        fresh_ws_hub: DaemonWsHub,
    ) -> None:
        uid = await _admin_user_id(db_session)
        rt = await _create_runtime(db_session, uid)

        resp = await client.post(
            f"/api/daemon/runtimes/{rt.id}/list-dir",
            json={"path": ""},
            headers=auth_headers,
        )
        assert resp.status_code == 422, resp.text  # FastAPI body validation.


# ── Error-class sanity (smoke) ──────────────────────────────────────────────


class TestRpcErrorClasses:
    """Static checks that the error class HTTP/code attributes match the spec."""

    def test_gateway_error_is_504(self) -> None:
        assert DaemonRpcGatewayError.http_status == 504
        assert DaemonRpcGatewayError.code == "HTTP_504_DAEMON_RPC_GATEWAY"

    def test_forbidden_error_is_403(self) -> None:
        assert DaemonRpcForbiddenError.http_status == 403
        assert DaemonRpcForbiddenError.code == "HTTP_403_DAEMON_RPC_FORBIDDEN"

    def test_remote_gateway_error_is_502(self) -> None:
        assert DaemonRpcRemoteGatewayError.http_status == 502
        assert DaemonRpcRemoteGatewayError.code == "HTTP_502_DAEMON_RPC_REMOTE"

    def test_remote_error_is_internal_signal(self) -> None:
        # DaemonRpcRemoteError is NOT an AppError — it carries a daemon error dict.
        err = DaemonRpcRemoteError({"code": "forbidden", "message": "x"})
        assert err.code == "forbidden"
        assert err.message == "x"
        assert not isinstance(err, DaemonRpcGatewayError)
