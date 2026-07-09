"""Tests for POST /api/daemon/runtimes/{id}/list-roots endpoint.

task-06 of change ``2026-07-09-remote-folder-picker`` (FR-2 / FR-5):

* owner 调用返 200 + ``{roots}`` 列表
* 非 owner 返 404 (ownership)
* daemon 离线返 504 (DaemonRuntimeOffline)
* forbidden 返 403 (RpcError code=forbidden)

Fixture/mock 模式照抄 ``test_ws_rpc.py::TestListDirEndpoint``：用 root ``client`` /
``auth_headers`` / ``db_session`` fixture（backend/conftest.py）+ ``fresh_ws_hub``
patch ws_hub 单例 + ``monkeypatch.setattr(DaemonWsHub, "send_rpc", ...)`` 注入错误。
"""

from __future__ import annotations

import asyncio
import uuid
from datetime import UTC, datetime
from typing import Any
from unittest.mock import AsyncMock

import pytest
from httpx import AsyncClient

from app.modules.daemon import ws_hub as ws_hub_module
from app.modules.daemon.model import DaemonRuntime
from app.modules.daemon.protocol import DAEMON_MSG_RPC
from app.modules.daemon.service import (
    DaemonRpcRemoteError,
    DaemonRuntimeOffline,
)
from app.modules.daemon.ws_hub import DaemonWsHub

# ── Helpers ──────────────────────────────────────────────────────────────────


async def _create_user(session: Any) -> uuid.UUID:
    """Insert a User row so FK constraints on daemon_runtimes are satisfied."""
    from app.modules.auth.model import User

    uid = uuid.uuid4()
    user = User(
        id=uid,
        email=f"roots-{uid}@example.com",
        password_hash="irrelevant",
        display_name="Roots Tester",
        status="active",
    )
    session.add(user)
    await session.commit()
    return uid


async def _create_runtime(
    session: Any,
    user_id: uuid.UUID,
    *,
    status: str = "online",
) -> DaemonRuntime:
    rt = DaemonRuntime(
        id=uuid.uuid4(),
        user_id=user_id,
        name="roots-daemon",
        provider="claude_code",
        status=status,
        last_heartbeat_at=datetime.now(UTC),
    )
    session.add(rt)
    await session.commit()
    await session.refresh(rt)
    return rt


async def _admin_user_id(session: Any) -> uuid.UUID:
    """Resolve the platform admin user id created by ``auth_admin_token``.

    list_roots 调 ``_get_owned_runtime(runtime_id, user.id)``，所以 runtime 必须
    属于当前认证用户（即 ``auth_headers`` 携带的 admin）。
    """
    from sqlalchemy import select

    from app.modules.auth.model import User

    stmt = select(User).where(User.email == "admin@example.com").limit(1)
    user = (await session.execute(stmt)).scalars().first()
    assert user is not None, "admin user must be created by auth_admin_token first"
    return user.id


# ── Endpoint: POST /api/daemon/runtimes/{id}/list-roots ──────────────────────


@pytest.fixture()
def fresh_ws_hub(monkeypatch: pytest.MonkeyPatch) -> DaemonWsHub:
    """Replace the process-wide ws_hub singleton with a fresh DaemonWsHub.

    照抄 test_ws_rpc.py 的同名 fixture：router 通过 lazy import
    ``get_daemon_ws_hub`` 拿到模块级 ``_ws_hub`` 单例，patch 它即可注入受控 hub。
    """
    hub = DaemonWsHub()
    monkeypatch.setattr(ws_hub_module, "_ws_hub", hub)
    return hub


class TestListRootsEndpoint:
    """HTTP-level coverage of the list-roots forwarding endpoint (task-04 / FR-2)."""

    async def test_list_roots_200_owner(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: Any,
        fresh_ws_hub: DaemonWsHub,
    ) -> None:
        """owner 调用 → 200 + ``{roots}`` 透传 daemon 返回的锚点列表。"""
        uid = await _admin_user_id(db_session)
        rt = await _create_runtime(db_session, uid)

        # Wire a mock ws whose send_json resolves the RPC inline once the
        # daemon:rpc message lands（与 test_list_dir_200 同款，避免与阻塞的
        # httpx ASGI post 调用相互死锁）。
        ws = AsyncMock()
        ws.sent_messages = []
        ws.close = AsyncMock()

        async def _send_json(message: dict[str, Any]) -> None:
            ws.sent_messages.append(message)
            if message.get("type") == DAEMON_MSG_RPC:
                payload = message.get("payload") or {}
                rpc_id = payload.get("rpc_id")
                loop = asyncio.get_running_loop()
                loop.call_later(
                    0,
                    lambda: asyncio.ensure_future(
                        fresh_ws_hub.resolve_rpc(
                            rpc_id,
                            {
                                "rpc_id": rpc_id,
                                "result": {"roots": ["C:\\", "D:\\"]},
                            },
                        )
                    ),
                )

        ws.send_json = AsyncMock(side_effect=_send_json)
        await fresh_ws_hub.connect(rt.id, ws)

        resp = await client.post(
            f"/api/daemon/runtimes/{rt.id}/list-roots",
            headers=auth_headers,
        )

        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["roots"] == ["C:\\", "D:\\"]
        # rpc 消息确实经 mock ws 发出。
        assert any(m.get("type") == DAEMON_MSG_RPC for m in ws.sent_messages)

    async def test_list_roots_404_not_owned(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: Any,
        fresh_ws_hub: DaemonWsHub,
    ) -> None:
        """非 owner → ownership 校验失败 → 404 (D-002 / D-007)。"""
        # runtime 属于另一个用户。
        other_uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, other_uid)

        resp = await client.post(
            f"/api/daemon/runtimes/{rt.id}/list-roots",
            headers=auth_headers,
        )
        assert resp.status_code == 404, resp.text
        assert resp.json()["code"] == "HTTP_404_DAEMON_RUNTIME_NOT_FOUND"

    async def test_list_roots_504_offline(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: Any,
        fresh_ws_hub: DaemonWsHub,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """daemon 离线 → ws_hub.send_rpc 抛 DaemonRuntimeOffline → 504。

        这里直接 mock ``DaemonWsHub.send_rpc`` 抛 DaemonRuntimeOffline，让映射
        路径与 list_roots 端点的 ``except DaemonRuntimeOffline`` 分支精确对齐
        （不依赖 connect() 缺失这种隐式触发，断言更稳）。
        """
        uid = await _admin_user_id(db_session)
        rt = await _create_runtime(db_session, uid)

        async def _raise(
            self,
            daemon_id: uuid.UUID,
            method: str,
            params: dict[str, Any],
            *,
            timeout: float = 1.0,
        ) -> dict[str, Any]:
            raise DaemonRuntimeOffline(
                f"daemon runtime '{daemon_id}' offline.",
                details={"runtime_id": str(daemon_id)},
            )

        monkeypatch.setattr(DaemonWsHub, "send_rpc", _raise)

        resp = await client.post(
            f"/api/daemon/runtimes/{rt.id}/list-roots",
            headers=auth_headers,
        )
        assert resp.status_code == 504, resp.text
        assert resp.json()["code"] == "HTTP_504_DAEMON_RPC_GATEWAY"

    async def test_list_roots_403_forbidden(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: Any,
        fresh_ws_hub: DaemonWsHub,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """daemon 业务拒绝 (RpcError code=forbidden) → 403 (FR-04)。"""
        uid = await _admin_user_id(db_session)
        rt = await _create_runtime(db_session, uid)

        async def _raise(
            self,
            daemon_id: uuid.UUID,
            method: str,
            params: dict[str, Any],
            *,
            timeout: float = 1.0,
        ) -> dict[str, Any]:
            raise DaemonRpcRemoteError(
                {"code": "forbidden", "message": "path outside allowed_roots"}
            )

        monkeypatch.setattr(DaemonWsHub, "send_rpc", _raise)

        resp = await client.post(
            f"/api/daemon/runtimes/{rt.id}/list-roots",
            headers=auth_headers,
        )
        assert resp.status_code == 403, resp.text
        assert resp.json()["code"] == "HTTP_403_DAEMON_RPC_FORBIDDEN"
