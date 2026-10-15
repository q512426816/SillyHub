"""Health endpoint tests.

These tests patch the dependency probes so they don't require a real Postgres
or Redis to be reachable on the CI machine.
"""

from __future__ import annotations

import uuid
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


# ── system-status 鉴权三态（2026-10-14-admin-server-status task-01 / D-001@v2）──
# 由公开收紧为登录 + SYSTEM_STATUS_READ（platform:admin 直通），关闭审计 BS-6。


async def _make_user_token(db_session: Any, *, admin: bool) -> str:
    """建用户并签 token（模式同 tests/modules/settings/test_mcp_settings.py）。"""
    from app.core.config import get_settings
    from app.core.security import create_access_token, password_hasher
    from app.modules.auth.model import User

    user = User(
        id=uuid.uuid4(),
        email=f"user-{uuid.uuid4().hex[:6]}@example.com",
        password_hash=password_hasher.hash("x"),
        status="active",
        is_platform_admin=admin,
    )
    db_session.add(user)
    await db_session.commit()
    token, _ = create_access_token(
        user_id=user.id,
        email=user.email,
        is_admin=user.is_platform_admin,
        settings=get_settings(),
    )
    return token


async def test_system_status_requires_login(client: AsyncClient) -> None:
    """未登录 401——匿名不再能读服务器性能（BS-6 收紧）。"""
    resp = await client.get("/api/system-status")
    assert resp.status_code == 401, resp.text


async def test_system_status_forbidden_without_permission(
    client: AsyncClient, db_session: Any
) -> None:
    """登录但无 system_status:read（非管理员、无角色授权）→ 403。"""
    token = await _make_user_token(db_session, admin=False)
    resp = await client.get("/api/system-status", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 403, resp.text


async def test_system_status_ok_for_platform_admin(client: AsyncClient, db_session: Any) -> None:
    """platform:admin 直通 → 200，响应字段与既有 schema 一致。"""
    token = await _make_user_token(db_session, admin=True)
    resp = await client.get("/api/system-status", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200, resp.text
    payload: dict[str, Any] = resp.json()
    for key in (
        "server_time",
        "cpu_percent",
        "memory_percent",
        "memory_used_mb",
        "memory_total_mb",
        "disk_percent",
        "disk_used_gb",
        "disk_total_gb",
        "tasks",
        "projects",
        "milestones",
        "users",
    ):
        assert key in payload, f"missing field: {key}"
