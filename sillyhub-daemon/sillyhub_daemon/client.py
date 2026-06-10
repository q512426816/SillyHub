"""HTTP client for communicating with SillyHub server daemon API.

Provides :class:`HubClient` — an async HTTP client built on ``httpx`` that
covers all daemon-facing REST endpoints (register, heartbeat, lease lifecycle).

WebSocket communication is handled separately in ``daemon.py`` via the
``websockets`` library and is intentionally kept out of this module.
"""

from __future__ import annotations

import logging
from typing import Any

import httpx

logger = logging.getLogger(__name__)


class HubClient:
    """Async HTTP client for SillyHub server daemon API.

    Parameters
    ----------
    server_url:
        Base URL of the SillyHub server (e.g. ``"http://localhost:8000"``).
    token:
        Optional bearer token for authentication.
    """

    def __init__(self, server_url: str, token: str | None = None) -> None:
        self._base_url = server_url.rstrip("/")
        self._token = token
        self._http = httpx.AsyncClient(
            base_url=self._base_url,
            headers=self._auth_headers(),
            timeout=30.0,
            trust_env=False,  # daemon talks to local server; bypass system proxy
        )

    # -- helpers -------------------------------------------------------------

    def _auth_headers(self) -> dict[str, str]:
        """Return Authorization header dict when a token is configured."""
        if self._token:
            return {"Authorization": f"Bearer {self._token}"}
        return {}

    async def close(self) -> None:
        """Gracefully close the underlying HTTP connection pool."""
        await self._http.aclose()

    # -- Runtime -------------------------------------------------------------

    async def register(
        self,
        *,
        runtime_id: str | None = None,
        name: str = "",
        provider: str = "",
        version: str = "",
        protocol: str = "",
        os: str = "",
        arch: str = "",
        capabilities: dict[str, Any] | None = None,
        **kwargs: Any,
    ) -> dict[str, Any]:
        """Register this daemon runtime with the server.

        Parameters
        ----------
        runtime_id:
            Unique runtime identifier. If not provided, the server generates one.
        name:
            Hostname of the machine running the daemon.
        provider:
            Agent provider name (e.g. "claude", "codex").
        version:
            Agent binary version string.
        protocol:
            Execution protocol (e.g. "stream_json", "json_rpc").
        """
        body: dict[str, Any] = {
            "name": name,
            "provider": provider,
            "version": version,
            "os": os,
            "arch": arch,
            **kwargs,
        }
        if runtime_id is not None:
            body["runtime_id"] = runtime_id
        if protocol:
            body["protocol"] = protocol
        if capabilities:
            body["capabilities"] = capabilities
        resp = await self._http.post("/api/daemon/register", json=body)
        resp.raise_for_status()
        return resp.json()

    async def heartbeat(self, runtime_id: str) -> dict[str, Any]:
        """Send an HTTP heartbeat for the given *runtime_id*."""
        resp = await self._http.post(
            "/api/daemon/heartbeat",
            json={"runtime_id": runtime_id},
        )
        resp.raise_for_status()
        return resp.json()

    # -- Lease lifecycle -----------------------------------------------------

    async def claim_lease(
        self,
        lease_id: str,
        runtime_id: str,
    ) -> dict[str, Any]:
        """Claim a pending lease for execution.

        Returns the server response which typically includes a
        ``claim_token`` required for subsequent lease operations.
        """
        resp = await self._http.post(
            f"/api/daemon/leases/{lease_id}/claim",
            json={"runtime_id": runtime_id},
        )
        resp.raise_for_status()
        return resp.json()

    async def start_lease(self, lease_id: str, claim_token: str) -> dict[str, Any]:
        """Mark a claimed lease as started."""
        resp = await self._http.post(
            f"/api/daemon/leases/{lease_id}/start",
            json={"claim_token": claim_token},
        )
        resp.raise_for_status()
        return resp.json()

    async def lease_heartbeat(
        self,
        lease_id: str,
        claim_token: str,
    ) -> dict[str, Any]:
        """Renew / heartbeat an in-progress lease."""
        resp = await self._http.post(
            f"/api/daemon/leases/{lease_id}/heartbeat",
            json={"claim_token": claim_token},
        )
        resp.raise_for_status()
        return resp.json()

    async def submit_messages(
        self,
        lease_id: str,
        claim_token: str,
        agent_run_id: str,
        messages: list[dict[str, Any]],
    ) -> dict[str, Any]:
        """Submit agent messages for a running lease."""
        resp = await self._http.post(
            f"/api/daemon/leases/{lease_id}/messages",
            json={
                "claim_token": claim_token,
                "agent_run_id": agent_run_id,
                "messages": messages,
            },
        )
        resp.raise_for_status()
        return resp.json()

    async def complete_lease(
        self,
        lease_id: str,
        claim_token: str,
        result: dict[str, Any],
    ) -> dict[str, Any]:
        """Complete a lease with the given *result* payload."""
        resp = await self._http.post(
            f"/api/daemon/leases/{lease_id}/complete",
            json={"claim_token": claim_token, "result": result},
        )
        resp.raise_for_status()
        return resp.json()
