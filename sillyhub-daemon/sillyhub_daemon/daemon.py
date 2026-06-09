"""Core daemon process management.

Implements the Daemon lifecycle as described in design section 3.3:

    Startup → detect agents → register → start WS / heartbeat / poll loops

The WebSocket loop handles real-time wake-up signals from the server.
Heartbeat and poll loops operate as independent ``asyncio`` tasks that
gracefully shut down when ``stop()`` is called.
"""

from __future__ import annotations

import asyncio
import json
import logging
import platform

import websockets

from sillyhub_daemon.agent_detector import AgentDetector
from sillyhub_daemon.client import HubClient
from sillyhub_daemon.config import DaemonConfig
from sillyhub_daemon.protocol import (
    MSG_HEARTBEAT_ACK,
    MSG_TASK_AVAILABLE,
)

logger = logging.getLogger(__name__)


class Daemon:
    """Core daemon loop: register, poll, heartbeat, task dispatch.

    Parameters
    ----------
    config:
        Daemon configuration (server URL, intervals, runtime ID, …).
    client:
        Async HTTP client used to talk to the SillyHub server REST API.
    """

    def __init__(self, config: DaemonConfig, client: HubClient) -> None:
        self._config = config
        self._client = client
        self._runtime_id: str = config.runtime_id
        self._running: bool = False
        self._tasks: set[asyncio.Task] = set()

    # ── Public API ───────────────────────────────────────────────────────────

    async def start(self) -> None:
        """Start daemon: detect agents, register, begin background loops."""
        self._running = True
        logger.info("daemon.starting runtime_id=%s", self._runtime_id)

        # 1. Detect locally installed agents
        detector = AgentDetector()
        agents = await detector.detect_all()
        capabilities = detector.get_capabilities(agents)
        logger.info(
            "daemon.agents_detected agents=%s",
            [a.name for a in agents if a.available],
        )

        # 2. Register with the server
        try:
            result = await self._client.register(
                name=platform.node(),
                provider="claude-code",
                version="0.1.0",
                os=platform.system().lower(),
                arch=platform.machine(),
                capabilities=capabilities,
            )
            logger.info("daemon.registered result=%s", result)
        except Exception as exc:
            logger.error("daemon.register_failed error=%s", exc)
            # Continue anyway — heartbeat loop will keep trying.

        # 3. Launch background loops
        self._fire(self._heartbeat_loop())
        self._fire(self._poll_loop())
        self._fire(self._ws_loop())

        logger.info("daemon.started runtime_id=%s", self._runtime_id)

    async def stop(self) -> None:
        """Gracefully stop all background tasks and close the HTTP client."""
        self._running = False
        logger.info("daemon.stopping")

        for task in self._tasks:
            task.cancel()

        await asyncio.gather(*self._tasks, return_exceptions=True)
        self._tasks.clear()

        await self._client.close()
        logger.info("daemon.stopped")

    @property
    def is_running(self) -> bool:
        """Return ``True`` while the daemon event loop is active."""
        return self._running

    # ── Internal helpers ─────────────────────────────────────────────────────

    def _fire(self, coro) -> asyncio.Task:
        """Create an ``asyncio.Task`` and track it for graceful cancellation."""
        task = asyncio.create_task(coro)
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)
        return task

    def _build_ws_url(self) -> str:
        """Derive the WebSocket URL from the configured HTTP server URL.

        ``http://`` → ``ws://``, ``https://`` → ``wss://``.
        """
        base = self._config.server_url.rstrip("/")
        if base.startswith("https://"):
            ws_base = "wss://" + base[len("https://") :]
        elif base.startswith("http://"):
            ws_base = "ws://" + base[len("http://") :]
        else:
            ws_base = "ws://" + base
        return f"{ws_base}/api/daemon/ws?runtime_id={self._runtime_id}"

    # ── Heartbeat loop ───────────────────────────────────────────────────────

    async def _heartbeat_loop(self) -> None:
        """Send HTTP heartbeat every ``heartbeat_interval`` seconds."""
        while self._running:
            try:
                await asyncio.sleep(self._config.heartbeat_interval)
                result = await self._client.heartbeat(self._runtime_id)
                logger.debug("daemon.heartbeat_sent result=%s", result)
            except asyncio.CancelledError:
                break
            except Exception as exc:
                logger.warning("daemon.heartbeat_failed error=%s", exc)

    # ── Poll loop ────────────────────────────────────────────────────────────

    async def _poll_loop(self) -> None:
        """Poll for pending tasks every ``poll_interval`` seconds.

        Currently a no-op placeholder — the server does not yet expose a
        ``/tasks/pending`` endpoint.  Will be extended once that API lands.
        """
        while self._running:
            try:
                await asyncio.sleep(self._config.poll_interval)
                logger.debug("daemon.poll")
            except asyncio.CancelledError:
                break
            except Exception as exc:
                logger.warning("daemon.poll_failed error=%s", exc)

    # ── WebSocket loop ───────────────────────────────────────────────────────

    async def _ws_loop(self) -> None:
        """Maintain a WebSocket connection for real-time wake-up signals.

        Automatically reconnects with a short delay on disconnection or error.
        """
        ws_url = self._build_ws_url()

        while self._running:
            try:
                async with websockets.connect(ws_url) as ws:
                    logger.info("daemon.ws_connected")
                    async for raw_msg in ws:
                        if not self._running:
                            break
                        try:
                            msg = json.loads(raw_msg)
                            await self._handle_ws_message(msg)
                        except json.JSONDecodeError:
                            logger.warning(
                                "daemon.ws_invalid_message raw=%.200s",
                                raw_msg,
                            )
            except asyncio.CancelledError:
                break
            except Exception as exc:
                logger.warning("daemon.ws_disconnected error=%s", exc)
                if self._running:
                    await asyncio.sleep(5)  # reconnect back-off

    async def _handle_ws_message(self, msg: dict) -> None:
        """Dispatch an incoming WebSocket message by type."""
        msg_type = msg.get("type")
        payload = msg.get("payload", {})

        if msg_type == MSG_TASK_AVAILABLE:
            logger.info("daemon.task_available payload=%s", payload)
            # Task execution will be wired in by TaskRunner (Wave 4).
        elif msg_type == MSG_HEARTBEAT_ACK:
            logger.debug("daemon.heartbeat_ack payload=%s", payload)
        else:
            logger.warning("daemon.unknown_message type=%s", msg_type)
