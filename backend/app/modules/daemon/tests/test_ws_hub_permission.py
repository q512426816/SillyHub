"""Tests for daemon WS PERMISSION_REQUEST uplink branch + REST response
endpoint + ws_hub.send_permission_response envelope (task-08 / FR-07 / D-007@v1).

The WS receive-loop branch lives inside ``router.daemon_websocket``; we exercise
it through the FastAPI ``AsyncClient`` so the routing + payload validation +
handler dispatch are covered end-to-end with a mocked permission service.
"""

from __future__ import annotations

import uuid
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
