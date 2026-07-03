"""WS handshake contract tests for task-06 (per-daemon WS, design §5.3 / §9.3 / D-006).

Locks in the breaking change to the daemon WS handshake:

* The endpoint reads ``?daemon_local_id=<uuid>`` (no longer ``?runtime_id=``).
* The value must resolve to a registered ``daemon_instances.id`` row.
* A connection registered under a daemon_id routes server→daemon messages by
  that id, and a second connect with the same daemon_id evicts the old socket.
* payload ``runtime_id`` is the provider discriminator and is echoed in acks.

These tests use Starlette's synchronous ``TestClient`` (the only httpx-unaware
WS driver) and rely on the autouse ``_redirect_session_factory`` conftest
fixture so the WS endpoint's ``get_session_factory()`` lands on the in-memory
test engine where ``daemon_instances`` rows are seeded.
"""

from __future__ import annotations

import uuid
from typing import Any
from unittest.mock import AsyncMock

import pytest
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.testclient import TestClient

from app.modules.daemon import ws_hub as ws_hub_module
from app.modules.daemon.model import DaemonInstance
from app.modules.daemon.ws_hub import DaemonWsHub


@pytest.fixture()
def fresh_ws_hub(monkeypatch: pytest.MonkeyPatch) -> DaemonWsHub:
    """Replace the process-wide ws_hub singleton with a fresh, wired hub."""
    hub = DaemonWsHub()
    monkeypatch.setattr(ws_hub_module, "_ws_hub", hub)
    return hub


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


async def _seed_admin(db_session: AsyncSession) -> uuid.UUID:
    from app.modules.auth.model import User

    user = User(
        id=uuid.uuid4(),
        email=f"ws-{uuid.uuid4()}@example.com",
        password_hash="x",
        display_name="admin",
        status="active",
        is_platform_admin=True,
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return user.id


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


class TestWsHandshakeDaemonLocalId:
    """task-06: handshake requires a registered daemon_local_id."""

    @pytest.mark.asyncio
    async def test_handshake_accepts_registered_daemon_local_id(
        self,
        db_session: AsyncSession,
        fresh_ws_hub: DaemonWsHub,
    ) -> None:
        uid = await _seed_admin(db_session)
        inst = await _seed_daemon_instance(db_session, user_id=uid)
        app = _build_app(db_session)

        with TestClient(app) as client:
            with client.websocket_connect(f"/api/daemon/ws?daemon_local_id={inst.id}") as ws:
                # Connection accepted + registered under daemon_id.
                assert fresh_ws_hub.is_connected(inst.id) is True
                assert fresh_ws_hub.connected_count == 1
                assert inst.id in fresh_ws_hub.connected_daemon_ids

                # Server→daemon heartbeat_ack routes by daemon_id, echoes a
                # runtime_id (defaults to daemon_id when caller omits it).
                import asyncio

                asyncio.get_event_loop()
                ws.send_json({"type": "daemon:heartbeat", "payload": {}})

    @pytest.mark.asyncio
    async def test_handshake_rejects_legacy_runtime_id_query(
        self,
        db_session: AsyncSession,
        fresh_ws_hub: DaemonWsHub,
    ) -> None:
        """D-007 breaking change: ``?runtime_id=`` is no longer accepted.

        The endpoint only reads ``daemon_local_id``; sending the legacy
        ``runtime_id`` query leaves daemon_local_id missing → 422 (required
        query param). The connection never reaches the receive loop.
        """
        app = _build_app(db_session)
        with TestClient(app) as client:
            with pytest.raises(Exception):
                with client.websocket_connect(f"/api/daemon/ws?runtime_id={uuid.uuid4()}"):
                    pass

    @pytest.mark.asyncio
    async def test_handshake_rejects_unknown_daemon_local_id(
        self,
        db_session: AsyncSession,
        fresh_ws_hub: DaemonWsHub,
    ) -> None:
        """A well-formed but unregistered daemon_local_id is rejected (4001)."""
        app = _build_app(db_session)
        with TestClient(app) as client:
            with pytest.raises(Exception):
                with client.websocket_connect(f"/api/daemon/ws?daemon_local_id={uuid.uuid4()}"):
                    pass

    @pytest.mark.asyncio
    async def test_handshake_rejects_malformed_daemon_local_id(
        self,
        db_session: AsyncSession,
        fresh_ws_hub: DaemonWsHub,
    ) -> None:
        """Non-UUID daemon_local_id → 4001 invalid."""
        app = _build_app(db_session)
        with TestClient(app) as client:
            with pytest.raises(Exception):
                with client.websocket_connect("/api/daemon/ws?daemon_local_id=not-a-uuid"):
                    pass


class TestPerDaemonConnectionKey:
    """task-06 acceptance: WS Hub connection count = online daemon entities."""

    @pytest.mark.asyncio
    async def test_connected_daemon_ids_property(
        self,
        fresh_ws_hub: DaemonWsHub,
    ) -> None:
        """connected_daemon_ids lists the connection keys (daemon_ids)."""
        hub = fresh_ws_hub
        did = uuid.uuid4()
        ws = AsyncMock()
        ws.close = AsyncMock()
        await hub.connect(did, ws)
        assert hub.connected_daemon_ids == [did]

    @pytest.mark.asyncio
    async def test_same_daemon_reconnect_evicts_old(
        self,
        fresh_ws_hub: DaemonWsHub,
    ) -> None:
        """design §9.3: same daemon_id reconnect → old socket closed (code=4000)."""
        hub = fresh_ws_hub
        did = uuid.uuid4()
        old_ws = AsyncMock()
        old_ws.close = AsyncMock()
        new_ws = AsyncMock()
        new_ws.close = AsyncMock()
        await hub.connect(did, old_ws)
        await hub.connect(did, new_ws)
        old_ws.close.assert_awaited_once()
        old_ws.close.assert_awaited_once_with(code=4000, reason="replaced")
        assert hub.connected_count == 1

    @pytest.mark.asyncio
    async def test_distinct_daemons_each_one_connection(
        self,
        fresh_ws_hub: DaemonWsHub,
    ) -> None:
        """Two daemon entities → two independent connections (acceptance 5)."""
        hub = fresh_ws_hub
        a, b = uuid.uuid4(), uuid.uuid4()
        await hub.connect(a, AsyncMock())
        await hub.connect(b, AsyncMock())
        assert hub.connected_count == 2
        assert set(hub.connected_daemon_ids) == {a, b}
