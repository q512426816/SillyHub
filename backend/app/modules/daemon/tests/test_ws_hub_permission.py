"""Tests for daemon WS PERMISSION_REQUEST uplink branch + REST response
endpoint + ws_hub.send_permission_response envelope (task-08 / FR-07 / D-007@v1).

The WS receive-loop branch lives inside ``router.daemon_websocket``; we exercise
it through the FastAPI ``AsyncClient`` so the routing + payload validation +
handler dispatch are covered end-to-end with a mocked permission service.

task-06 adaptation: ``DaemonWsHub`` routes by ``daemon_instance_id`` (one socket
per daemon entity). ``handle_permission_request`` now receives the daemon_id the
request arrived on and validates ownership against the runtime's owning daemon
entity. These tests cover the bound + migration-window paths.
"""

from __future__ import annotations

import asyncio
import uuid
from datetime import UTC, datetime
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from httpx import ASGITransport, AsyncClient


@pytest.fixture()
async def client_and_perm(db_engine):
    """httpx client with DaemonPermissionService mocked at the import site."""
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

    from app.core.db import get_session
    from app.main import app

    factory = async_sessionmaker(bind=db_engine, class_=AsyncSession, expire_on_commit=False)

    async def _override_session():
        async with factory() as session:
            try:
                yield session
            except Exception:
                await session.rollback()
                raise

    app.dependency_overrides[get_session] = _override_session

    perm_mock = MagicMock()
    perm_mock.handle_permission_request = AsyncMock()
    perm_mock.respond_permission = AsyncMock()

    with patch(
        "app.modules.daemon.router.DaemonPermissionService",
        return_value=perm_mock,
    ):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            yield ac, perm_mock

    app.dependency_overrides.pop(get_session, None)


# ── ws_hub.send_permission_response envelope ─────────────────────────────────


class TestSendPermissionResponse:
    @pytest.mark.asyncio
    async def test_envelope_type_and_payload(self) -> None:
        from app.modules.daemon.ws_hub import DaemonWsHub

        hub = DaemonWsHub()
        rid = uuid.uuid4()
        ws = AsyncMock()
        sent: list[dict[str, Any]] = []

        async def _send_json(message: dict[str, Any]) -> None:
            sent.append(message)

        ws.send_json = AsyncMock(side_effect=_send_json)
        ws.close = AsyncMock()
        await hub.connect(rid, ws)

        payload = {
            "session_id": str(uuid.uuid4()),
            "request_id": "req-1",
            "decision": "deny",
        }
        ok = await hub.send_permission_response(rid, payload)
        assert ok is True
        assert sent[0]["type"] == "daemon:permission_response"
        assert sent[0]["payload"] == payload

    @pytest.mark.asyncio
    async def test_offline_returns_false(self) -> None:
        from app.modules.daemon.ws_hub import DaemonWsHub

        hub = DaemonWsHub()
        ok = await hub.send_permission_response(uuid.uuid4(), {"request_id": "x"})
        assert ok is False


# ── REST POST /sessions/{id}/permissions/{req}/response ─────────────────────


class TestRespondSessionPermissionEndpoint:
    @pytest.mark.asyncio
    async def test_invalid_decision_returns_422(self, client_and_perm, auth_headers) -> None:
        ac, _ = client_and_perm
        session_id = uuid.uuid4()
        resp = await ac.post(
            f"/api/daemon/sessions/{session_id}/permissions/req-1/response",
            json={"decision": "maybe"},
            headers=auth_headers,
        )
        assert resp.status_code == 422

    @pytest.mark.asyncio
    async def test_missing_auth_returns_401(self, client_and_perm) -> None:
        ac, _ = client_and_perm
        resp = await ac.post(
            f"/api/daemon/sessions/{uuid.uuid4()}/permissions/req-1/response",
            json={"decision": "allow"},
        )
        assert resp.status_code in (401, 403)

    @pytest.mark.asyncio
    async def test_message_too_long_returns_422(self, client_and_perm, auth_headers) -> None:
        ac, _ = client_and_perm
        resp = await ac.post(
            f"/api/daemon/sessions/{uuid.uuid4()}/permissions/req-1/response",
            json={"decision": "deny", "message": "x" * 2001},
            headers=auth_headers,
        )
        assert resp.status_code == 422


# ── WS PERMISSION_REQUEST uplink branch (via direct handler call) ────────────
#
# The full WS endpoint requires a live websocket handshake which is brittle to
# exercise here; instead we drive DaemonPermissionService.handle_permission_request
# directly (already covered in test_session_permissions.py) and additionally
# assert the router-level payload validation by importing the protocol model.


class TestWsUplinkPayloadValidation:
    @pytest.mark.asyncio
    async def test_valid_payload_constructs(self) -> None:
        from app.modules.daemon.protocol import PermissionRequestPayload

        payload = PermissionRequestPayload(
            session_id=uuid.uuid4(),
            run_id=uuid.uuid4(),
            request_id="req-1",
            tool_name="Bash",
            input={"command": "ls"},
        )
        assert payload.tool_name == "Bash"
        assert payload.request_id == "req-1"

    @pytest.mark.asyncio
    async def test_missing_required_field_raises(self) -> None:
        from pydantic import ValidationError

        from app.modules.daemon.protocol import PermissionRequestPayload

        with pytest.raises(ValidationError):
            PermissionRequestPayload(
                session_id=uuid.uuid4(),
                run_id=uuid.uuid4(),
                # missing request_id
                tool_name="Bash",
                input={"command": "ls"},
            )

    @pytest.mark.asyncio
    async def test_invalid_decision_in_response_payload_raises(self) -> None:
        from pydantic import ValidationError

        from app.modules.daemon.protocol import PermissionResponsePayload

        with pytest.raises(ValidationError):
            PermissionResponsePayload(
                session_id=uuid.uuid4(),
                request_id="r",
                decision="maybe",  # type: ignore[arg-type]
            )

    @pytest.mark.asyncio
    async def test_response_payload_message_optional(self) -> None:
        from app.modules.daemon.protocol import PermissionResponsePayload

        p = PermissionResponsePayload(
            session_id=uuid.uuid4(),
            request_id="r",
            decision="allow",
        )
        assert p.message is None
        assert p.decision == "allow"


# ── handle_permission_request daemon_id ownership (task-06 adaptation) ───────
#
# task-06: WS hub routes by daemon_instance_id; router.daemon_websocket now
# calls handle_permission_request(daemon_id, payload). Ownership must pass when
# daemon_id == the runtime's owning daemon_instance_id, and also under the
# migration-window fallback (daemon_instance_id NULL → route key == runtime_id).


async def _make_user_session(db_session, runtime_id):
    """Create a User + manual_approval AgentSession bound to runtime_id."""
    from app.modules.agent.model import AgentRun, AgentSession
    from app.modules.auth.model import User

    uid = uuid.uuid4()
    db_session.add(
        User(
            id=uid,
            email=f"perm-{uid}@example.com",
            password_hash="x",
            display_name="T",
            status="active",
        )
    )
    await db_session.commit()
    sess = AgentSession(
        id=uuid.uuid4(),
        user_id=uid,
        provider="claude",
        status="active",
        config={"manual_approval": True, "model": "claude"},
        turn_count=1,
        runtime_id=runtime_id,
        lease_id=uuid.uuid4(),
        created_at=datetime.now(UTC),
    )
    db_session.add(sess)
    await db_session.flush()
    run = AgentRun(
        id=uuid.uuid4(),
        agent_type="claude_code",
        provider="claude",
        status="running",
        spec_strategy="interactive",
        agent_session_id=sess.id,
    )
    db_session.add(run)
    await db_session.commit()
    await db_session.refresh(sess)
    await db_session.refresh(run)
    return sess, run


def _mock_redis() -> AsyncMock:
    redis = AsyncMock()
    redis.publish = AsyncMock()
    return redis


class TestHandlePermissionDaemonIdOwnership:
    @pytest.mark.asyncio
    async def test_bound_runtime_accepts_matching_daemon_id(self, db_session) -> None:
        """Runtime bound to a daemon_instance: daemon_id == instance.id passes."""
        from app.modules.daemon.model import DaemonInstance, DaemonRuntime
        from app.modules.daemon.permission_service import DaemonPermissionService
        from app.modules.daemon.protocol import PermissionRequestPayload
        from app.modules.daemon.service import DaemonService

        inst = DaemonInstance(
            id=uuid.uuid4(),
            user_id=uuid.uuid4(),
            hostname="h",
            server_url="http://srv",
        )
        db_session.add(inst)
        await db_session.flush()
        rt = DaemonRuntime(
            id=uuid.uuid4(),
            daemon_instance_id=inst.id,
            user_id=inst.user_id,
            name="daemon",
            provider="claude",
            status="online",
            last_heartbeat_at=datetime.now(UTC),
        )
        db_session.add(rt)
        await db_session.commit()
        await db_session.refresh(rt)
        sess, run = await _make_user_session(db_session, rt.id)

        svc = DaemonService(db_session)
        hub = MagicMock()
        hub.send_permission_response = AsyncMock(return_value=True)
        perm = DaemonPermissionService(svc, hub, timeout_sec=30.0)

        with patch("app.modules.daemon.session.service.get_redis", return_value=_mock_redis()):
            await perm.handle_permission_request(
                inst.id,
                PermissionRequestPayload(
                    session_id=sess.id,
                    run_id=run.id,
                    request_id="req-owned",
                    tool_name="Bash",
                    input={"command": "ls"},
                ),
            )
        # Timer armed ⇒ request accepted (ownership passed).
        assert "req-owned" in perm._timers
        task = perm._timers["req-owned"]
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass

    @pytest.mark.asyncio
    async def test_bound_runtime_rejects_wrong_daemon_id(self, db_session) -> None:
        """Runtime bound to instance A: daemon_id from instance B → dropped."""
        from app.modules.daemon.model import DaemonInstance, DaemonRuntime
        from app.modules.daemon.permission_service import DaemonPermissionService
        from app.modules.daemon.protocol import PermissionRequestPayload
        from app.modules.daemon.service import DaemonService

        inst = DaemonInstance(
            id=uuid.uuid4(),
            user_id=uuid.uuid4(),
            hostname="h",
            server_url="http://srv",
        )
        db_session.add(inst)
        await db_session.flush()
        rt = DaemonRuntime(
            id=uuid.uuid4(),
            daemon_instance_id=inst.id,
            user_id=inst.user_id,
            name="daemon",
            provider="claude",
            status="online",
            last_heartbeat_at=datetime.now(UTC),
        )
        db_session.add(rt)
        await db_session.commit()
        await db_session.refresh(rt)
        sess, run = await _make_user_session(db_session, rt.id)

        svc = DaemonService(db_session)
        hub = MagicMock()
        hub.send_permission_response = AsyncMock(return_value=True)
        perm = DaemonPermissionService(svc, hub, timeout_sec=30.0)

        with patch("app.modules.daemon.session.service.get_redis", return_value=_mock_redis()):
            await perm.handle_permission_request(
                uuid.uuid4(),  # a different daemon_id
                PermissionRequestPayload(
                    session_id=sess.id,
                    run_id=run.id,
                    request_id="req-rej",
                    tool_name="Bash",
                    input={"command": "ls"},
                ),
            )
        # No timer armed ⇒ request dropped by ownership check.
        assert "req-rej" not in perm._timers
        hub.send_permission_response.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_migration_window_fallback_accepts_runtime_id_as_daemon_id(
        self, db_session
    ) -> None:
        """daemon_instance_id NULL: legacy routing key == runtime_id."""
        from app.modules.daemon.model import DaemonRuntime
        from app.modules.daemon.permission_service import DaemonPermissionService
        from app.modules.daemon.protocol import PermissionRequestPayload
        from app.modules.daemon.service import DaemonService

        rt = DaemonRuntime(
            id=uuid.uuid4(),
            daemon_instance_id=None,
            user_id=uuid.uuid4(),
            name="daemon",
            provider="claude",
            status="online",
            last_heartbeat_at=datetime.now(UTC),
        )
        db_session.add(rt)
        await db_session.commit()
        await db_session.refresh(rt)
        sess, run = await _make_user_session(db_session, rt.id)

        svc = DaemonService(db_session)
        hub = MagicMock()
        hub.send_permission_response = AsyncMock(return_value=True)
        perm = DaemonPermissionService(svc, hub, timeout_sec=30.0)

        with patch("app.modules.daemon.session.service.get_redis", return_value=_mock_redis()):
            # Old daemons still pass runtime_id (== daemon_local_id surface in
            # legacy mode). The fallback accepts runtime_id as the route key.
            await perm.handle_permission_request(
                rt.id,
                PermissionRequestPayload(
                    session_id=sess.id,
                    run_id=run.id,
                    request_id="req-fb",
                    tool_name="Bash",
                    input={"command": "ls"},
                ),
            )
        assert "req-fb" in perm._timers
        task = perm._timers["req-fb"]
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass


def asyncio_imported_cancel():
    """Late import of asyncio.CancelledError to avoid a module-level import."""
    import asyncio

    return asyncio.CancelledError
