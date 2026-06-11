"""Tests for Daemon core loop: start, stop, heartbeat, poll, WS handling."""

from __future__ import annotations

import asyncio
import json
from contextlib import asynccontextmanager
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from sillyhub_daemon.agent_detector import DetectedAgent
from sillyhub_daemon.client import HubClient
from sillyhub_daemon.config import DaemonConfig
from sillyhub_daemon.daemon import Daemon
from sillyhub_daemon.protocol import (
    MSG_HEARTBEAT_ACK,
    MSG_TASK_AVAILABLE,
)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def mock_config(tmp_path):
    """Create a DaemonConfig with a temp config file."""
    cfg = DaemonConfig(config_path=tmp_path / "config.json")
    # Speed up intervals for testing
    cfg._data["heartbeat_interval"] = 0.05
    cfg._data["poll_interval"] = 0.05
    return cfg


@pytest.fixture
def mock_client():
    """Create a HubClient with mocked HTTP methods."""
    client = HubClient(server_url="http://localhost:8000", token="test-token")
    client._http.aclose = AsyncMock()
    client.register = AsyncMock(return_value={"id": "rt-test-123", "status": "ok"})
    client.heartbeat = AsyncMock(return_value={"status": "ok"})
    client.claim_lease = AsyncMock(return_value={"claim_token": "ct-1"})
    client.start_lease = AsyncMock(return_value={"status": "started"})
    client.complete_lease = AsyncMock(return_value={"status": "ok"})
    client.submit_messages = AsyncMock(return_value={"status": "ok"})
    # Replace close with an AsyncMock so we can assert it was awaited
    client.close = AsyncMock()
    return client


@pytest.fixture
def daemon(mock_config, mock_client):
    """Create a Daemon instance with mocked dependencies."""
    return Daemon(config=mock_config, client=mock_client)


# ---------------------------------------------------------------------------
# __init__
# ---------------------------------------------------------------------------


class TestInit:
    def test_initial_state(self, daemon, mock_config):
        assert daemon.is_running is False
        assert daemon._runtime_id == mock_config.runtime_id
        assert daemon._running is False


# ---------------------------------------------------------------------------
# start
# ---------------------------------------------------------------------------


class TestStart:
    @pytest.mark.asyncio
    async def test_start_sets_running(self, daemon):
        with patch("sillyhub_daemon.daemon.AgentDetector") as MockDetector:
            mock_detector = MockDetector.return_value
            mock_detector.detect_all = AsyncMock(return_value=[])

            task = asyncio.create_task(daemon.start())
            await asyncio.sleep(0.1)

            assert daemon.is_running is True

            await daemon.stop()
            await task

    @pytest.mark.asyncio
    async def test_start_detects_agents(self, daemon, mock_client):
        with patch("sillyhub_daemon.daemon.AgentDetector") as MockDetector:
            mock_detector = MockDetector.return_value
            mock_agents = [
                DetectedAgent(
                    name="claude",
                    bin_path="/usr/bin/claude",
                    version="1.0.0",
                    protocol="stream_json",
                    available=True,
                ),
                DetectedAgent(
                    name="sillyspec",
                    bin_path="",
                    version=None,
                    protocol="ndjson",
                    available=False,
                ),
            ]
            mock_detector.detect_all = AsyncMock(return_value=mock_agents)

            task = asyncio.create_task(daemon.start())
            await asyncio.sleep(0.1)

            mock_detector.detect_all.assert_awaited_once()
            # Only claude is available, so register should have been called once
            mock_client.register.assert_awaited_once()

            await daemon.stop()
            await task

    @pytest.mark.asyncio
    async def test_start_registers(self, daemon, mock_client):
        with patch("sillyhub_daemon.daemon.AgentDetector") as MockDetector:
            mock_detector = MockDetector.return_value
            # One available agent => one register call
            mock_agents = [
                DetectedAgent(
                    name="claude",
                    bin_path="/usr/bin/claude",
                    version="2.0.0",
                    protocol="stream_json",
                    available=True,
                ),
            ]
            mock_detector.detect_all = AsyncMock(return_value=mock_agents)

            task = asyncio.create_task(daemon.start())
            await asyncio.sleep(0.1)

            mock_client.register.assert_awaited_once()

            await daemon.stop()
            await task

    @pytest.mark.asyncio
    async def test_start_continues_if_register_fails(self, daemon, mock_client):
        mock_client.register.side_effect = Exception("server unreachable")

        with patch("sillyhub_daemon.daemon.AgentDetector") as MockDetector:
            mock_detector = MockDetector.return_value
            mock_agents = [
                DetectedAgent(
                    name="claude",
                    bin_path="/usr/bin/claude",
                    version="2.0.0",
                    protocol="stream_json",
                    available=True,
                ),
            ]
            mock_detector.detect_all = AsyncMock(return_value=mock_agents)

            task = asyncio.create_task(daemon.start())
            await asyncio.sleep(0.1)

            # Daemon should still be running despite register failure
            assert daemon.is_running is True

            await daemon.stop()
            await task


# ---------------------------------------------------------------------------
# stop
# ---------------------------------------------------------------------------


class TestStop:
    @pytest.mark.asyncio
    async def test_stop_clears_running(self, daemon):
        daemon._running = True
        daemon._fire(asyncio.sleep(100))

        await daemon.stop()

        assert daemon.is_running is False

    @pytest.mark.asyncio
    async def test_stop_closes_client(self, daemon, mock_client):
        daemon._running = True

        await daemon.stop()

        mock_client.close.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_stop_cancels_tasks(self, daemon):
        daemon._running = True

        async def long_task():
            await asyncio.sleep(1000)

        daemon._fire(long_task())
        assert len(daemon._tasks) == 1

        await daemon.stop()

        assert len(daemon._tasks) == 0


# ---------------------------------------------------------------------------
# _fire
# ---------------------------------------------------------------------------


class TestFire:
    @pytest.mark.asyncio
    async def test_fire_creates_task(self, daemon):
        task = daemon._fire(asyncio.sleep(0.01))
        assert isinstance(task, asyncio.Task)
        assert task in daemon._tasks

        await asyncio.sleep(0.05)
        # Task auto-removed after completion via done-callback
        assert task not in daemon._tasks


# ---------------------------------------------------------------------------
# _heartbeat_loop
# ---------------------------------------------------------------------------


class TestHeartbeatLoop:
    @pytest.mark.asyncio
    async def test_heartbeat_called_periodically(self, daemon, mock_client):
        daemon._running = True
        daemon._registered_runtimes = {"claude": "rt-claude"}

        task = asyncio.create_task(daemon._heartbeat_loop())
        await asyncio.sleep(0.2)

        daemon._running = False
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass

        assert mock_client.heartbeat.call_count >= 1
        mock_client.heartbeat.assert_any_await("rt-claude")

    @pytest.mark.asyncio
    async def test_heartbeat_only_uses_registered_runtimes(self, daemon, mock_client):
        daemon._running = True
        daemon._runtime_id = "config-runtime"
        daemon._registered_runtimes = {
            "claude": "rt-claude",
            "codex": "rt-codex",
        }

        task = asyncio.create_task(daemon._heartbeat_loop())
        await asyncio.sleep(0.08)

        daemon._running = False
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass

        heartbeat_ids = [call.args[0] for call in mock_client.heartbeat.await_args_list]
        assert "rt-claude" in heartbeat_ids
        assert "rt-codex" in heartbeat_ids
        assert "config-runtime" not in heartbeat_ids

    @pytest.mark.asyncio
    async def test_heartbeat_survives_errors(self, daemon, mock_client):
        daemon._running = True
        daemon._registered_runtimes = {"claude": "rt-claude"}
        call_count = 0

        async def failing_heartbeat(runtime_id):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                raise ConnectionError("network error")
            return {"status": "ok"}

        mock_client.heartbeat.side_effect = failing_heartbeat

        task = asyncio.create_task(daemon._heartbeat_loop())
        await asyncio.sleep(0.3)

        daemon._running = False
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass

        # Should have retried after initial failure
        assert call_count >= 2


# ---------------------------------------------------------------------------
# _poll_loop
# ---------------------------------------------------------------------------


class TestPollLoop:
    @pytest.mark.asyncio
    async def test_poll_loop_runs(self, daemon):
        daemon._running = True

        task = asyncio.create_task(daemon._poll_loop())
        await asyncio.sleep(0.2)

        daemon._running = False
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass

        # Reached here without error


# ---------------------------------------------------------------------------
# _handle_ws_message
# ---------------------------------------------------------------------------


class TestHandleWsMessage:
    @pytest.mark.asyncio
    async def test_task_available_message(self, daemon):
        msg = {
            "type": MSG_TASK_AVAILABLE,
            "payload": {"task_id": "t-1", "lease_id": "l-1"},
        }
        await daemon._handle_ws_message(msg)

    @pytest.mark.asyncio
    async def test_heartbeat_ack_message(self, daemon):
        msg = {
            "type": MSG_HEARTBEAT_ACK,
            "payload": {"runtime_id": "rt-1"},
        }
        await daemon._handle_ws_message(msg)

    @pytest.mark.asyncio
    async def test_unknown_message_type(self, daemon):
        msg = {"type": "unknown:type", "payload": {}}
        await daemon._handle_ws_message(msg)


# ---------------------------------------------------------------------------
# _execute_task (daemon → TaskRunner pipeline)
# ---------------------------------------------------------------------------


class TestExecuteTask:
    @pytest.mark.asyncio
    async def test_full_pipeline(self, daemon, mock_client):
        """task_available → claim → start → execute → complete."""
        from sillyhub_daemon.task_runner import TaskResult

        mock_runner = AsyncMock()
        mock_runner.execute_task.return_value = TaskResult(
            success=True, output="done", patch="", duration_ms=100
        )
        daemon._task_runner = mock_runner

        mock_client.claim_lease.return_value = {
            "claim_token": "ct-1",
            "lease_id": "l-1",
            "prompt": "hello",
        }
        mock_client.start_lease.return_value = {"status": "started"}
        mock_client.complete_lease.return_value = {"status": "ok"}

        payload = {"lease_id": "l-1", "runtime_id": "rt-1"}
        await daemon._execute_task(payload)

        mock_client.claim_lease.assert_awaited_once_with(
            lease_id="l-1", runtime_id="rt-1"
        )
        mock_client.start_lease.assert_awaited_once_with(
            lease_id="l-1", claim_token="ct-1"
        )
        mock_runner.execute_task.assert_awaited_once_with(
            lease_id="l-1",
            claim_token="ct-1",
            payload={"claim_token": "ct-1", "lease_id": "l-1", "prompt": "hello"},
        )
        mock_client.complete_lease.assert_awaited_once()
        call_kwargs = mock_client.complete_lease.call_args
        assert call_kwargs.kwargs["lease_id"] == "l-1"
        assert call_kwargs.kwargs["claim_token"] == "ct-1"
        assert call_kwargs.kwargs["result"]["success"] is True

    @pytest.mark.asyncio
    async def test_no_lease_id_logs_warning(self, daemon):
        """Payload without lease_id → early return, no crash."""
        mock_runner = AsyncMock()
        daemon._task_runner = mock_runner
        await daemon._execute_task({"runtime_id": "rt-1"})
        mock_runner.execute_task.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_claim_failure_aborts(self, daemon, mock_client):
        """claim_lease raises → no start/execute/complete."""
        mock_runner = AsyncMock()
        daemon._task_runner = mock_runner
        mock_client.claim_lease.side_effect = ConnectionError("fail")

        await daemon._execute_task({"lease_id": "l-1"})
        mock_client.start_lease.assert_not_awaited()
        mock_runner.execute_task.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_start_failure_aborts(self, daemon, mock_client):
        """start_lease raises → no execute/complete."""
        mock_runner = AsyncMock()
        daemon._task_runner = mock_runner
        mock_client.claim_lease.return_value = {"claim_token": "ct-1"}
        mock_client.start_lease.side_effect = ConnectionError("fail")

        await daemon._execute_task({"lease_id": "l-1"})
        mock_runner.execute_task.assert_not_awaited()
        mock_client.complete_lease.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_complete_failure_logged(self, daemon, mock_client):
        """complete_lease raises → logged but no crash."""
        from sillyhub_daemon.task_runner import TaskResult

        mock_runner = AsyncMock()
        mock_runner.execute_task.return_value = TaskResult(success=True, output="ok")
        daemon._task_runner = mock_runner
        mock_client.claim_lease.return_value = {"claim_token": "ct-1"}
        mock_client.start_lease.return_value = {"status": "started"}
        mock_client.complete_lease.side_effect = ConnectionError("fail")

        # Should not raise
        await daemon._execute_task({"lease_id": "l-1"})


# ---------------------------------------------------------------------------
# _ws_loop
# ---------------------------------------------------------------------------


def _make_mock_ws_context(messages: list[str] | None = None):
    """Build an async context manager that yields a mock WebSocket.

    The yielded object supports ``async for msg in ws`` and returns
    *messages* one by one.  If *messages* is ``None`` the WebSocket
    raises ``ConnectionError`` immediately.
    """
    mock_ws = MagicMock()

    if messages is not None:

        async def _aiter():
            for m in messages:
                yield m

        mock_ws.__aiter__ = _aiter

    @asynccontextmanager
    async def _ctx(*args, **kwargs):
        if messages is None:
            raise ConnectionError("refused")
        yield mock_ws

    return _ctx, mock_ws


class TestWsLoop:
    @pytest.mark.asyncio
    async def test_ws_connects_and_receives_messages(self, daemon):
        daemon._running = True

        test_msg = json.dumps(
            {
                "type": MSG_HEARTBEAT_ACK,
                "payload": {"runtime_id": daemon._runtime_id},
            }
        )

        ctx, _ = _make_mock_ws_context(messages=[test_msg])

        with patch("sillyhub_daemon.daemon.websockets.connect", side_effect=ctx):
            task = asyncio.create_task(daemon._ws_loop())
            await asyncio.sleep(0.2)

            daemon._running = False
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass

    @pytest.mark.asyncio
    async def test_ws_reconnects_on_failure(self, daemon):
        daemon._running = True
        connect_count = 0

        class ConnectMock:
            """Fails first two attempts, then succeeds."""

            async def __aenter__(self):
                nonlocal connect_count
                connect_count += 1
                if connect_count <= 2:
                    raise ConnectionError("refused")
                # Third+ attempt: yield a message, then stop the daemon
                return _BlockingWs(daemon)

            async def __aexit__(self, *args):
                pass

        class _BlockingWs:
            """Mock WebSocket that yields one message then blocks."""

            def __init__(self, daemon_ref):
                self._daemon = daemon_ref

            async def __aiter__(self):
                # Yield one message so _handle_ws_message is called
                yield json.dumps({"type": "daemon:heartbeat_ack", "payload": {}})
                # Now stop the daemon so the while loop exits naturally
                self._daemon._running = False

        # Patch the reconnect sleep (5 s) to be instant in _ws_loop.
        real_sleep = asyncio.sleep

        async def _fast_sleep(delay, **kwargs):
            if delay >= 5:
                await real_sleep(0)  # just yield control
            else:
                await real_sleep(delay)

        with (
            patch(
                "sillyhub_daemon.daemon.websockets.connect", return_value=ConnectMock()
            ),
            patch("sillyhub_daemon.daemon.asyncio.sleep", side_effect=_fast_sleep),
        ):
            # _ws_loop should exit on its own once _running is False
            await daemon._ws_loop()

        assert connect_count >= 2


# ---------------------------------------------------------------------------
# _build_ws_url
# ---------------------------------------------------------------------------


class TestBuildWsUrl:
    def test_builds_ws_url_from_http_server_url(self, daemon):
        url = daemon._build_ws_url()
        assert "ws://" in url
        assert "/api/daemon/ws" in url
        assert f"runtime_id={daemon._runtime_id}" in url

    def test_builds_wss_url_from_https_server_url(self, mock_config, mock_client):
        mock_config._data["server_url"] = "https://example.com:8443"
        d = Daemon(config=mock_config, client=mock_client)
        url = d._build_ws_url()
        assert url.startswith("wss://example.com:8443/api/daemon/ws")

    def test_handles_bare_host(self, mock_config, mock_client):
        mock_config._data["server_url"] = "myhost:9000"
        d = Daemon(config=mock_config, client=mock_client)
        url = d._build_ws_url()
        assert url.startswith("ws://myhost:9000/api/daemon/ws")
