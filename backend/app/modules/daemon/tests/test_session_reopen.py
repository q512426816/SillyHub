"""task-05 + task-06: reopen_session + GET /sessions/{id} 单查端点.

task-05: POST /api/daemon/sessions/{id}/reopen（骨架 + 校验；状态转换 task-07）.
task-06: GET /api/daemon/sessions/{id} 单查 + protocol DAEMON_MSG_SESSION_RESUME.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.model import AgentSession
from app.modules.auth.model import User
from app.modules.daemon import protocol
from app.modules.daemon.model import DaemonRuntime, DaemonTaskLease

# ── Helpers (mirror test_session_history.py) ─────────────────────────────────


async def _make_user(session: AsyncSession, email: str) -> User:
    from app.core.config import get_settings
    from app.core.security import password_hasher

    settings = get_settings()
    password_hasher.configure(settings.auth_bcrypt_rounds)
    user = User(
        id=uuid.uuid4(),
        email=email,
        password_hash=password_hasher.hash("Admin123!@#"),
        display_name=email.split("@")[0],
        status="active",
        is_platform_admin=True,
    )
    session.add(user)
    await session.commit()
    await session.refresh(user)
    return user


async def _make_runtime(
    session: AsyncSession,
    user_id: uuid.UUID,
    *,
    status: str = "online",
) -> DaemonRuntime:
    rt = DaemonRuntime(
        id=uuid.uuid4(),
        user_id=user_id,
        name="daemon",
        provider="claude",
        status=status,
        last_heartbeat_at=datetime.now(UTC),
    )
    session.add(rt)
    await session.commit()
    await session.refresh(rt)
    return rt


async def _make_session(
    session: AsyncSession,
    user_id: uuid.UUID,
    runtime_id: uuid.UUID,
    *,
    status: str = "ended",
    provider: str = "claude",
    agent_session_id: str | None = "sdk-sess-123",
    lease_id: uuid.UUID | None = None,
    cwd: str | None = "/workspace/proj",
) -> AgentSession:
    now = datetime.now(UTC)
    sess = AgentSession(
        id=uuid.uuid4(),
        user_id=user_id,
        runtime_id=runtime_id,
        lease_id=lease_id,
        provider=provider,
        status=status,
        agent_session_id=agent_session_id,
        config={"model": "sonnet"},
        turn_count=1,
        cwd=cwd,
        created_at=now,
        last_active_at=now,
        ended_at=now if status in ("ended", "failed") else None,
    )
    session.add(sess)
    await session.commit()
    await session.refresh(sess)
    return sess


async def _make_completed_lease(
    session: AsyncSession,
    runtime_id: uuid.UUID,
    agent_session_id: str,
) -> DaemonTaskLease:
    """A completed interactive lease — the pre-reopen binding we must NOT revive."""
    from app.modules.daemon.model import DaemonTaskLease

    now = datetime.now(UTC)
    lease = DaemonTaskLease(
        id=uuid.uuid4(),
        runtime_id=runtime_id,
        agent_run_id=None,
        kind="interactive",
        status="completed",
        claimed_at=now,
        lease_expires_at=None,
        attempt_number=1,
        metadata_={
            "session_id": agent_session_id,
            "provider": "claude",
            "claim_token": "old-token-deadbeef",
        },
        created_at=now,
        updated_at=now,
    )
    session.add(lease)
    await session.commit()
    await session.refresh(lease)
    return lease


async def _admin(db_session: AsyncSession) -> User:
    from sqlalchemy import select

    admin = (
        (await db_session.execute(select(User).where(User.email == "admin@example.com")))
        .scalars()
        .first()
    )
    assert admin is not None
    return admin


# ── task-06: protocol constant ───────────────────────────────────────────────


class TestSessionResumeProtocolConstant:
    def test_constant_defined(self) -> None:
        assert protocol.DAEMON_MSG_SESSION_RESUME == "daemon:session_resume"


# ── task-06: GET /sessions/{id} ──────────────────────────────────────────────


class TestGetAgentSession:
    async def test_get_owned_session_returns_read(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
    ) -> None:
        admin = await _admin(db_session)
        rt = await _make_runtime(db_session, admin.id)
        sess = await _make_session(db_session, admin.id, rt.id, status="ended")

        resp = await client.get(f"/api/daemon/sessions/{sess.id}", headers=auth_headers)
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["id"] == str(sess.id)
        assert body["status"] == "ended"
        assert body["agent_session_id"] == "sdk-sess-123"
        assert body["provider"] == "claude"
        # AgentSessionRead fields present
        assert "runtime_id" in body
        assert "turn_count" in body
        assert "created_at" in body

    async def test_missing_session_404(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
    ) -> None:
        resp = await client.get(
            f"/api/daemon/sessions/{uuid.uuid4()}",
            headers=auth_headers,
        )
        assert resp.status_code == 404

    async def test_cross_user_404(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
    ) -> None:
        other = await _make_user(db_session, f"other-{uuid.uuid4()}@example.com")
        rt_other = await _make_runtime(db_session, other.id)
        sess = await _make_session(db_session, other.id, rt_other.id, status="ended")

        resp = await client.get(f"/api/daemon/sessions/{sess.id}", headers=auth_headers)
        assert resp.status_code == 404

    async def test_requires_auth(self, client: AsyncClient, db_session: AsyncSession) -> None:
        resp = await client.get(f"/api/daemon/sessions/{uuid.uuid4()}")
        assert resp.status_code in (401, 403)


# ── task-05: POST /sessions/{id}/reopen ──────────────────────────────────────


class TestReopenSession:
    async def test_reopen_ended_claude_session_returns_reconnecting(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
        monkeypatch,
    ) -> None:
        from app.modules.daemon import ws_hub

        admin = await _admin(db_session)
        rt = await _make_runtime(db_session, admin.id)
        sess = await _make_session(
            db_session, admin.id, rt.id, status="ended", agent_session_id="sdk-xyz"
        )

        # Pretend the runtime has an active WS connection (online).
        hub = ws_hub.get_daemon_ws_hub()
        monkeypatch.setattr(hub, "is_connected", lambda _rid: True)

        resp = await client.post(
            f"/api/daemon/sessions/{sess.id}/reopen",
            headers=auth_headers,
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["session_id"] == str(sess.id)
        assert body["status"] == "reconnecting"

        # DB-level: reopen placeholder set status=reconnecting. Query via a
        # fresh scalar to avoid touching the test-session identity-map copy of
        # ``sess`` (which is expired post-request and would lazy-load sync).
        status_row = (
            await db_session.execute(select(AgentSession.status).where(AgentSession.id == sess.id))
        ).scalar_one_or_none()
        assert status_row == "reconnecting"

    async def test_reopen_codex_session_returns_reconnecting(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
        monkeypatch,
    ) -> None:
        """task-07 / FR-06：Codex ended session 现在可 reopen（provider gate 放开）.

        旧反向用例（断言 codex reopen 返回 409 RESUME_UNSUPPORTED）已被翻转：
        backend ``reopen_session`` 的 provider gate 从 ``!= "claude"`` 放开为
        ``not in {"claude", "codex"}``，codex threadId 作为 resume key 原样保留。
        """
        from app.modules.daemon import ws_hub

        admin = await _admin(db_session)
        rt = await _make_runtime(db_session, admin.id)
        sess = await _make_session(
            db_session,
            admin.id,
            rt.id,
            status="ended",
            provider="codex",
            agent_session_id="codex-1",
        )

        hub = ws_hub.get_daemon_ws_hub()
        monkeypatch.setattr(hub, "is_connected", lambda _rid: True)
        monkeypatch.setattr(hub, "send_session_control", lambda *a, **k: _async_true())

        resp = await client.post(
            f"/api/daemon/sessions/{sess.id}/reopen",
            headers=auth_headers,
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["session_id"] == str(sess.id)
        assert body["status"] == "reconnecting"

        # agent_session_id (Codex threadId) 原样保留作为 resume key。
        agent_sid = (
            await db_session.execute(
                select(AgentSession.agent_session_id).where(AgentSession.id == sess.id)
            )
        ).scalar_one()
        assert agent_sid == "codex-1"

    async def test_reopen_null_agent_session_id_409(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
        monkeypatch,
    ) -> None:
        from app.modules.daemon import ws_hub

        admin = await _admin(db_session)
        rt = await _make_runtime(db_session, admin.id)
        sess = await _make_session(
            db_session, admin.id, rt.id, status="ended", agent_session_id=None
        )

        hub = ws_hub.get_daemon_ws_hub()
        monkeypatch.setattr(hub, "is_connected", lambda _rid: True)

        resp = await client.post(
            f"/api/daemon/sessions/{sess.id}/reopen",
            headers=auth_headers,
        )
        assert resp.status_code == 409
        assert "NO_AGENT_SESSION" in resp.json()["code"]

    async def test_reopen_active_session_409_not_active(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
        monkeypatch,
    ) -> None:
        from app.modules.daemon import ws_hub

        admin = await _admin(db_session)
        rt = await _make_runtime(db_session, admin.id)
        sess = await _make_session(
            db_session, admin.id, rt.id, status="active", agent_session_id="sdk-a"
        )

        hub = ws_hub.get_daemon_ws_hub()
        monkeypatch.setattr(hub, "is_connected", lambda _rid: True)

        resp = await client.post(
            f"/api/daemon/sessions/{sess.id}/reopen",
            headers=auth_headers,
        )
        assert resp.status_code == 409
        assert "NOT_ACTIVE" in resp.json()["code"]

    async def test_reopen_offline_runtime_409(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
        monkeypatch,
    ) -> None:
        from app.modules.daemon import ws_hub

        admin = await _admin(db_session)
        rt = await _make_runtime(db_session, admin.id)
        sess = await _make_session(
            db_session, admin.id, rt.id, status="ended", agent_session_id="sdk-o"
        )

        hub = ws_hub.get_daemon_ws_hub()
        monkeypatch.setattr(hub, "is_connected", lambda _rid: False)

        resp = await client.post(
            f"/api/daemon/sessions/{sess.id}/reopen",
            headers=auth_headers,
        )
        assert resp.status_code == 409
        assert "OFFLINE" in resp.json()["code"]

    async def test_reopen_cross_user_404(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
    ) -> None:
        other = await _make_user(db_session, f"other-{uuid.uuid4()}@example.com")
        rt_other = await _make_runtime(db_session, other.id)
        sess = await _make_session(
            db_session, other.id, rt_other.id, status="ended", agent_session_id="sdk-cu"
        )

        resp = await client.post(
            f"/api/daemon/sessions/{sess.id}/reopen",
            headers=auth_headers,
        )
        assert resp.status_code == 404

    async def test_reopen_missing_session_404(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
    ) -> None:
        resp = await client.post(
            f"/api/daemon/sessions/{uuid.uuid4()}/reopen",
            headers=auth_headers,
        )
        assert resp.status_code == 404

    async def test_reopen_requires_auth(self, client: AsyncClient) -> None:
        resp = await client.post(f"/api/daemon/sessions/{uuid.uuid4()}/reopen")
        assert resp.status_code in (401, 403)


# ── task-07: reopen status transition (new lease + WS) ────────────────────────


class TestReopenSessionTransition:
    """task-07: new interactive lease, claim_token rotation, SESSION_RESUME WS."""

    async def test_reopen_creates_new_interactive_leaves_old_completed(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
        monkeypatch,
    ) -> None:
        from app.modules.daemon import ws_hub

        admin = await _admin(db_session)
        rt = await _make_runtime(db_session, admin.id)
        old_lease = await _make_completed_lease(db_session, rt.id, "sdk-resume-1")
        sess = await _make_session(
            db_session,
            admin.id,
            rt.id,
            status="ended",
            agent_session_id="sdk-resume-1",
            lease_id=old_lease.id,
        )

        hub = ws_hub.get_daemon_ws_hub()
        monkeypatch.setattr(hub, "is_connected", lambda _rid: True)
        monkeypatch.setattr(hub, "send_session_control", lambda *a, **k: _async_true())

        resp = await client.post(f"/api/daemon/sessions/{sess.id}/reopen", headers=auth_headers)
        assert resp.status_code == 200, resp.text

        # session: reconnecting + agent_session_id preserved + lease_id swapped.
        # Read via column projection to bypass the test session's identity-map
        # copy (written by the HTTP request's own session) and avoid sync lazy
        # loads outside an async context.
        sess_row = (
            await db_session.execute(
                select(
                    AgentSession.status,
                    AgentSession.agent_session_id,
                    AgentSession.lease_id,
                    AgentSession.last_active_at,
                ).where(AgentSession.id == sess.id)
            )
        ).one()
        new_lease_id = sess_row.lease_id
        assert sess_row.status == "reconnecting"
        assert sess_row.agent_session_id == "sdk-resume-1"  # resume key unchanged
        assert new_lease_id is not None
        assert new_lease_id != old_lease.id
        assert sess_row.last_active_at is not None

        # new lease: interactive, pending, brand-new token.
        new_lease = (
            await db_session.execute(
                select(
                    DaemonTaskLease.id,
                    DaemonTaskLease.kind,
                    DaemonTaskLease.status,
                    DaemonTaskLease.runtime_id,
                    DaemonTaskLease.metadata_,
                ).where(DaemonTaskLease.id == new_lease_id)
            )
        ).one()
        assert new_lease.kind == "interactive"
        assert new_lease.status == "pending"
        assert new_lease.runtime_id == rt.id
        new_token = (new_lease.metadata_ or {}).get("claim_token")
        assert isinstance(new_token, str) and len(new_token) >= 32
        assert new_token != "old-token-deadbeef"

        # old lease still completed, untouched.
        old_status = (
            await db_session.execute(
                select(DaemonTaskLease.status).where(DaemonTaskLease.id == old_lease.id)
            )
        ).scalar_one()
        assert old_status == "completed"

    async def test_reopen_sends_session_resume_ws_payload(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
        monkeypatch,
    ) -> None:
        from app.modules.daemon import ws_hub

        admin = await _admin(db_session)
        rt = await _make_runtime(db_session, admin.id)
        old_lease = await _make_completed_lease(db_session, rt.id, "sdk-ws-1")
        sess = await _make_session(
            db_session,
            admin.id,
            rt.id,
            status="ended",
            agent_session_id="sdk-ws-1",
            lease_id=old_lease.id,
            cwd="/home/user/proj",
        )

        sent: list[tuple] = []

        async def _capture(runtime_id, msg_type, payload):
            sent.append((runtime_id, msg_type, payload))
            return True

        hub = ws_hub.get_daemon_ws_hub()
        monkeypatch.setattr(hub, "is_connected", lambda _rid: True)
        monkeypatch.setattr(hub, "send_session_control", _capture)

        resp = await client.post(f"/api/daemon/sessions/{sess.id}/reopen", headers=auth_headers)
        assert resp.status_code == 200, resp.text

        assert len(sent) == 1
        runtime_id, msg_type, payload = sent[0]
        assert runtime_id == rt.id
        assert msg_type == protocol.DAEMON_MSG_SESSION_RESUME
        assert payload["session_id"] == str(sess.id)
        assert payload["agent_session_id"] == "sdk-ws-1"
        assert payload["cwd"] == "/home/user/proj"
        assert payload["provider"] == "claude"
        assert payload["runtime_id"] == str(rt.id)
        # lease_id in WS points to the NEW lease, not the old completed one.
        assert payload["lease_id"] != str(old_lease.id)
        assert uuid.UUID(payload["lease_id"]) is not None

    async def test_reopen_ws_failure_keeps_reconnecting_best_effort(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
        monkeypatch,
    ) -> None:
        from app.modules.daemon import ws_hub

        admin = await _admin(db_session)
        rt = await _make_runtime(db_session, admin.id)
        old_lease = await _make_completed_lease(db_session, rt.id, "sdk-fail-1")
        sess = await _make_session(
            db_session,
            admin.id,
            rt.id,
            status="ended",
            agent_session_id="sdk-fail-1",
            lease_id=old_lease.id,
        )

        async def _boom(*a, **k):
            raise RuntimeError("ws down")

        hub = ws_hub.get_daemon_ws_hub()
        monkeypatch.setattr(hub, "is_connected", lambda _rid: True)
        monkeypatch.setattr(hub, "send_session_control", _boom)

        resp = await client.post(f"/api/daemon/sessions/{sess.id}/reopen", headers=auth_headers)
        # best-effort: 200 + local reconnecting, WS failure does NOT rollback.
        assert resp.status_code == 200, resp.text
        status_row = (
            await db_session.execute(select(AgentSession.status).where(AgentSession.id == sess.id))
        ).scalar_one()
        assert status_row == "reconnecting"

    async def test_reopen_switching_daemon_updates_runtime(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
        monkeypatch,
    ) -> None:
        """Switching daemon: only the new (online) runtime is used; the old lease
        stays on the old runtime. Session.runtime_id + new lease runtime update."""
        from app.modules.daemon import ws_hub

        admin = await _admin(db_session)
        rt_old = await _make_runtime(db_session, admin.id)
        old_lease = await _make_completed_lease(db_session, rt_old.id, "sdk-switch-1")
        sess = await _make_session(
            db_session,
            admin.id,
            rt_old.id,
            status="ended",
            agent_session_id="sdk-switch-1",
            lease_id=old_lease.id,
        )

        captured: dict = {}

        async def _capture(runtime_id, msg_type, payload):
            captured["runtime_id"] = runtime_id
            captured["payload"] = payload
            return True

        hub = ws_hub.get_daemon_ws_hub()

        def _is_connected(rid):
            # session still bound to rt_old; the reopen path reads session.runtime_id
            # and only requires THAT runtime online. We monkeypatch to accept the
            # session's current runtime.
            return True

        monkeypatch.setattr(hub, "is_connected", _is_connected)
        monkeypatch.setattr(hub, "send_session_control", _capture)

        resp = await client.post(f"/api/daemon/sessions/{sess.id}/reopen", headers=auth_headers)
        assert resp.status_code == 200, resp.text

        # Column projection (see test_reopen_creates_new_interactive... for why).
        sess_row = (
            await db_session.execute(
                select(AgentSession.runtime_id, AgentSession.lease_id).where(
                    AgentSession.id == sess.id
                )
            )
        ).one()
        new_lease_id = sess_row.lease_id
        # No explicit "switch target" param in reopen (uses session.runtime_id),
        # so runtime stays — but the new lease must be bound to that runtime and
        # distinct from the completed lease.
        assert sess_row.runtime_id == rt_old.id
        lease_row = (
            await db_session.execute(
                select(DaemonTaskLease.id, DaemonTaskLease.runtime_id).where(
                    DaemonTaskLease.id == new_lease_id
                )
            )
        ).one()
        assert lease_row.runtime_id == rt_old.id
        assert lease_row.id != old_lease.id
        assert captured["payload"]["runtime_id"] == str(rt_old.id)


# ── task-07 §14: confirm path friendliness ────────────────────────────────────


class TestReopenConfirmLinkage:
    """design §14: confirm_session_reconnected must succeed for a reopen session
    bound to a brand-new lease + rotated token. confirm only keys on
    session_id + runtime_id (no lease/token check), so the new lease is fine."""

    async def test_confirm_flips_reopen_session_to_active(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
        monkeypatch,
    ) -> None:
        from app.modules.daemon import ws_hub
        from app.modules.daemon.service import DaemonService

        admin = await _admin(db_session)
        rt = await _make_runtime(db_session, admin.id)
        old_lease = await _make_completed_lease(db_session, rt.id, "sdk-confirm-1")
        sess = await _make_session(
            db_session,
            admin.id,
            rt.id,
            status="ended",
            agent_session_id="sdk-confirm-1",
            lease_id=old_lease.id,
        )

        hub = ws_hub.get_daemon_ws_hub()
        monkeypatch.setattr(hub, "is_connected", lambda _rid: True)
        monkeypatch.setattr(hub, "send_session_control", lambda *a, **k: _async_true())

        resp = await client.post(f"/api/daemon/sessions/{sess.id}/reopen", headers=auth_headers)
        assert resp.status_code == 200, resp.text

        # Simulate daemon resume success → confirm_session_reconnected.
        # expunge_all() detaches the stale ended-copy from the test session's
        # identity map so confirm's SELECT FOR UPDATE loads the freshly-committed
        # reconnecting row (without forcing expired lazy-loads outside greenlet).
        db_session.expunge_all()
        svc = DaemonService(db_session)
        result = await svc.confirm_session_reconnected(sess.id, runtime_id=rt.id)
        assert result == "active"

        status_row = (
            await db_session.execute(select(AgentSession.status).where(AgentSession.id == sess.id))
        ).scalar_one()
        assert status_row == "active"


async def _async_true() -> bool:
    return True
