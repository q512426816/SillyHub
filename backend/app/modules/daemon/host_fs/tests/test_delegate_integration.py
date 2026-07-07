"""Integration test for HostFsDelegate daemon_id routing (no mock on the resolver).

This is the **钉死测试** for the runtime_id-vs-instance_id routing bug found in
verify (verify-result.md 关键 Bug). The unit tests in test_delegate.py inject a
fake ``daemon_id_resolver`` and only assert call structure — they cannot catch a
regression that routes the RPC on the wrong id. This test wires the REAL
:func:`resolve_daemon_instance_for_workspace` against a real DB (selected-schema
SQLite) and a real :class:`DaemonWsHub`, and proves the RPC lands on the
WebSocket registered under the daemon **instance** id — not the runtime id that
``workspace.daemon_runtime_id`` stores.

Bug recap: pre-fix ``_via_rpc`` passed ``workspace.daemon_runtime_id`` (a
``daemon_runtimes.id``) to ``ws_hub.send_rpc``, but ``_connections`` is keyed by
``daemon_instances.id``. With the bug, the RPC below would target ``runtime_id``
(which has no WS registered) → ``DaemonRuntimeOffline`` → degraded ``stat``
return ``{exists: False, ...}`` → the assertion on the scripted remote result
would fail loudly.
"""

from __future__ import annotations

import asyncio
import uuid
from collections.abc import AsyncGenerator
from datetime import UTC, datetime
from typing import Any

import pytest
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

pytestmark = pytest.mark.asyncio


# Fixed identity for the daemon INSTANCE (the WS routing key). Deliberately
# distinct from RUNTIME_ID below so a regression routing on the runtime id would
# miss the registered socket.
INSTANCE_ID = uuid.UUID("11111111-1111-1111-1111-111111111111")
RUNTIME_ID = uuid.UUID("22222222-2222-2222-2222-222222222222")
WORKSPACE_ID = uuid.UUID("33333333-3333-3333-3333-333333333333")
USER_ID = uuid.UUID("44444444-4444-4444-4444-444444444444")


def _selected_metadata() -> Any:
    """Mirror member_runtimes/tests/conftest — only the tables this test needs.

    Avoids the daemon_change_writes DDL bug (unquoted server_default on SQLite)
    that the full-metadata root conftest trips over.
    """
    from sqlalchemy import MetaData

    from app.models.base import BaseModel
    from app.modules.auth import model as _auth  # noqa: F401
    from app.modules.daemon import model as _daemon  # noqa: F401
    from app.modules.workspace import model as _ws  # noqa: F401
    from app.modules.workspace.member_runtimes import model as _wmr  # noqa: F401

    full = BaseModel.metadata
    needed = {
        "users",
        "daemon_instances",
        "daemon_runtimes",
        "workspaces",
        "workspace_member_runtimes",
    }
    meta = MetaData()
    for name in needed:
        if name in full.tables:
            full.tables[name].to_metadata(meta)
    return meta


@pytest.fixture()
async def session() -> AsyncGenerator[AsyncSession, None]:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
    meta = _selected_metadata()
    async with engine.begin() as conn:
        await conn.run_sync(meta.create_all)
    factory = async_sessionmaker(bind=engine, class_=AsyncSession, expire_on_commit=False)
    async with factory() as s:
        yield s
    await engine.dispose()


async def _seed_user(session: AsyncSession) -> None:
    from app.modules.auth.model import User

    session.add(
        User(
            id=USER_ID,
            username="router-tester",
            password_hash="x",
            status="active",
            created_at=datetime.now(UTC),
        )
    )
    await session.commit()


async def _seed_daemon(session: AsyncSession, *, online: bool = True) -> None:
    """DaemonInstance (INSTANCE_ID) + one DaemonRuntime (RUNTIME_ID) under it."""
    from app.modules.daemon.model import DaemonInstance, DaemonRuntime

    session.add(
        DaemonInstance(
            id=INSTANCE_ID,
            user_id=USER_ID,
            hostname="host-a",
            server_url="http://backend",
            status="online" if online else "offline",
        )
    )
    session.add(
        DaemonRuntime(
            id=RUNTIME_ID,
            daemon_instance_id=INSTANCE_ID,
            user_id=USER_ID,
            provider="claude",
            status="online",
        )
    )
    await session.commit()


async def _seed_workspace(
    session: AsyncSession,
    *,
    daemon_runtime_id: uuid.UUID | None,
    with_member_binding: bool,
) -> None:
    from app.modules.workspace.model import Workspace

    session.add(
        Workspace(
            id=WORKSPACE_ID,
            name="router-ws",
            slug="router-ws",
            root_path="/host/source",
            path_source="daemon-client",
            daemon_runtime_id=daemon_runtime_id,
            status="active",
            created_by=USER_ID,
        )
    )
    if with_member_binding:
        from app.modules.workspace.member_runtimes.model import (
            WorkspaceMemberRuntime,
        )

        session.add(
            WorkspaceMemberRuntime(
                workspace_id=WORKSPACE_ID,
                user_id=USER_ID,
                runtime_id=RUNTIME_ID,
                daemon_id=INSTANCE_ID,
                root_path="/host/source",
                path_source="daemon-client",
            )
        )
    await session.commit()


def _make_auto_responding_ws(hub: Any, result: dict[str, Any]) -> Any:
    """Mock WebSocket that records sent messages and echoes an RPC result back.

    Mirrors test_ws_rpc.py's real-hub envelope pattern: on ``daemon:rpc`` it
    schedules ``hub.resolve_rpc`` with a scripted ``result`` so ``send_rpc``
    completes successfully.
    """
    from unittest.mock import AsyncMock

    from app.modules.daemon.protocol import DAEMON_MSG_RPC

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
                    hub.resolve_rpc(
                        rpc_id,
                        {"rpc_id": rpc_id, "result": result},
                    )
                ),
            )

    ws.send_json = AsyncMock(side_effect=_send_json)
    return ws


async def _drive_stat(
    session: AsyncSession, workspace: Any, result: dict[str, Any]
) -> tuple[Any, Any]:
    """Build a real hub + auto-responding ws (under INSTANCE_ID) + delegate, run stat."""
    from app.modules.daemon.host_fs import HostFsDelegate, HostFsWsRpc
    from app.modules.daemon.ws_hub import DaemonWsHub

    hub = DaemonWsHub()
    ws = _make_auto_responding_ws(hub, result)
    await hub.connect(INSTANCE_ID, ws)

    delegate = HostFsDelegate(
        session=session,
        ws_hub=hub,
        ws_rpc=HostFsWsRpc(hub),
    )
    out = await delegate.stat(workspace, "/host/source/a.txt")
    return out, ws


async def test_new_link_member_binding_routes_to_instance_id(session: AsyncSession) -> None:
    """New-style workspace (member binding, daemon_runtime_id NULL).

    Resolver Step 1 (member binding daemon_id) → INSTANCE_ID. RPC must land on
    the WS registered under INSTANCE_ID. With the bug (routing on
    daemon_runtime_id = NULL) the delegate would have raised
    HostFsDelegateUnavailable before any RPC; with routing on a non-NULL runtime
    id it would miss the socket. This assertion only passes when routing uses
    the resolved instance id.
    """
    from app.modules.workspace.model import Workspace

    await _seed_user(session)
    await _seed_daemon(session)
    # New link: daemon_runtime_id NULL, binding carries daemon_id.
    await _seed_workspace(daemon_runtime_id=None, with_member_binding=True, session=session)

    workspace = await session.get(Workspace, WORKSPACE_ID)
    scripted = {"exists": True, "is_dir": False, "size": 128}
    out, ws = await _drive_stat(session, workspace, scripted)

    # The scripted remote result came back → RPC reached the daemon socket.
    assert out == scripted
    from app.modules.daemon.protocol import DAEMON_MSG_RPC

    rpc_msgs = [m for m in ws.sent_messages if m.get("type") == DAEMON_MSG_RPC]
    assert len(rpc_msgs) == 1
    params = rpc_msgs[0]["payload"]["params"]
    assert params["workspace_id"] == str(WORKSPACE_ID)


async def test_legacy_runtime_id_routes_to_instance_id(session: AsyncSession) -> None:
    """Legacy workspace (daemon_runtime_id set, no member binding).

    Resolver Step 2 (daemon_runtime_id → daemon_runtimes.daemon_instance_id)
    → INSTANCE_ID. Critically, RUNTIME_ID ≠ INSTANCE_ID, so a regression that
    routes on the raw daemon_runtime_id would try RUNTIME_ID (no socket) and
    degrade — the scripted result would NOT come back.
    """
    from app.modules.workspace.model import Workspace

    await _seed_user(session)
    await _seed_daemon(session)
    await _seed_workspace(daemon_runtime_id=RUNTIME_ID, with_member_binding=False, session=session)

    workspace = await session.get(Workspace, WORKSPACE_ID)
    scripted = {"exists": True, "is_dir": False, "size": 256}
    out, _ = await _drive_stat(session, workspace, scripted)

    assert out == scripted  # would be {"exists": False, ...} (degraded) under the bug


async def test_unbound_workspace_raises(session: AsyncSession) -> None:
    """No member binding AND no daemon_runtime_id → genuinely unbound → raises."""
    from app.modules.daemon.host_fs import (
        HostFsDelegate,
        HostFsDelegateUnavailable,
        HostFsWsRpc,
    )
    from app.modules.daemon.ws_hub import DaemonWsHub
    from app.modules.workspace.model import Workspace

    await _seed_user(session)
    await _seed_daemon(session)
    await _seed_workspace(daemon_runtime_id=None, with_member_binding=False, session=session)

    workspace = await session.get(Workspace, WORKSPACE_ID)
    hub = DaemonWsHub()
    delegate = HostFsDelegate(session=session, ws_hub=hub, ws_rpc=HostFsWsRpc(hub))
    with pytest.raises(HostFsDelegateUnavailable) as exc:
        await delegate.stat(workspace, "/host/x")
    assert "no bound daemon" in str(exc.value)
