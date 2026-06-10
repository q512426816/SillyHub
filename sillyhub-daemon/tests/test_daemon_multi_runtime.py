"""Tests for multi-runtime registration loop (task-07).

Covers:
  - daemon.start() iterates detected agents and registers each available one
  - runtime_id format: {base_runtime_id}--{agent_name}
  - provider, version, protocol, capabilities per agent
  - no agents detected => no registrations, daemon starts normally
  - single registration failure does not block other agents
  - HubClient.register() with explicit runtime_id / protocol params
  - HubClient.register() backward compat (no runtime_id in body)
"""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from sillyhub_daemon.agent_detector import DetectedAgent
from sillyhub_daemon.client import HubClient
from sillyhub_daemon.config import DaemonConfig
from sillyhub_daemon.daemon import Daemon


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_config(runtime_id: str = "rt-base-001") -> DaemonConfig:
    """Create a DaemonConfig with a fixed runtime_id and no file I/O."""
    cfg = MagicMock(spec=DaemonConfig)
    cfg.runtime_id = runtime_id
    cfg.server_url = "http://localhost:8000"
    cfg.heartbeat_interval = 9999  # large so heartbeat loop doesn't fire
    cfg.poll_interval = 9999
    return cfg


def _make_client() -> HubClient:
    """Create a HubClient with mocked HTTP transport."""
    client = HubClient("http://localhost:8000")
    client._http = MagicMock()
    # Make aclose a no-op async
    client._http.aclose = AsyncMock()
    return client


def _agent(
    name: str,
    available: bool = True,
    version: str | None = "1.2.3",
    protocol: str = "stream_json",
    bin_path: str = "/usr/bin/agent",
) -> DetectedAgent:
    return DetectedAgent(
        name=name,
        bin_path=bin_path if available else "",
        version=version,
        protocol=protocol,
        available=available,
        version_warning=None,
    )


# ---------------------------------------------------------------------------
# Test: daemon registers each available agent
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_daemon_registers_each_available_agent():
    """detect_all returns 3 agents (2 available + 1 unavailable).

    client.register() must be called exactly twice with correct parameters.
    """
    agents = [
        _agent("claude", version="2.0.1", protocol="stream_json"),
        _agent("codex", version="0.120.0", protocol="json_rpc"),
        _agent("copilot", available=False),
    ]

    config = _make_config()
    client = _make_client()

    # Mock the HTTP response for register
    mock_resp = MagicMock()
    mock_resp.json.return_value = {"status": "ok"}
    mock_resp.raise_for_status = MagicMock()
    client._http.post = AsyncMock(return_value=mock_resp)

    # Mock detect_all
    with patch(
        "sillyhub_daemon.daemon.AgentDetector.detect_all",
        return_value=agents,
    ):
        daemon = Daemon(config, client)

        # Don't let background loops run — stop immediately after start
        async def _quick_stop():
            await asyncio.sleep(0)
            await daemon.stop()

        await asyncio.gather(daemon.start(), _quick_stop())

    # register should have been called twice (claude + codex)
    assert client._http.post.call_count == 2

    # Extract the bodies
    bodies = [call.kwargs["json"] for call in client._http.post.call_args_list]

    providers = {b["provider"] for b in bodies}
    assert providers == {"claude", "codex"}

    # Verify runtime_id format
    rt_ids = {b["runtime_id"] for b in bodies}
    assert rt_ids == {"rt-base-001--claude", "rt-base-001--codex"}


# ---------------------------------------------------------------------------
# Test: runtime_id format
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_daemon_runtime_id_format():
    """Each registered agent gets runtime_id = {base}--{agent_name}."""
    agents = [
        _agent("claude", version="3.0.0"),
        _agent("gemini", version="1.0.0"),
    ]

    config = _make_config(runtime_id="rt-abc")
    client = _make_client()

    mock_resp = MagicMock()
    mock_resp.json.return_value = {"status": "ok"}
    mock_resp.raise_for_status = MagicMock()
    client._http.post = AsyncMock(return_value=mock_resp)

    with patch(
        "sillyhub_daemon.daemon.AgentDetector.detect_all",
        return_value=agents,
    ):
        daemon = Daemon(config, client)

        async def _quick_stop():
            await asyncio.sleep(0)
            await daemon.stop()

        await asyncio.gather(daemon.start(), _quick_stop())

    bodies = [call.kwargs["json"] for call in client._http.post.call_args_list]

    expected_ids = {"rt-abc--claude", "rt-abc--gemini"}
    actual_ids = {b["runtime_id"] for b in bodies}
    assert actual_ids == expected_ids


# ---------------------------------------------------------------------------
# Test: no agents detected
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_daemon_no_agents_detected():
    """When detect_all returns no available agents, register is never called
    and the daemon does not crash."""
    agents = [
        _agent("claude", available=False),
        _agent("codex", available=False),
    ]

    config = _make_config()
    client = _make_client()
    client._http.post = AsyncMock()

    with patch(
        "sillyhub_daemon.daemon.AgentDetector.detect_all",
        return_value=agents,
    ):
        daemon = Daemon(config, client)

        async def _quick_stop():
            await asyncio.sleep(0)
            await daemon.stop()

        await asyncio.gather(daemon.start(), _quick_stop())

    # No registration calls
    assert client._http.post.call_count == 0


# ---------------------------------------------------------------------------
# Test: single registration failure continues
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_daemon_single_registration_failure_continues():
    """If the first agent's register() raises, the second agent is still
    registered."""
    agents = [
        _agent("claude", version="2.0.0"),
        _agent("codex", version="0.100.0"),
    ]

    config = _make_config()
    client = _make_client()

    # First call raises, second succeeds
    mock_resp = MagicMock()
    mock_resp.json.return_value = {"status": "ok"}
    mock_resp.raise_for_status = MagicMock()

    call_count = 0

    async def _post_side_effect(*args, **kwargs):
        nonlocal call_count
        call_count += 1
        if call_count == 1:
            raise Exception("network error")
        return mock_resp

    client._http.post = AsyncMock(side_effect=_post_side_effect)

    with patch(
        "sillyhub_daemon.daemon.AgentDetector.detect_all",
        return_value=agents,
    ):
        daemon = Daemon(config, client)

        async def _quick_stop():
            await asyncio.sleep(0)
            await daemon.stop()

        await asyncio.gather(daemon.start(), _quick_stop())

    # register was attempted twice (one failed, one succeeded)
    assert client._http.post.call_count == 2

    # The second call should be for codex
    second_body = client._http.post.call_args_list[1].kwargs["json"]
    assert second_body["provider"] == "codex"


# ---------------------------------------------------------------------------
# Test: capabilities include provider, version, protocol, bin_path
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_daemon_registers_with_capabilities():
    """capabilities dict must contain provider, version, protocol, bin_path."""
    agents = [
        _agent(
            "claude",
            version="2.5.0",
            protocol="stream_json",
            bin_path="/usr/local/bin/claude",
        ),
    ]

    config = _make_config()
    client = _make_client()

    mock_resp = MagicMock()
    mock_resp.json.return_value = {"status": "ok"}
    mock_resp.raise_for_status = MagicMock()
    client._http.post = AsyncMock(return_value=mock_resp)

    with patch(
        "sillyhub_daemon.daemon.AgentDetector.detect_all",
        return_value=agents,
    ):
        daemon = Daemon(config, client)

        async def _quick_stop():
            await asyncio.sleep(0)
            await daemon.stop()

        await asyncio.gather(daemon.start(), _quick_stop())

    body = client._http.post.call_args.kwargs["json"]

    caps = body["capabilities"]
    assert caps["provider"] == "claude"
    assert caps["version"] == "2.5.0"
    assert caps["protocol"] == "stream_json"
    assert caps["bin_path"] == "/usr/local/bin/claude"


# ---------------------------------------------------------------------------
# Test: HubClient.register with runtime_id
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_client_register_with_runtime_id():
    """When runtime_id is provided, it appears in the POST body."""
    client = _make_client()

    mock_resp = MagicMock()
    mock_resp.json.return_value = {"status": "ok"}
    mock_resp.raise_for_status = MagicMock()
    client._http.post = AsyncMock(return_value=mock_resp)

    await client.register(
        runtime_id="rt-123",
        name="myhost",
        provider="claude",
        version="2.0.0",
        protocol="stream_json",
        os="linux",
        arch="x86_64",
    )

    body = client._http.post.call_args.kwargs["json"]
    assert body["runtime_id"] == "rt-123"
    assert body["provider"] == "claude"
    assert body["protocol"] == "stream_json"


# ---------------------------------------------------------------------------
# Test: HubClient.register without runtime_id (backward compat)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_client_register_without_runtime_id():
    """When runtime_id is not provided, it must NOT appear in the POST body."""
    client = _make_client()

    mock_resp = MagicMock()
    mock_resp.json.return_value = {"status": "ok"}
    mock_resp.raise_for_status = MagicMock()
    client._http.post = AsyncMock(return_value=mock_resp)

    await client.register(
        name="myhost",
        provider="claude",
        version="2.0.0",
        os="linux",
        arch="x86_64",
    )

    body = client._http.post.call_args.kwargs["json"]
    assert "runtime_id" not in body


# ---------------------------------------------------------------------------
# Test: HubClient.register with protocol
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_client_register_with_protocol():
    """When protocol is provided and non-empty, it appears in the POST body."""
    client = _make_client()

    mock_resp = MagicMock()
    mock_resp.json.return_value = {"status": "ok"}
    mock_resp.raise_for_status = MagicMock()
    client._http.post = AsyncMock(return_value=mock_resp)

    await client.register(
        runtime_id="rt-456",
        name="myhost",
        provider="codex",
        version="0.120.0",
        protocol="json_rpc",
        os="darwin",
        arch="arm64",
    )

    body = client._http.post.call_args.kwargs["json"]
    assert body["protocol"] == "json_rpc"


# ---------------------------------------------------------------------------
# Test: HubClient.register without protocol (empty string => omit)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_client_register_without_protocol():
    """When protocol is empty string, it should NOT appear in the POST body."""
    client = _make_client()

    mock_resp = MagicMock()
    mock_resp.json.return_value = {"status": "ok"}
    mock_resp.raise_for_status = MagicMock()
    client._http.post = AsyncMock(return_value=mock_resp)

    await client.register(
        name="myhost",
        provider="claude",
        version="2.0.0",
    )

    body = client._http.post.call_args.kwargs["json"]
    assert "protocol" not in body


# ---------------------------------------------------------------------------
# Test: registered_runtimes tracked in daemon
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_daemon_tracks_registered_runtimes():
    """After start(), _registered_runtimes maps agent_name -> runtime_id."""
    agents = [
        _agent("claude", version="2.0.0"),
        _agent("codex", version="0.100.0"),
    ]

    config = _make_config(runtime_id="rt-test")
    client = _make_client()

    mock_resp = MagicMock()
    mock_resp.json.return_value = {"status": "ok"}
    mock_resp.raise_for_status = MagicMock()
    client._http.post = AsyncMock(return_value=mock_resp)

    with patch(
        "sillyhub_daemon.daemon.AgentDetector.detect_all",
        return_value=agents,
    ):
        daemon = Daemon(config, client)

        async def _quick_stop():
            await asyncio.sleep(0)
            await daemon.stop()

        await asyncio.gather(daemon.start(), _quick_stop())

    assert daemon._registered_runtimes == {
        "claude": "rt-test--claude",
        "codex": "rt-test--codex",
    }


# ---------------------------------------------------------------------------
# Test: version fallback to "unknown"
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_daemon_version_unknown_when_null():
    """When agent.version is None, "unknown" is used."""
    agents = [
        _agent("claude", version=None),
    ]

    config = _make_config()
    client = _make_client()

    mock_resp = MagicMock()
    mock_resp.json.return_value = {"status": "ok"}
    mock_resp.raise_for_status = MagicMock()
    client._http.post = AsyncMock(return_value=mock_resp)

    with patch(
        "sillyhub_daemon.daemon.AgentDetector.detect_all",
        return_value=agents,
    ):
        daemon = Daemon(config, client)

        async def _quick_stop():
            await asyncio.sleep(0)
            await daemon.stop()

        await asyncio.gather(daemon.start(), _quick_stop())

    body = client._http.post.call_args.kwargs["json"]
    assert body["version"] == "unknown"
    assert body["capabilities"]["version"] is None
