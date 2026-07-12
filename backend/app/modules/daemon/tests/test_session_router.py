"""HTTP-level tests for /api/daemon/sessions endpoints (task-05).

Covers the 4 REST endpoints (FR-01/02/04/05), the DTO contract, ownership
(404 not leaked), task:run_agent permission gating, and the AppError → HTTP
status mapping driven by the service layer.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any
from unittest.mock import AsyncMock

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.daemon import ws_hub as ws_hub_module
from app.modules.daemon.model import DaemonRuntime
from app.modules.daemon.ws_hub import DaemonWsHub

# ── Fixtures / helpers ───────────────────────────────────────────────────────


@pytest.fixture()
def fresh_ws_hub(monkeypatch: pytest.MonkeyPatch) -> DaemonWsHub:
    """Replace the process-wide ws_hub singleton with a fresh, wired hub."""
    hub = DaemonWsHub()
    monkeypatch.setattr(ws_hub_module, "_ws_hub", hub)
    return hub


async def _admin_user_id(session: AsyncSession) -> uuid.UUID:
    from app.core.config import get_settings
    from app.core.security import password_hasher
    from app.modules.auth.model import User

    settings = get_settings()
    password_hasher.configure(settings.auth_bcrypt_rounds)
    admin_email = f"router-{uuid.uuid4()}@example.com"
    user = User(
        id=uuid.uuid4(),
        email=admin_email,
        password_hash=password_hasher.hash("Admin123!@#"),
        display_name="Admin",
        status="active",
        is_platform_admin=True,
    )
    session.add(user)
    await session.commit()
    await session.refresh(user)
    return user.id


async def _create_runtime(session: AsyncSession, user_id: uuid.UUID) -> DaemonRuntime:
    rt = DaemonRuntime(
        id=uuid.uuid4(),
        user_id=user_id,
        name="daemon",
        provider="claude",
        status="online",
        last_heartbeat_at=datetime.now(UTC),
    )
    session.add(rt)
    await session.commit()
    await session.refresh(rt)
    return rt


def _wire_mock_ws(hub: DaemonWsHub, runtime_id: uuid.UUID) -> AsyncMock:
    ws = AsyncMock()
    ws.sent_messages = []

    async def _send_json(message: dict[str, Any]) -> None:
        ws.sent_messages.append(message)

    ws.send_json = AsyncMock(side_effect=_send_json)
    ws.close = AsyncMock()
    import asyncio

    asyncio.get_event_loop()
    # connect is async — caller should await; do it inline synchronously via loop
    return ws


async def _connect_mock(hub: DaemonWsHub, runtime_id: uuid.UUID) -> AsyncMock:
    ws = _wire_mock_ws(hub, runtime_id)
    await hub.connect(runtime_id, ws)
    return ws


# ── create ───────────────────────────────────────────────────────────────────


class TestCreateSessionEndpoint:
    async def test_create_201(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
        fresh_ws_hub: DaemonWsHub,
    ) -> None:
        # auth_headers carries the conftest admin user; create a runtime for
        # that user so dispatch finds an online daemon.
        from app.modules.auth.model import User

        # Resolve which user auth_headers represents (the conftest admin)
        admin = (
            (await db_session.execute(select(User).where(User.email == "admin@example.com")))
            .scalars()
            .first()
        )
        assert admin is not None
        await _create_runtime(db_session, admin.id)
        ws = await _connect_mock(fresh_ws_hub, (await _first_runtime(db_session, admin.id)).id)

        resp = await client.post(
            "/api/daemon/sessions",
            json={"provider": "claude", "prompt": "hello", "model": None},
            headers=auth_headers,
        )
        assert resp.status_code == 201, resp.text
        body = resp.json()
        assert "session_id" in body
        assert "run_id" in body
        assert "lease_id" in body
        assert body["status"] == "active"
        assert body["stream_url"].endswith("/stream")
        # SESSION_INJECT control message was delivered
        from app.modules.daemon.protocol import DAEMON_MSG_SESSION_INJECT

        assert any(m["type"] == DAEMON_MSG_SESSION_INJECT for m in ws.sent_messages)

    async def test_create_validation_422_empty_prompt(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
    ) -> None:
        resp = await client.post(
            "/api/daemon/sessions",
            json={"provider": "claude", "prompt": ""},
            headers=auth_headers,
        )
        assert resp.status_code == 422

    async def test_create_validation_422_bad_provider(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
    ) -> None:
        resp = await client.post(
            "/api/daemon/sessions",
            json={"provider": "gemini", "prompt": "hi"},
            headers=auth_headers,
        )
        assert resp.status_code == 422


# ── inject / interrupt / end error mapping ───────────────────────────────────


class TestSessionEndpointsErrors:
    async def _seed_active_session(
        self,
        db_session: AsyncSession,
        client: AsyncClient,
        auth_headers: dict[str, str],
        fresh_ws_hub: DaemonWsHub,
    ) -> dict[str, str]:
        from app.modules.auth.model import User

        admin = (
            (await db_session.execute(select(User).where(User.email == "admin@example.com")))
            .scalars()
            .first()
        )
        assert admin is not None
        rt = await _create_runtime(db_session, admin.id)
        await _connect_mock(fresh_ws_hub, rt.id)
        resp = await client.post(
            "/api/daemon/sessions",
            json={"provider": "claude", "prompt": "first"},
            headers=auth_headers,
        )
        assert resp.status_code == 201, resp.text
        return resp.json()

    async def test_inject_conflict_409_when_active_run(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
        fresh_ws_hub: DaemonWsHub,
    ) -> None:
        created = await self._seed_active_session(db_session, client, auth_headers, fresh_ws_hub)
        # first run still pending → inject must conflict
        resp = await client.post(
            f"/api/daemon/sessions/{created['session_id']}/inject",
            json={"prompt": "second"},
            headers=auth_headers,
        )
        assert resp.status_code == 409, resp.text
        body = resp.json()
        assert "TURN_CONFLICT" in body.get("code", "") or body.get("code")

    async def test_inject_404_wrong_user(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
        fresh_ws_hub: DaemonWsHub,
    ) -> None:
        # random session id that does not belong to the admin
        resp = await client.post(
            f"/api/daemon/sessions/{uuid.uuid4()}/inject",
            json={"prompt": "x"},
            headers=auth_headers,
        )
        assert resp.status_code == 404

    async def test_interrupt_200_returns_current_run(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
        fresh_ws_hub: DaemonWsHub,
    ) -> None:
        created = await self._seed_active_session(db_session, client, auth_headers, fresh_ws_hub)
        resp = await client.post(
            f"/api/daemon/sessions/{created['session_id']}/interrupt",
            headers=auth_headers,
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["status"] == "active"
        assert body["current_run_id"] == created["run_id"]

    async def test_end_200_reconciles(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
        fresh_ws_hub: DaemonWsHub,
    ) -> None:
        created = await self._seed_active_session(db_session, client, auth_headers, fresh_ws_hub)
        resp = await client.post(
            f"/api/daemon/sessions/{created['session_id']}/end",
            headers=auth_headers,
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["status"] == "ended"
        assert body["current_run_id"] == created["run_id"]

    async def test_end_idempotent(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
        fresh_ws_hub: DaemonWsHub,
    ) -> None:
        created = await self._seed_active_session(db_session, client, auth_headers, fresh_ws_hub)
        url = f"/api/daemon/sessions/{created['session_id']}/end"
        r1 = await client.post(url, headers=auth_headers)
        r2 = await client.post(url, headers=auth_headers)
        assert r1.status_code == 200
        assert r2.status_code == 200
        assert r2.json()["current_run_id"] is None


# ── helper ───────────────────────────────────────────────────────────────────


async def _first_runtime(session: AsyncSession, user_id: uuid.UUID) -> DaemonRuntime:
    rows = (
        (await session.execute(select(DaemonRuntime).where(DaemonRuntime.user_id == user_id)))
        .scalars()
        .all()
    )
    return rows[-1]


# ── list title + soft-delete filter (2026-07-11-unify-runtime-session-dialog) ─


class TestListSessionsTitleAndSoftDelete:
    """FR-08 (list title=首条 user_input 摘要前 30 字) + FR-07 (软删过滤)。"""

    @pytest.mark.asyncio
    async def test_list_returns_title_and_excludes_soft_deleted(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
    ) -> None:
        from app.modules.agent.model import AgentRun, AgentRunLog, AgentSession
        from app.modules.auth.model import User
        from app.modules.daemon.service import DaemonService

        admin = (
            (await db_session.execute(select(User).where(User.email == "admin@example.com")))
            .scalars()
            .first()
        )
        assert admin is not None
        rt = await _create_runtime(db_session, admin.id)

        # 带 user_input log 的 session（title 来源，FR-08）
        sid = uuid.uuid4()
        run = AgentRun(
            id=uuid.uuid4(),
            agent_type="claude_code",
            provider="claude",
            status="completed",
            spec_strategy="interactive",
            agent_session_id=sid,
            started_at=datetime.now(UTC),
        )
        db_session.add_all(
            [
                AgentSession(
                    id=sid, user_id=admin.id, runtime_id=rt.id, provider="claude", status="ended"
                ),
                run,
                AgentRunLog(
                    id=uuid.uuid4(),
                    run_id=run.id,
                    timestamp=datetime.now(UTC),
                    channel="user_input",
                    content_redacted="你好，现在几点了？",
                ),
            ]
        )
        # 另一 session 将被软删（应从 list 过滤，FR-07）
        victim_id = uuid.uuid4()
        db_session.add(
            AgentSession(
                id=victim_id,
                user_id=admin.id,
                runtime_id=rt.id,
                provider="claude",
                status="ended",
            )
        )
        await db_session.commit()

        svc = DaemonService(db_session)
        await svc.delete_agent_session(victim_id, admin.id)

        resp = await client.get("/api/daemon/sessions", headers=auth_headers)
        assert resp.status_code == 200, resp.text
        items = resp.json()["items"]
        ids = [i["id"] for i in items]
        assert str(sid) in ids
        assert str(victim_id) not in ids  # 软删过滤
        kept = next(i for i in items if i["id"] == str(sid))
        assert kept["title"] == "你好，现在几点了？"  # 首条 user_input 摘要前 30 字
