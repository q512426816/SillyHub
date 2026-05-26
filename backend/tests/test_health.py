"""Health endpoint tests.

These tests patch the dependency probes so they don't require a real Postgres
or Redis to be reachable on the CI machine.
"""

from __future__ import annotations

from typing import Any

import pytest
from httpx import AsyncClient


@pytest.fixture()
def _stub_all_ok(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.modules.health import router as health_module

    async def _ok() -> str:
        return "ok"

    monkeypatch.setattr(health_module, "_check_db", _ok)
    monkeypatch.setattr(health_module, "_check_redis", _ok)


@pytest.fixture()
def _stub_db_down(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.modules.health import router as health_module

    async def _ok() -> str:
        return "ok"

    async def _down() -> str:
        return "down"

    monkeypatch.setattr(health_module, "_check_db", _down)
    monkeypatch.setattr(health_module, "_check_redis", _ok)


@pytest.mark.usefixtures("_stub_all_ok")
async def test_health_all_ok(client: AsyncClient) -> None:
    resp = await client.get("/api/health")
    assert resp.status_code == 200
    payload: dict[str, Any] = resp.json()
    assert payload["status"] == "ok"
    assert payload["db"] == "ok"
    assert payload["redis"] == "ok"
    assert payload["version"]
    assert payload["commit_sha"]
    assert payload["environment"] == "test"


@pytest.mark.usefixtures("_stub_db_down")
async def test_health_degraded_when_db_down(client: AsyncClient) -> None:
    resp = await client.get("/api/health")
    assert resp.status_code == 200, "health endpoint must remain 200 to keep LB rotation"
    payload = resp.json()
    assert payload["status"] == "degraded"
    assert payload["db"] == "down"
    assert payload["redis"] == "ok"


async def test_version_endpoint(client: AsyncClient) -> None:
    resp = await client.get("/api/version")
    assert resp.status_code == 200
    payload = resp.json()
    assert payload["environment"] == "test"
    assert payload["version"]
    assert payload["commit_sha"]


async def test_request_id_round_trip(client: AsyncClient) -> None:
    resp = await client.get("/api/version", headers={"x-request-id": "test-rid-123"})
    assert resp.status_code == 200
    assert resp.headers.get("x-request-id") == "test-rid-123"
