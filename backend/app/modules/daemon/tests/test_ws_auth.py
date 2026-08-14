"""task-01（FR-01 / D-001@v1）：daemon WS 升级期鉴权契约测试。

锁定 ``daemon_websocket`` 在 ``accept()`` 之前完成的凭据解析与归属断言：

* 无凭据（无 ``X-API-Key`` / ``Authorization``）→ close code=4001；
* 他人有效 apiKey 连接本人 daemon_local_id → close code=4003（归属不匹配）；
* 本人 apiKey → 握手成功并注册进 ws hub。

与 ``test_ws_handshake_daemon_id.py`` 同范式：Starlette 同步 ``TestClient``
（唯一不吃 httpx 的 WS driver），autouse ``_redirect_session_factory`` 把 WS
端点 ``get_session_factory()`` 落到内存测试引擎；``fresh_ws_hub`` 每测试换新
hub 单例。apiKey 通过 ``ApiKeyService.create`` 真签发（bcrypt 全链路，rounds
已由 conftest 降到 4）。
"""

from __future__ import annotations

import uuid
from typing import Any

import pytest
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app.modules.auth.api_key_service import ApiKeyService
from app.modules.auth.model import User
from app.modules.daemon import ws_hub as ws_hub_module
from app.modules.daemon.model import DaemonInstance
from app.modules.daemon.ws_hub import DaemonWsHub


@pytest.fixture()
def fresh_ws_hub(monkeypatch: pytest.MonkeyPatch) -> DaemonWsHub:
    """Replace the process-wide ws_hub singleton with a fresh, wired hub."""
    hub = DaemonWsHub()
    monkeypatch.setattr(ws_hub_module, "_ws_hub", hub)
    return hub


async def _seed_user(db_session: AsyncSession, *, name: str) -> User:
    user = User(
        id=uuid.uuid4(),
        email=f"{name}-{uuid.uuid4()}@example.com",
        password_hash="x",
        display_name=name,
        status="active",
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return user


async def _seed_daemon_instance(
    db_session: AsyncSession,
    *,
    user_id: uuid.UUID,
) -> DaemonInstance:
    inst = DaemonInstance(
        id=uuid.uuid4(),
        user_id=user_id,
        hostname="test-host",
        server_url="http://test",
        os="linux",
        arch="x86_64",
        status="online",
    )
    db_session.add(inst)
    await db_session.commit()
    await db_session.refresh(inst)
    return inst


async def _issue_api_key(db_session: AsyncSession, *, user: User) -> str:
    """真签发一把 shk_live_ key（走 ApiKeyService.create 全链路）。"""
    from app.core.config import get_settings

    _, plaintext = await ApiKeyService(db_session, settings=get_settings()).create(
        user_id=user.id, name=f"ws-auth-{user.display_name}", expires_at=None
    )
    return plaintext


def _build_app(db_session: AsyncSession) -> Any:
    from fastapi import FastAPI

    from app.core.db import get_session
    from app.modules.daemon.router import router

    app = FastAPI()
    app.include_router(router, prefix="/api")

    async def _override():
        yield db_session

    app.dependency_overrides[get_session] = _override
    return app


class TestWsUpgradeAuth:
    """task-01 acceptance: 4001（无凭据）/ 4003（归属不匹配）/ 本人放行。"""

    async def test_ws_without_credentials_closed_4001(
        self,
        db_session: AsyncSession,
        fresh_ws_hub: DaemonWsHub,
    ) -> None:
        """无任何凭据 header → close code=4001（authentication required）。"""
        owner = await _seed_user(db_session, name="owner")
        inst = await _seed_daemon_instance(db_session, user_id=owner.id)
        app = _build_app(db_session)

        with TestClient(app) as client:
            with pytest.raises(WebSocketDisconnect) as exc_info:
                with client.websocket_connect(f"/api/daemon/ws?daemon_local_id={inst.id}"):
                    pass
        assert exc_info.value.code == 4001

    async def test_ws_foreign_api_key_closed_4003(
        self,
        db_session: AsyncSession,
        fresh_ws_hub: DaemonWsHub,
    ) -> None:
        """他人有效 apiKey 连接本人 daemon → close code=4003（ownership mismatch）。"""
        owner = await _seed_user(db_session, name="owner")
        intruder = await _seed_user(db_session, name="intruder")
        inst = await _seed_daemon_instance(db_session, user_id=owner.id)
        intruder_key = await _issue_api_key(db_session, user=intruder)
        app = _build_app(db_session)

        with TestClient(app) as client:
            with pytest.raises(WebSocketDisconnect) as exc_info:
                with client.websocket_connect(
                    f"/api/daemon/ws?daemon_local_id={inst.id}",
                    headers={"X-API-Key": intruder_key},
                ):
                    pass
        assert exc_info.value.code == 4003
        assert not fresh_ws_hub.is_connected(inst.id)

    async def test_ws_owner_api_key_accepted_and_registered(
        self,
        db_session: AsyncSession,
        fresh_ws_hub: DaemonWsHub,
    ) -> None:
        """本人 apiKey → accept + 注册进 ws hub（connected_count == 1）。"""
        owner = await _seed_user(db_session, name="owner")
        inst = await _seed_daemon_instance(db_session, user_id=owner.id)
        owner_key = await _issue_api_key(db_session, user=owner)
        app = _build_app(db_session)

        with TestClient(app) as client:
            with client.websocket_connect(
                f"/api/daemon/ws?daemon_local_id={inst.id}",
                headers={"X-API-Key": owner_key},
            ):
                assert fresh_ws_hub.is_connected(inst.id) is True
                assert fresh_ws_hub.connected_count == 1
                assert inst.id in fresh_ws_hub.connected_daemon_ids
