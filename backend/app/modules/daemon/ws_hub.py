"""WebSocket Hub for daemon runtime connections."""

from __future__ import annotations

import asyncio
import uuid
from collections import deque
from typing import Any

from fastapi import WebSocket

from app.core.logging import get_logger
from app.modules.daemon.protocol import (
    DAEMON_MSG_HEARTBEAT_ACK,
    DAEMON_MSG_PERMISSION_RESPONSE,
    DAEMON_MSG_RPC,
    DAEMON_MSG_SELF_UPDATE,
    DAEMON_MSG_TASK_AVAILABLE,
)
from app.modules.daemon.service import (
    DaemonRpcConflict,
    DaemonRpcRemoteError,
    DaemonRpcTimeout,
    DaemonRuntimeOffline,
)

log = get_logger(__name__)

# Maximum number of unique IDs kept in the sliding dedup window.
_DEDUP_WINDOW_SIZE = 128

# Send timeout in seconds — slow connections are evicted.
_SEND_TIMEOUT = 10.0

# Default RPC round-trip timeout (design §10 R-01). Decoupled from _SEND_TIMEOUT
# so a daemon that accepts the request promptly but stalls mid-work still fails
# the caller within 10s rather than hanging on the WS send path.
RPC_DEFAULT_TIMEOUT = 10.0


class DaemonWsHub:
    """WebSocket connection manager for daemon processes (task-06 / D-006).

    Maintains a registry of active WebSocket connections keyed by
    ``daemon_instance_id`` (one connection per daemon entity, regardless of how
    many providers it fronts). Server→daemon payloads still carry
    ``runtime_id`` to identify the provider session on the daemon side
    (design §5.3); routing is by ``daemon_id`` only.
    """

    def __init__(self) -> None:
        self._connections: dict[uuid.UUID, WebSocket] = {}
        self._lock = asyncio.Lock()
        # Sliding window of recently-sent wakeup IDs for dedup.
        self._dedup_window: deque[str] = deque(maxlen=_DEDUP_WINDOW_SIZE)
        # RPC correlation map: rpc_id → pending future awaiting daemon:rpc_result.
        # The future is resolved with the raw result dict (transparent passthrough
        # of the daemon payload); send_rpc extracts result/error before returning.
        self._pending_rpcs: dict[str, asyncio.Future[Any]] = {}

    # ── Connection lifecycle ──────────────────────────────────────────────────

    async def connect(self, daemon_id: uuid.UUID, ws: WebSocket) -> None:
        """Accept and register a WebSocket connection for a daemon entity.

        If a connection already exists for the given ``daemon_id``, the old one
        is closed before the new one is registered (design §9.3, code=4000
        replaced — same daemon reconnecting evicts the stale socket).
        """
        async with self._lock:
            existing = self._connections.get(daemon_id)
            if existing is not None:
                log.warning(
                    "ws_replacing_existing_connection",
                    daemon_id=str(daemon_id),
                )
                try:
                    await existing.close(code=4000, reason="replaced")
                except Exception:
                    pass

            self._connections[daemon_id] = ws

        log.info(
            "ws_daemon_connected",
            daemon_id=str(daemon_id),
            total_connected=len(self._connections),
        )

    async def disconnect(self, daemon_id: uuid.UUID) -> None:
        """Remove a daemon entity's WebSocket connection."""
        async with self._lock:
            removed = self._connections.pop(daemon_id, None)

        if removed is not None:
            # Cancel any pending RPCs so awaiting send_rpc callers fail fast
            # (DaemonRuntimeOffline) instead of waiting for the full 10s timeout.
            # rpc_id is not bound to daemon_id, so all pending entries are
            # cancelled — this is rare and logged for visibility.
            await self.cancel_all_pending()
            log.info(
                "ws_daemon_disconnected",
                daemon_id=str(daemon_id),
                total_connected=len(self._connections),
            )

    # ── Message sending ───────────────────────────────────────────────────────

    async def send_to_runtime(
        self,
        daemon_id: uuid.UUID,
        message: dict[str, Any],
    ) -> bool:
        """Send a JSON message to the daemon entity owning ``daemon_id``.

        Returns True if the message was sent successfully, False otherwise.
        Evicts slow connections whose send buffer is full.
        """
        ws = self._connections.get(daemon_id)
        if ws is None:
            log.warning("ws_send_no_connection", daemon_id=str(daemon_id))
            return False

        try:
            await asyncio.wait_for(
                ws.send_json(message),
                timeout=_SEND_TIMEOUT,
            )
            return True
        except TimeoutError:
            log.warning(
                "ws_send_timeout_evicting",
                daemon_id=str(daemon_id),
            )
            await self.disconnect(daemon_id)
            return False
        except Exception:
            log.warning(
                "ws_send_failed",
                daemon_id=str(daemon_id),
                exc_info=True,
            )
            await self.disconnect(daemon_id)
            return False

    async def broadcast(
        self,
        message: dict[str, Any],
        *,
        exclude: set[uuid.UUID] | None = None,
    ) -> int:
        """Broadcast a JSON message to all connected daemon entities.

        Returns the number of daemon entities the message was sent to.
        ``exclude`` is a set of daemon_ids to skip.
        """
        exclude = exclude or set()
        targets = [did for did in self._connections if did not in exclude]
        sent = 0
        for did in targets:
            if await self.send_to_runtime(did, message):
                sent += 1
        return sent

    # ── High-level helpers ────────────────────────────────────────────────────

    async def notify_task_available(
        self,
        daemon_id: uuid.UUID,
        task_id: uuid.UUID | None = None,
        lease_id: uuid.UUID | None = None,
        *,
        payload_runtime_id: uuid.UUID | None = None,
    ) -> bool:
        """Send a task_available notification to a specific daemon entity.

        Routing is by ``daemon_id`` (the WS connection key, design §5.3). The
        payload still carries ``runtime_id`` so the daemon can dispatch the wake
        to the correct provider session; ``payload_runtime_id`` defaults to
        ``daemon_id`` when the caller has no provider-level runtime_id to inject
        (keeps legacy hub-level tests green).

        Uses a sliding-window dedup to avoid sending duplicate wakeups for
        the same logical event within a short timeframe.
        """
        # Payload runtime_id (provider session discriminator, design §5.3).
        prid = payload_runtime_id if payload_runtime_id is not None else daemon_id

        # Build a dedup key from the distinguishing identifiers.
        dedup_key = f"{daemon_id}:{task_id}:{lease_id}"

        if dedup_key in self._dedup_window:
            log.debug(
                "ws_wakeup_dedup_skip",
                daemon_id=str(daemon_id),
                dedup_key=dedup_key,
            )
            return True  # Already sent; caller can treat as success.

        self._dedup_window.append(dedup_key)

        message = {
            "type": DAEMON_MSG_TASK_AVAILABLE,
            "payload": {
                "runtime_id": str(prid),
                "task_id": str(task_id) if task_id else None,
                "lease_id": str(lease_id) if lease_id else None,
            },
        }

        result = await self.send_to_runtime(daemon_id, message)
        log.info(
            "ws_task_available_sent",
            daemon_id=str(daemon_id),
            runtime_id=str(prid),
            task_id=str(task_id) if task_id else None,
            success=result,
        )
        return result

    async def send_wakeup(
        self,
        daemon_id: uuid.UUID | str,
        task_id: uuid.UUID | str | None = None,
        lease_id: uuid.UUID | str | None = None,
        *,
        payload_runtime_id: uuid.UUID | str | None = None,
    ) -> bool:
        """Send a wakeup signal to a daemon entity.

        Convenience wrapper around ``notify_task_available`` that accepts
        both ``uuid.UUID`` and ``str`` arguments so callers do not need
        to convert explicitly. ``payload_runtime_id`` (provider session
        discriminator in the payload, design §5.3) is optional and defaults
        to ``daemon_id``.
        """
        did = uuid.UUID(str(daemon_id)) if not isinstance(daemon_id, uuid.UUID) else daemon_id
        tid = (
            uuid.UUID(str(task_id))
            if task_id is not None and not isinstance(task_id, uuid.UUID)
            else task_id
        )
        lid = (
            uuid.UUID(str(lease_id))
            if lease_id is not None and not isinstance(lease_id, uuid.UUID)
            else lease_id
        )
        prid = (
            uuid.UUID(str(payload_runtime_id))
            if payload_runtime_id is not None and not isinstance(payload_runtime_id, uuid.UUID)
            else payload_runtime_id
        )
        return await self.notify_task_available(
            did, task_id=tid, lease_id=lid, payload_runtime_id=prid
        )

    async def send_heartbeat_ack(
        self,
        daemon_id: uuid.UUID,
        pending_operations: dict[str, Any] | None = None,
        *,
        payload_runtime_id: uuid.UUID | None = None,
    ) -> bool:
        """Send a heartbeat_ack message to the daemon entity owning ``daemon_id``.

        The payload carries ``runtime_id`` so the daemon can correlate the ack
        to a provider session (design §5.3); defaults to ``daemon_id`` when
        the caller does not supply a provider-level runtime_id.
        """
        prid = payload_runtime_id if payload_runtime_id is not None else daemon_id
        message = {
            "type": DAEMON_MSG_HEARTBEAT_ACK,
            "payload": {
                "runtime_id": str(prid),
                "pending_operations": pending_operations or {},
            },
        }
        return await self.send_to_runtime(daemon_id, message)

    async def send_session_control(
        self,
        daemon_id: uuid.UUID,
        msg_type: str,
        payload: dict[str, Any],
    ) -> bool:
        """Send an interactive-session control message (task-03 / FR-02/04/05).

        ``msg_type`` is one of ``DAEMON_MSG_SESSION_INJECT`` /
        ``DAEMON_MSG_SESSION_INTERRUPT`` / ``DAEMON_MSG_SESSION_END`` /
        ``DAEMON_MSG_SESSION_RESUME`` and ``payload`` carries the matching
        SessionInjectPayload / SessionControlPayload dict — including the
        provider ``runtime_id`` so the daemon dispatches to the right session
        (design §5.3). Routing is by ``daemon_id``. Internally wraps
        ``send_to_runtime`` so the caller only needs to know whether the
        message was delivered.

        Returns True on successful send, False when the daemon is offline or
        the send timed out / failed (the slow-connection eviction policy is
        inherited from ``send_to_runtime``). The service layer decides the
        convergence policy per call site (create/inject → raise runtime_offline,
        interrupt → raise runtime_offline, end → structured warning only).
        """
        message = {"type": msg_type, "payload": payload}
        return await self.send_to_runtime(daemon_id, message)

    async def send_permission_response(
        self,
        daemon_id: uuid.UUID,
        payload: dict[str, Any],
    ) -> bool:
        """Send a PERMISSION_RESPONSE downlink to the daemon (task-08 / FR-07 / D-007@v1).

        Thin wrapper around ``send_to_runtime`` so the caller (permission_service)
        does not need to assemble the envelope. ``payload`` carries the
        provider ``runtime_id`` for daemon-side session correlation
        (design §5.3); routing is by ``daemon_id``. Returns True on successful
        send, False when the daemon is offline or the send timed out — the
        service layer surfaces this as ``DaemonRuntimeOffline`` (504) and
        relies on the daemon-side fallback timer to fail-closed deny.
        """
        message = {"type": DAEMON_MSG_PERMISSION_RESPONSE, "payload": payload}
        return await self.send_to_runtime(daemon_id, message)

    async def send_self_update(
        self,
        daemon_id: uuid.UUID,
        version: str | None = None,
    ) -> bool:
        """推送 daemon 自更新指令（Server → Daemon）。

        daemon 收到后下载最新 bundle 替换本地文件，然后退出等外部 supervisor 重启。
        """
        payload = {}
        if version:
            payload["version"] = version
        message = {"type": DAEMON_MSG_SELF_UPDATE, "payload": payload}
        return await self.send_to_runtime(daemon_id, message)

    # ── RPC correlation ──────────────────────────────────────────────────────

    async def send_rpc(
        self,
        daemon_id: uuid.UUID,
        method: str,
        params: dict[str, Any],
        *,
        timeout: float = RPC_DEFAULT_TIMEOUT,
    ) -> dict[str, Any]:
        """Send a daemon:rpc request and await the daemon:rpc_result reply.

        Returns the daemon ``result`` dict on success.
        Raises:
            DaemonRuntimeOffline: daemon has no active WS connection or send failed.
            DaemonRpcConflict: rpc_id collision (UUID4 practical impossibility).
            DaemonRpcTimeout: no reply within ``timeout`` seconds (R-01).
            DaemonRpcRemoteError: daemon returned an error dict (caller maps to HTTP).
        """
        rpc_id = str(uuid.uuid4())
        loop = asyncio.get_running_loop()
        future: asyncio.Future[Any] = loop.create_future()

        # 1. Register pending future + connectivity check under the lock.
        async with self._lock:
            if rpc_id in self._pending_rpcs:
                # UUID4 collision — treat as code-defect early signal.
                raise DaemonRpcConflict(
                    f"rpc_id '{rpc_id}' already pending.",
                    details={"rpc_id": rpc_id},
                )
            if not self.is_connected(daemon_id):
                raise DaemonRuntimeOffline(
                    f"daemon '{daemon_id}' is offline (no WS connection).",
                    details={"daemon_id": str(daemon_id)},
                )
            self._pending_rpcs[rpc_id] = future

        # 2. Build and send the daemon:rpc message.
        message = {
            "type": DAEMON_MSG_RPC,
            "payload": {
                "rpc_id": rpc_id,
                "method": method,
                "params": params,
            },
        }
        # send_to_runtime evicts + disconnects on send failure, which in turn
        # triggers cancel_all_pending (clearing our future). We still clean up
        # defensively before raising so the map never holds a dangling entry.
        sent = await self.send_to_runtime(daemon_id, message)
        if not sent:
            await self._cancel_rpc(rpc_id)
            raise DaemonRuntimeOffline(
                f"daemon '{daemon_id}' WS send failed (offline).",
                details={"daemon_id": str(daemon_id), "rpc_id": rpc_id},
            )

        # 3. Await the reply with timeout.
        try:
            result_payload = await asyncio.wait_for(future, timeout=timeout)
        except TimeoutError:
            await self._cancel_rpc(rpc_id)
            raise DaemonRpcTimeout(
                f"daemon rpc '{method}' timed out after {timeout}s.",
                details={
                    "daemon_id": str(daemon_id),
                    "rpc_id": rpc_id,
                    "timeout_seconds": timeout,
                },
            ) from None
        except asyncio.CancelledError:
            # future.cancel() — most likely disconnect → cancel_all_pending.
            # Re-raise as DaemonRuntimeOffline so callers map to 504.
            raise DaemonRuntimeOffline(
                f"daemon '{daemon_id}' disconnected mid-rpc.",
                details={"daemon_id": str(daemon_id), "rpc_id": rpc_id},
            ) from None

        # 4. Unpack result/error.
        if isinstance(result_payload, dict) and result_payload.get("error"):
            raise DaemonRpcRemoteError(result_payload["error"])
        result = result_payload.get("result") if isinstance(result_payload, dict) else None
        if result is None:
            # Malformed daemon reply — treat as gateway failure surface.
            result = {}
        return result

    async def resolve_rpc(self, rpc_id: str, payload: dict[str, Any]) -> None:
        """Resolve a pending RPC future with the daemon's raw result payload.

        Called from the WS receive loop when a ``daemon:rpc_result`` arrives.
        Unknown / already-cancelled rpc_ids are logged and dropped so a late
        reply (arriving after timeout cleanup) cannot crash the WS loop.
        """
        async with self._lock:
            future = self._pending_rpcs.get(rpc_id)
            if future is None:
                log.warning(
                    "ws_rpc_unknown_id",
                    rpc_id=rpc_id,
                    hint="late reply after timeout or duplicate result",
                )
                return
            if future.done():
                log.warning(
                    "ws_rpc_already_resolved",
                    rpc_id=rpc_id,
                )
                return
            future.set_result(payload)
            self._pending_rpcs.pop(rpc_id, None)

    async def _cancel_rpc(self, rpc_id: str) -> None:
        """Cancel and remove a single pending RPC future (if present)."""
        async with self._lock:
            future = self._pending_rpcs.pop(rpc_id, None)
        if future is not None and not future.done():
            future.cancel()

    async def cancel_all_pending(self) -> None:
        """Cancel every pending RPC future (called on daemon disconnect).

        rpc_id is not bound to daemon_id, so we cancel the whole map; this is
        rare and logged for visibility. Awaiters will surface
        DaemonRuntimeOffline via the CancelledError handler in send_rpc.
        """
        async with self._lock:
            items = list(self._pending_rpcs.items())
            self._pending_rpcs.clear()
        for rpc_id, future in items:
            if not future.done():
                log.warning(
                    "ws_rpc_cancelled_on_disconnect",
                    rpc_id=rpc_id,
                )
                future.cancel()

    # ── Query helpers ─────────────────────────────────────────────────────────

    def is_connected(self, daemon_id: uuid.UUID) -> bool:
        """Check if a daemon entity has an active WebSocket connection."""
        return daemon_id in self._connections

    @property
    def connected_count(self) -> int:
        """Return the number of active WebSocket connections (= online daemons)."""
        return len(self._connections)

    @property
    def connected_daemon_ids(self) -> list[uuid.UUID]:
        """Return a list of currently connected daemon_instance_ids."""
        return list(self._connections.keys())

    @property
    def connected_runtime_ids(self) -> list[uuid.UUID]:
        """Deprecated alias kept for transitional callers (placement.py).

        task-06 / design §5.3 renamed the semantics to daemon_instance_id;
        placement.py is adapted in its own task. Returns the connection keys
        (now daemon_ids). New code should use :attr:`connected_daemon_ids`.
        """
        return list(self._connections.keys())


# ── Module-level singleton ───────────────────────────────────────────────────

_ws_hub: DaemonWsHub | None = None


def get_daemon_ws_hub() -> DaemonWsHub:
    """Return (and lazily create) the process-wide DaemonWsHub singleton."""
    global _ws_hub
    if _ws_hub is None:
        _ws_hub = DaemonWsHub()
    return _ws_hub


# Alias — shorter name used by placement and other integration points.
get_ws_hub = get_daemon_ws_hub
