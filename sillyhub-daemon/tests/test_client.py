"""Tests for HubClient HTTP daemon API client."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import httpx
import pytest

from sillyhub_daemon.client import HubClient


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def mock_response():
    """Factory to build a mock httpx.Response."""

    def _make(status_code: int = 200, json_data: dict | None = None):
        resp = MagicMock(spec=httpx.Response)
        resp.status_code = status_code
        resp.json.return_value = json_data or {}
        resp.raise_for_status = MagicMock()
        if status_code >= 400:
            resp.raise_for_status.side_effect = httpx.HTTPStatusError(
                message="error",
                request=MagicMock(),
                response=resp,
            )
        return resp

    return _make


@pytest.fixture
def client():
    """Create a HubClient with a mock httpx.AsyncClient."""
    c = HubClient(server_url="http://localhost:8000", token="test-token")
    return c


# ---------------------------------------------------------------------------
# __init__ & auth headers
# ---------------------------------------------------------------------------


class TestInit:
    def test_strips_trailing_slash(self):
        c = HubClient(server_url="http://host/")
        assert c._base_url == "http://host"

    def test_auth_headers_with_token(self):
        c = HubClient(server_url="http://host", token="abc")
        assert c._http.headers.get("Authorization") == "Bearer abc"

    def test_auth_headers_without_token(self):
        c = HubClient(server_url="http://host")
        assert "Authorization" not in c._http.headers


# ---------------------------------------------------------------------------
# close
# ---------------------------------------------------------------------------


class TestClose:
    @pytest.mark.asyncio
    async def test_close_aclose(self, client):
        client._http.aclose = AsyncMock()
        await client.close()
        client._http.aclose.assert_awaited_once()


# ---------------------------------------------------------------------------
# register
# ---------------------------------------------------------------------------


class TestRegister:
    @pytest.mark.asyncio
    async def test_register_success(self, client, mock_response):
        expected = {"runtime_id": "rt-1", "status": "ok"}
        client._http.post = AsyncMock(return_value=mock_response(200, expected))

        result = await client.register(name="test-daemon")

        client._http.post.assert_awaited_once_with(
            "/api/daemon/register",
            json={"name": "test-daemon"},
        )
        assert result == expected

    @pytest.mark.asyncio
    async def test_register_server_error(self, client, mock_response):
        client._http.post = AsyncMock(
            return_value=mock_response(500, {"detail": "internal error"})
        )

        with pytest.raises(httpx.HTTPStatusError):
            await client.register(name="daemon")


# ---------------------------------------------------------------------------
# heartbeat
# ---------------------------------------------------------------------------


class TestHeartbeat:
    @pytest.mark.asyncio
    async def test_heartbeat_success(self, client, mock_response):
        expected = {"status": "ok"}
        client._http.post = AsyncMock(return_value=mock_response(200, expected))

        result = await client.heartbeat("rt-123")

        client._http.post.assert_awaited_once_with(
            "/api/daemon/heartbeat",
            json={"runtime_id": "rt-123"},
        )
        assert result == expected


# ---------------------------------------------------------------------------
# claim_lease
# ---------------------------------------------------------------------------


class TestClaimLease:
    @pytest.mark.asyncio
    async def test_claim_success(self, client, mock_response):
        expected = {"lease_id": "L1", "claim_token": "ct-abc"}
        client._http.post = AsyncMock(return_value=mock_response(200, expected))

        result = await client.claim_lease("L1", "rt-123")

        client._http.post.assert_awaited_once_with(
            "/api/daemon/leases/L1/claim",
            json={"runtime_id": "rt-123"},
        )
        assert result["claim_token"] == "ct-abc"


# ---------------------------------------------------------------------------
# start_lease
# ---------------------------------------------------------------------------


class TestStartLease:
    @pytest.mark.asyncio
    async def test_start_success(self, client, mock_response):
        expected = {"status": "started"}
        client._http.post = AsyncMock(return_value=mock_response(200, expected))

        result = await client.start_lease("L1", "ct-abc")

        client._http.post.assert_awaited_once_with(
            "/api/daemon/leases/L1/start",
            json={"claim_token": "ct-abc"},
        )
        assert result == expected


# ---------------------------------------------------------------------------
# lease_heartbeat
# ---------------------------------------------------------------------------


class TestLeaseHeartbeat:
    @pytest.mark.asyncio
    async def test_lease_heartbeat_success(self, client, mock_response):
        expected = {"status": "renewed"}
        client._http.post = AsyncMock(return_value=mock_response(200, expected))

        result = await client.lease_heartbeat("L1", "ct-abc")

        client._http.post.assert_awaited_once_with(
            "/api/daemon/leases/L1/heartbeat",
            json={"claim_token": "ct-abc"},
        )
        assert result == expected


# ---------------------------------------------------------------------------
# submit_messages
# ---------------------------------------------------------------------------


class TestSubmitMessages:
    @pytest.mark.asyncio
    async def test_submit_success(self, client, mock_response):
        messages = [{"role": "user", "content": "hello"}]
        expected = {"status": "ok"}
        client._http.post = AsyncMock(return_value=mock_response(200, expected))

        result = await client.submit_messages("L1", "ct-abc", "run-1", messages)

        client._http.post.assert_awaited_once_with(
            "/api/daemon/leases/L1/messages",
            json={
                "claim_token": "ct-abc",
                "agent_run_id": "run-1",
                "messages": messages,
            },
        )
        assert result == expected

    @pytest.mark.asyncio
    async def test_submit_empty_messages(self, client, mock_response):
        expected = {"status": "ok"}
        client._http.post = AsyncMock(return_value=mock_response(200, expected))

        await client.submit_messages("L1", "ct-abc", "run-1", [])

        call_kwargs = client._http.post.call_args
        assert call_kwargs.kwargs["json"]["messages"] == []


# ---------------------------------------------------------------------------
# complete_lease
# ---------------------------------------------------------------------------


class TestCompleteLease:
    @pytest.mark.asyncio
    async def test_complete_success(self, client, mock_response):
        task_result = {"exit_code": 0, "output": "done"}
        expected = {"status": "completed"}
        client._http.post = AsyncMock(return_value=mock_response(200, expected))

        result = await client.complete_lease("L1", "ct-abc", task_result)

        client._http.post.assert_awaited_once_with(
            "/api/daemon/leases/L1/complete",
            json={"claim_token": "ct-abc", "result": task_result},
        )
        assert result == expected

    @pytest.mark.asyncio
    async def test_complete_with_error_result(self, client, mock_response):
        task_result = {"exit_code": 1, "error": "boom"}
        expected = {"status": "completed"}
        client._http.post = AsyncMock(return_value=mock_response(200, expected))

        result = await client.complete_lease("L1", "ct-abc", task_result)
        assert result == expected


# ---------------------------------------------------------------------------
# Error handling across methods
# ---------------------------------------------------------------------------


class TestErrorHandling:
    @pytest.mark.asyncio
    async def test_network_error_raises(self, client):
        client._http.post = AsyncMock(
            side_effect=httpx.ConnectError("connection refused")
        )

        with pytest.raises(httpx.ConnectError):
            await client.heartbeat("rt-1")

    @pytest.mark.asyncio
    async def test_timeout_raises(self, client):
        client._http.post = AsyncMock(side_effect=httpx.TimeoutException("timed out"))

        with pytest.raises(httpx.TimeoutException):
            await client.register(name="daemon")
