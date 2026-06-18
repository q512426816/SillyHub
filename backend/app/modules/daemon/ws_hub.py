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
    DAEMON_MSG_RPC,
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
    """WebSocket connection manager for daemon runtimes.

    Maintains a registry of active WebSocket connections keyed by runtime_id.
    Supports broadcasting task_available notifications and per-runtime
    message sending with dedup protection and slow-connection eviction.
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

    async def connect(self, runtime_id: uuid.UUID, ws: WebSocket) -> None:
        """Accept and register a WebSocket connection for a daemon runtime.

        If a connection already exists for the given runtime_id, the old one
        is closed before the new one is registered.
        """
        async with self._lock:
            existing = self._connections.get(runtime_id)
            if existing is not None:
                log.warning(
                    "ws_replacing_existing_connection",
                    runtime_id=str(runtime_id),
                )
                try:
                    await existing.close(code=4000, reason="replaced")
                except Exception:
                    pass

            self._connections[runtime_id] = ws

        log.info(
            "ws_daemon_connected",
            runtime_id=str(runtime_id),
            total_connected=len(self._connections),
        )

    async def disconnect(self, runtime_id: uuid.UUID) -> None:
        """Remove a daemon runtime's WebSocket connection."""
        async with self._lock:
            removed = self._connections.pop(runtime_id, None)

        if removed is not None:
            # Cancel any pending RPCs so awaiting send_rpc callers fail fast
            # (DaemonRuntimeOffline) instead of waiting for the full 10s timeout.
            # rpc_id is not bound to runtime_id, so all pending entries are
            # cancelled — this is rare and logged for visibility.
            await self.cancel_all_pending()
            log.info(
                "ws_daemon_disconnected",
                runtime_id=str(runtime_id),
                total_connected=len(self._connections),
            )

    # ── Message sending ───────────────────────────────────────────────────────

    async def send_to_runtime(
        self,
        runtime_id: uuid.UUID,
        message: dict[str, Any],
    ) -> bool:
        """Send a JSON message to a specific runtime.

        Returns True if the message was sent successfully, False otherwise.
        Evicts slow connections whose send buffer is full.
        """
        ws = self._connections.get(runtime_id)
        if ws is None:
            log.warning("ws_send_no_connection", runtime_id=str(runtime_id))
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
                runtime_id=str(runtime_id),
            )
            await self.disconnect(runtime_id)
            return False
        except Exception:
            log.warning(
                "ws_send_failed",
                runtime_id=str(runtime_id),
                exc_info=True,
            )
            await self.disconnect(runtime_id)
            return False

    async def broadcast(
        self,
        message: dict[str, Any],
        *,
        exclude: set[uuid.UUID] | None = None,
    ) -> int:
        """Broadcast a JSON message to all connected runtimes.

        Returns the number of runtimes the message was sent to.
        """
        exclude = exclude or set()
        targets = [rid for rid in self._connections if rid not in exclude]
        sent = 0
        for rid in targets:
            if await self.send_to_runtime(rid, message):
                sent += 1
        return sent

    # ── High-level helpers ────────────────────────────────────────────────────

    async def notify_task_available(
        self,
        runtime_id: uuid.UUID,
        task_id: uuid.UUID | None = None,
        lease_id: uuid.UUID | None = None,
    ) -> bool:
        """Send a task_available notification to a specific runtime.

        Uses a sliding-window dedup to avoid sending duplicate wakeups for
        the same logical event within a short timeframe.
        """
        # Build a dedup key from the distinguishing identifiers.
        dedup_key = f"{runtime_id}:{task_id}:{lease_id}"

        if dedup_key in self._dedup_window:
            log.debug(
                "ws_wakeup_dedup_skip",
                runtime_id=str(runtime_id),
                dedup_key=dedup_key,
            )
            return True  # Already sent; caller can treat as success.

        self._dedup_window.append(dedup_key)

        message = {
            "type": DAEMON_MSG_TASK_AVAILABLE,
            "payload": {
                "runtime_id": str(runtime_id),
                "task_id": str(task_id) if task_id else None,
                "lease_id": str(lease_id) if lease_id else None,
            },
        }

        result = await self.send_to_runtime(runtime_id, message)
        log.info(
            "ws_task_available_sent",
            runtime_id=str(runtime_id),
            task_id=str(task_id) if task_id else None,
            success=result,
        )
        return result

    async def send_wakeup(
        self,
        runtime_id: uuid.UUID | str,
        task_id: uuid.UUID | str | None = None,
        lease_id: uuid.UUID | str | None = None,
    ) -> bool:
        """Send a wakeup signal to a daemon runtime.

        Convenience wrapper around ``notify_task_available`` that accepts
        both ``uuid.UUID`` and ``str`` arguments so callers do not need
        to convert explicitly.
        """
        rid = uuid.UUID(str(runtime_id)) if not isinstance(runtime_id, uuid.UUID) else runtime_id
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
        return await self.notify_task_available(rid, task_id=tid, lease_id=lid)

    async def send_heartbeat_ack(
        self,
        runtime_id: uuid.UUID,
        pending_operations: dict[str, Any] | None = None,
    ) -> bool:
        """Send a heartbeat_ack message to a specific runtime."""
        message = {
            "type": DAEMON_MSG_HEARTBEAT_ACK,
            "payload": {
                "runtime_id": str(runtime_id),
                "pending_operations": pending_operations or {},
            },
        }
        return await self.send_to_runtime(runtime_id, message)

    # ── RPC correlation ──────────────────────────────────────────────────────

    async def send_rpc(
        self,
        runtime_id: uuid.UUID,
        method: str,
        params: dict[str, Any],
        *,
        timeout: float = RPC_DEFAULT_TIMEOUT,
    ) -> dict[str, Any]:
        """Send a daemon:rpc request and await the daemon:rpc_result reply.

        Returns the daemon ``result`` dict on success.
        Raises:
            DaemonRuntimeOffline: runtime has no active WS connection or send failed.
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
            if not self.is_connected(runtime_id):
                raise DaemonRuntimeOffline(
                    f"daemon runtime '{runtime_id}' is offline (no WS connection).",
                    details={"runtime_id": str(runtime_id)},
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
        sent = await self.send_to_runtime(runtime_id, message)
        if not sent:
            await self._cancel_rpc(rpc_id)
            raise DaemonRuntimeOffline(
                f"daemon runtime '{runtime_id}' WS send failed (offline).",
                details={"runtime_id": str(runtime_id), "rpc_id": rpc_id},
            )

        # 3. Await the reply with timeout.
        try:
            result_payload = await asyncio.wait_for(future, timeout=timeout)
        except TimeoutError:
            await self._cancel_rpc(rpc_id)
            raise DaemonRpcTimeout(
                f"daemon rpc '{method}' timed out after {timeout}s.",
                details={
                    "runtime_id": str(runtime_id),
                    "rpc_id": rpc_id,
                    "timeout_seconds": timeout,
                },
            ) from None
        except asyncio.CancelledError:
            # future.cancel() — most likely disconnect → cancel_all_pending.
            # Re-raise as DaemonRuntimeOffline so callers map to 504.
            raise DaemonRuntimeOffline(
                f"daemon runtime '{runtime_id}' disconnected mid-rpc.",
                details={"runtime_id": str(runtime_id), "rpc_id": rpc_id},
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

        rpc_id is not bound to runtime_id, so we cancel the whole map; this is
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

    def is_connected(self, runtime_id: uuid.UUID) -> bool:
        """Check if a runtime has an active WebSocket connection."""
        return runtime_id in self._connections

    @property
    def connected_count(self) -> int:
        """Return the number of active WebSocket connections."""
        return len(self._connections)

    @property
    def connected_runtime_ids(self) -> list[uuid.UUID]:
        """Return a list of currently connected runtime IDs."""
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
