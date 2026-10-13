"""Tests for machine diag endpoints (2026-10-13-daemon-log-config-view task-02).

GET /api/daemon/machines/{instance_id}/logs?tail=N
GET /api/daemon/machines/{instance_id}/config?reveal=

覆盖（design §Phase 2 / 接口定义错误映射表）：
- 转发成功（result 字段含 truncated / masked_fields 原样透传）
- tail / reveal 参数透传到 send_rpc params
- 离线（DaemonRuntimeOffline）→ 504（既有 AppError 原样透传，code 不改写）
- 超时（DaemonRpcTimeout）→ 504（同上）
- method_not_found（DaemonRpcRemoteError）→ 422 HTTP_422_DAEMON_DIAG_UNSUPPORTED
- 其余远端错（code=internal）→ 502 HTTP_502_DAEMON_RPC_REMOTE
- 平台管理员访问他人机器 → 200 放行（_get_owned_instance 的 admin 语义；
  非 owner 的 404 归属校验由 _get_owned_instance 既有测试覆盖，此处不重复构造角色用户）
- 非 admin → 403
- openapi 可见两条新路径
"""

from __future__ import annotations

import uuid
from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.security import create_access_token, password_hasher
from app.modules.auth.model import User
from app.modules.daemon.model import DaemonInstance
from app.modules.daemon.runtime.service import (
    DaemonRpcRemoteError,
    DaemonRpcTimeout,
    DaemonRuntimeOffline,
)

pytestmark = pytest.mark.asyncio

LOG_RESULT: dict[str, Any] = {
    "path": "/home/u/.sillyhub/daemon/daemon.log",
    "size": 1024,
    "mtime": "2026-10-13T10:00:00Z",
    "exists": True,
    "lines": ["[daemon.heartbeat] ok=1", "[daemon.ws] event=connected"],
    "line_count": 2,
    "truncated": True,
}

CONFIG_RESULT: dict[str, Any] = {
    "path": "/home/u/.sillyhub/daemon/config-3fa9c2e1.json",
    "config": {"token": "sk-l***efgh", "poll_interval": 30},
    "masked_fields": ["token"],
}


class FakeHub:
    """``DaemonWsHub`` 测试替身——记录 send_rpc 调用，可预设 result / 抛异常。"""

    def __init__(self, result: Any = None, exc: BaseException | None = None) -> None:
        self.calls: list[dict[str, Any]] = []
        self.result = result
        self.exc = exc

    async def send_rpc(
        self,
        daemon_id: uuid.UUID,
        method: str,
        params: dict[str, Any],
        *,
        timeout: float | None = None,
    ) -> dict[str, Any]:
        self.calls.append(
            {
                "daemon_id": daemon_id,
                "method": method,
                "params": params,
                "timeout": timeout,
            }
        )
        if self.exc is not None:
            raise self.exc
        return self.result


async def _seed_user(session: AsyncSession, *, is_platform_admin: bool) -> tuple[User, str]:
    user = User(
        id=uuid.uuid4(),
        email=f"user-{uuid.uuid4().hex[:6]}@example.com",
        password_hash=password_hasher.hash("x"),
        status="active",
        is_platform_admin=is_platform_admin,
    )
    session.add(user)
    await session.commit()
    await session.refresh(user)
    token, _ = create_access_token(
        user_id=user.id,
        email=user.email,
        is_admin=user.is_platform_admin,
        settings=get_settings(),
    )
    return user, token


async def _make_instance(session: AsyncSession, owner_id: uuid.UUID) -> DaemonInstance:
    inst = DaemonInstance(
        id=uuid.uuid4(),
        user_id=owner_id,
        hostname="host-diag",
        server_url="http://test.local",
    )
    session.add(inst)
    await session.commit()
    await session.refresh(inst)
    return inst


def _bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


# ── 正常路径 ────────────────────────────────────────────────────────────────


async def test_logs_200_forwards_result(
    client: AsyncClient, db_session: AsyncSession, monkeypatch
) -> None:
    admin, token = await _seed_user(db_session, is_platform_admin=True)
    inst = await _make_instance(db_session, admin.id)
    hub = FakeHub(result=LOG_RESULT)
    monkeypatch.setattr("app.modules.daemon.ws_hub.get_daemon_ws_hub", lambda: hub)

    resp = await client.get(f"/api/daemon/machines/{inst.id}/logs", headers=_bearer(token))
    assert resp.status_code == 200, resp.text
    assert resp.json() == LOG_RESULT
    # RPC 契约：method + 默认参数 + 30s 超时（design 接口定义）
    assert len(hub.calls) == 1
    call = hub.calls[0]
    assert call["daemon_id"] == inst.id
    assert call["method"] == "daemon_log_tail"
    assert call["params"] == {"tail_lines": 500}
    assert call["timeout"] == 30.0


async def test_logs_tail_param_passthrough(
    client: AsyncClient, db_session: AsyncSession, monkeypatch
) -> None:
    admin, token = await _seed_user(db_session, is_platform_admin=True)
    inst = await _make_instance(db_session, admin.id)
    hub = FakeHub(result=LOG_RESULT)
    monkeypatch.setattr("app.modules.daemon.ws_hub.get_daemon_ws_hub", lambda: hub)

    resp = await client.get(
        f"/api/daemon/machines/{inst.id}/logs?tail=2000", headers=_bearer(token)
    )
    assert resp.status_code == 200, resp.text
    assert hub.calls[0]["params"] == {"tail_lines": 2000}


async def test_config_200_masked_fields_passthrough(
    client: AsyncClient, db_session: AsyncSession, monkeypatch
) -> None:
    admin, token = await _seed_user(db_session, is_platform_admin=True)
    inst = await _make_instance(db_session, admin.id)
    hub = FakeHub(result=CONFIG_RESULT)
    monkeypatch.setattr("app.modules.daemon.ws_hub.get_daemon_ws_hub", lambda: hub)

    resp = await client.get(f"/api/daemon/machines/{inst.id}/config", headers=_bearer(token))
    assert resp.status_code == 200, resp.text
    assert resp.json() == CONFIG_RESULT
    call = hub.calls[0]
    assert call["method"] == "daemon_config_get"
    assert call["params"] == {"reveal": False}
    assert call["timeout"] == 30.0


async def test_config_reveal_true_passthrough(
    client: AsyncClient, db_session: AsyncSession, monkeypatch
) -> None:
    admin, token = await _seed_user(db_session, is_platform_admin=True)
    inst = await _make_instance(db_session, admin.id)
    hub = FakeHub(result={**CONFIG_RESULT, "masked_fields": []})
    monkeypatch.setattr("app.modules.daemon.ws_hub.get_daemon_ws_hub", lambda: hub)

    resp = await client.get(
        f"/api/daemon/machines/{inst.id}/config?reveal=true", headers=_bearer(token)
    )
    assert resp.status_code == 200, resp.text
    assert hub.calls[0]["params"] == {"reveal": True}


# ── 错误映射（design 接口定义场景表）──────────────────────────────────────


async def test_logs_offline_maps_504(
    client: AsyncClient, db_session: AsyncSession, monkeypatch
) -> None:
    admin, token = await _seed_user(db_session, is_platform_admin=True)
    inst = await _make_instance(db_session, admin.id)
    hub = FakeHub(exc=DaemonRuntimeOffline("offline"))
    monkeypatch.setattr("app.modules.daemon.ws_hub.get_daemon_ws_hub", lambda: hub)

    resp = await client.get(f"/api/daemon/machines/{inst.id}/logs", headers=_bearer(token))
    assert resp.status_code == 504, resp.text
    # 原样透传既有 AppError code（不包裹、不改写）
    assert resp.json()["code"] == "HTTP_504_DAEMON_RUNTIME_OFFLINE"


async def test_logs_timeout_maps_504(
    client: AsyncClient, db_session: AsyncSession, monkeypatch
) -> None:
    admin, token = await _seed_user(db_session, is_platform_admin=True)
    inst = await _make_instance(db_session, admin.id)
    hub = FakeHub(exc=DaemonRpcTimeout("timed out"))
    monkeypatch.setattr("app.modules.daemon.ws_hub.get_daemon_ws_hub", lambda: hub)

    resp = await client.get(f"/api/daemon/machines/{inst.id}/config", headers=_bearer(token))
    assert resp.status_code == 504, resp.text
    assert resp.json()["code"] == "HTTP_504_DAEMON_RPC_TIMEOUT"


async def test_method_not_found_maps_422(
    client: AsyncClient, db_session: AsyncSession, monkeypatch
) -> None:
    admin, token = await _seed_user(db_session, is_platform_admin=True)
    inst = await _make_instance(db_session, admin.id)
    hub = FakeHub(exc=DaemonRpcRemoteError({"code": "method_not_found", "message": "x"}))
    monkeypatch.setattr("app.modules.daemon.ws_hub.get_daemon_ws_hub", lambda: hub)

    for path in ("/logs", "/config"):
        resp = await client.get(f"/api/daemon/machines/{inst.id}{path}", headers=_bearer(token))
        assert resp.status_code == 422, f"{path}: {resp.text}"
        assert resp.json()["code"] == "HTTP_422_DAEMON_DIAG_UNSUPPORTED"


async def test_remote_internal_maps_502(
    client: AsyncClient, db_session: AsyncSession, monkeypatch
) -> None:
    admin, token = await _seed_user(db_session, is_platform_admin=True)
    inst = await _make_instance(db_session, admin.id)
    hub = FakeHub(exc=DaemonRpcRemoteError({"code": "internal", "message": "boom"}))
    monkeypatch.setattr("app.modules.daemon.ws_hub.get_daemon_ws_hub", lambda: hub)

    resp = await client.get(f"/api/daemon/machines/{inst.id}/logs", headers=_bearer(token))
    assert resp.status_code == 502, resp.text
    assert resp.json()["code"] == "HTTP_502_DAEMON_RPC_REMOTE"


# ── 鉴权与归属 ──────────────────────────────────────────────────────────────


async def test_platform_admin_can_view_others_machine(
    client: AsyncClient, db_session: AsyncSession, monkeypatch
) -> None:
    """平台管理员可诊断他人机器（_get_owned_instance 对 admin 放行——与
    trigger_machine_cleanup 等既有 machines 端点同语义；非 owner 的 404
    归属校验由 _get_owned_instance 既有测试覆盖，此处不重复构造角色用户）。"""
    owner, _ = await _seed_user(db_session, is_platform_admin=True)
    inst = await _make_instance(db_session, owner.id)
    other, other_token = await _seed_user(db_session, is_platform_admin=True)
    assert other.id != owner.id
    hub = FakeHub(result=LOG_RESULT)
    monkeypatch.setattr("app.modules.daemon.ws_hub.get_daemon_ws_hub", lambda: hub)

    resp = await client.get(f"/api/daemon/machines/{inst.id}/logs", headers=_bearer(other_token))
    assert resp.status_code == 200, resp.text
    assert resp.json() == LOG_RESULT


async def test_non_admin_returns_403(
    client: AsyncClient, db_session: AsyncSession, monkeypatch
) -> None:
    plain, token = await _seed_user(db_session, is_platform_admin=False)
    inst = await _make_instance(db_session, plain.id)
    hub = FakeHub(result=LOG_RESULT)
    monkeypatch.setattr("app.modules.daemon.ws_hub.get_daemon_ws_hub", lambda: hub)

    resp = await client.get(f"/api/daemon/machines/{inst.id}/logs", headers=_bearer(token))
    assert resp.status_code == 403, resp.text
    assert hub.calls == []


# ── openapi 可见性 ──────────────────────────────────────────────────────────


async def test_openapi_lists_diag_paths() -> None:
    from app.main import app

    paths = app.openapi()["paths"]
    base = "/api/daemon/machines/{instance_id}"
    for suffix in ("/logs", "/config"):
        assert f"{base}{suffix}" in paths, f"openapi 缺 {suffix}"
