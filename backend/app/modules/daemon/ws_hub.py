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
    DAEMON_MSG_TASK_AVAILABLE,
)

log = get_logger(__name__)

# Maximum number of unique IDs kept in the sliding dedup window.
_DEDUP_WINDOW_SIZE = 128

# Send timeout in seconds — slow connections are evicted.
_SEND_TIMEOUT = 10.0


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
