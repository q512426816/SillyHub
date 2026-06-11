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
from typing import TYPE_CHECKING

import websockets

from sillyhub_daemon.agent_detector import AgentDetector
from sillyhub_daemon.client import HubClient
from sillyhub_daemon.config import DaemonConfig
from sillyhub_daemon.protocol import (
    MSG_HEARTBEAT_ACK,
    MSG_TASK_AVAILABLE,
)

if TYPE_CHECKING:
    from sillyhub_daemon.task_runner import TaskRunner

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

    def __init__(
        self,
        config: DaemonConfig,
        client: HubClient,
        task_runner: TaskRunner | None = None,
    ) -> None:
        self._config = config
        self._client = client
        self._task_runner = task_runner
        self._runtime_id: str = config.runtime_id
        self._running: bool = False
        self._tasks: set[asyncio.Task] = set()
        # Maps agent_name -> runtime_id for each successfully registered agent.
        self._registered_runtimes: dict[str, str] = {}

    # ── Public API ───────────────────────────────────────────────────────────

    async def start(self) -> None:
        """Start daemon: detect agents, register each, begin background loops."""
        self._running = True
        logger.info("daemon.starting runtime_id=%s", self._runtime_id)

        # 1. Detect locally installed agents
        detector = AgentDetector()
        agents = await detector.detect_all()
        available_agents = [a for a in agents if a.available]
        logger.info(
            "daemon.agents_detected agents=%s",
            [a.name for a in available_agents],
        )

        # 2. Register each available agent as an independent runtime
        if not available_agents:
            logger.info("daemon.no_agents_detected")
        else:
            for agent in available_agents:
                try:
                    resp = await self._client.register(
                        name=platform.node(),
                        provider=agent.name,
                        version=agent.version or "unknown",
                        protocol=agent.protocol,
                        os=platform.system().lower(),
                        arch=platform.machine(),
                        capabilities={
                            "provider": agent.name,
                            "version": agent.version,
                            "protocol": agent.protocol,
                            "bin_path": agent.bin_path,
                        },
                    )
                    server_runtime_id = resp.get("id", "")
                    self._registered_runtimes[agent.name] = server_runtime_id
                    logger.info(
                        "daemon.registered provider=%s runtime_id=%s",
                        agent.name,
                        server_runtime_id,
                    )
                except Exception as exc:
                    logger.error(
                        "daemon.register_failed provider=%s error=%s",
                        agent.name,
                        exc,
                    )
                    # Continue registering other agents.

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
        """Send HTTP heartbeat for every registered runtime."""
        while self._running:
            try:
                await asyncio.sleep(self._config.heartbeat_interval)
                for rid in self._registered_runtimes.values():
                    try:
                        await self._client.heartbeat(rid)
                    except Exception as exc:
                        logger.warning(
                            "daemon.heartbeat_failed runtime_id=%s error=%s",
                            rid,
                            exc,
                        )
            except asyncio.CancelledError:
                break

    # ── Poll loop ────────────────────────────────────────────────────────────

    async def _poll_loop(self) -> None:
        """Poll for pending tasks via HTTP as fallback for WS push."""
        while self._running:
            try:
                await asyncio.sleep(self._config.poll_interval)
                if self._task_runner is None:
                    continue
                # Poll each registered runtime for pending leases
                all_ids = list(self._registered_runtimes.values())
                for rid in all_ids:
                    try:
                        pending = await self._client.get_pending_leases(rid)
                        for task in pending:
                            lease_id = task.get("lease_id")
                            if lease_id:
                                logger.info("daemon.poll_task lease_id=%s", lease_id)
                                payload = {
                                    "lease_id": lease_id,
                                    "agent_run_id": task.get("agent_run_id"),
                                    "runtime_id": rid,
                                    "prompt": task.get("prompt", ""),
                                    "provider": task.get("provider", ""),
                                    "cmd_path": task.get("cmd_path", ""),
                                }
                                self._fire(self._execute_task(payload))
                    except Exception as exc:
                        logger.debug(
                            "daemon.poll_runtime_failed rid=%s error=%s", rid, exc
                        )
            except asyncio.CancelledError:
                break
            except Exception as exc:
                logger.warning("daemon.poll_failed error=%s", exc)

    # ── WebSocket loop ───────────────────────────────────────────────────────

    async def _ws_loop(self) -> None:
        """Maintain a WebSocket connection for real-time wake-up signals.

        Uses ``open_timeout`` so the connect call never blocks the event loop
        indefinitely.  If WS is unavailable, the HTTP poll loop still works.
        """
        ws_url = self._build_ws_url()

        while self._running:
            try:
                async with websockets.connect(
                    ws_url,
                    open_timeout=10,
                    close_timeout=5,
                ) as ws:
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
                logger.warning("daemon.ws_connect_failed error=%s", exc)
                if self._running:
                    await asyncio.sleep(10)  # reconnect back-off

    async def _handle_ws_message(self, msg: dict) -> None:
        """Dispatch an incoming WebSocket message by type."""
        msg_type = msg.get("type")
        payload = msg.get("payload", {})

        if msg_type == MSG_TASK_AVAILABLE:
            logger.info("daemon.task_available payload=%s", payload)
            if self._task_runner is None:
                logger.warning("daemon.task_available_no_runner")
                return
            self._fire(self._execute_task(payload))
        elif msg_type == MSG_HEARTBEAT_ACK:
            logger.debug("daemon.heartbeat_ack payload=%s", payload)
        else:
            logger.warning("daemon.unknown_message type=%s", msg_type)

    async def _execute_task(self, payload: dict) -> None:
        """Handle a task_available notification: claim → start → execute → complete."""
        lease_id = payload.get("lease_id")
        runtime_id = payload.get("runtime_id")

        if not lease_id:
            logger.warning("daemon.task_no_lease_id payload=%s", payload)
            return

        # 1. Claim the lease
        try:
            claim_resp = await self._client.claim_lease(
                lease_id=lease_id,
                runtime_id=runtime_id or self._runtime_id,
            )
        except Exception as exc:
            logger.error(
                "daemon.lease_claim_failed lease_id=%s error=%s", lease_id, exc
            )
            return

        claim_token = claim_resp.get("claim_token", "")
        if not claim_token:
            logger.error("daemon.lease_claim_no_token lease_id=%s", lease_id)
            return

        # 2. Start the lease
        try:
            await self._client.start_lease(lease_id=lease_id, claim_token=claim_token)
        except Exception as exc:
            logger.error(
                "daemon.lease_start_failed lease_id=%s error=%s", lease_id, exc
            )
            return

        # 3. Execute via TaskRunner
        # claim_resp structure: {"lease_id", "claim_token", "payload": {...}, "lease_expires_at"}
        exec_payload = claim_resp.get("payload", claim_resp)
        task_result = await self._task_runner.execute_task(
            lease_id=lease_id,
            claim_token=claim_token,
            payload=exec_payload,
        )

        # 4. Complete the lease
        try:
            await self._client.complete_lease(
                lease_id=lease_id,
                claim_token=claim_token,
                result={
                    "success": task_result.success,
                    "output": task_result.output,
                    "error": task_result.error,
                    "patch": task_result.patch,
                    "files_changed": task_result.files_changed,
                    "insertions": task_result.insertions,
                    "deletions": task_result.deletions,
                    "duration_ms": task_result.duration_ms,
                    "session_id": task_result.metadata.get("session_id", ""),
                },
            )
            logger.info(
                "daemon.task_completed lease_id=%s success=%s",
                lease_id,
                task_result.success,
            )
        except Exception as exc:
            logger.error(
                "daemon.lease_complete_failed lease_id=%s error=%s",
                lease_id,
                exc,
            )
