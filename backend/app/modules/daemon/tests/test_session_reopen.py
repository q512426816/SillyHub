"""task-05 + task-06: reopen_session + GET /sessions/{id} 单查端点.

task-05: POST /api/daemon/sessions/{id}/reopen（骨架 + 校验；状态转换 task-07）.
task-06: GET /api/daemon/sessions/{id} 单查 + protocol DAEMON_MSG_SESSION_RESUME.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

from httpx import AsyncClient
from sqlalchemy import func, select
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
    # ql-20260827-014：会话级供应商（reopen 凭证链用例需自造绑定）。
    llm_provider_id: uuid.UUID | None = None,
    # DS-5（2026-08-21-session-reopen-resume）：窗口用例需自造 last_active_at
    # （默认 now，既有用例行为不变）。
    last_active_at: datetime | None = None,
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
        llm_provider_id=llm_provider_id,
        created_at=now,
        last_active_at=last_active_at if last_active_at is not None else now,
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


async def _make_pending_lease(
    session: AsyncSession,
    runtime_id: uuid.UUID,
    agent_session_id: str,
) -> DaemonTaskLease:
    """A pending interactive lease — the suspended binding a first reopen (or
    daemon-restart recover) leaves on a ``reconnecting`` session.

    DS-5（2026-08-21-session-reopen-resume）stale-reconnecting 用例的旧 lease 源：
    二次 reopen 放行时它必须收敛为 ``cancelled`` 并被新 lease（旋转 token）替换。
    """
    now = datetime.now(UTC)
    lease = DaemonTaskLease(
        id=uuid.uuid4(),
        runtime_id=runtime_id,
        agent_run_id=None,
        kind="interactive",
        status="pending",
        lease_expires_at=None,
        attempt_number=1,
        metadata_={
            "session_id": agent_session_id,
            "provider": "claude",
            "claim_token": "stale-token-deadbeef",
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


# ── ql-20260827-014：reopen 会话级供应商凭证链 ────────────────────────────────


async def _seed_provider(
    session: AsyncSession,
    user_id: uuid.UUID,
    *,
    api_key: str,
    base_url: str = "https://open.bigmodel.cn/api/anthropic",
) -> uuid.UUID:
    """直插 LlmProvider 行（真实 cipher 加密落盘），返回 id。

    镜像 ``test_lease_context_provider_priority.py::_seed_provider``（该文件
    头注释的范式约定：provider 落盘用真实 cipher，不 mock）。
    """
    from app.core.crypto import get_cipher
    from app.modules.llm_provider.model import LlmProvider

    cipher = get_cipher()
    ct, key_id = cipher.encrypt(api_key)
    row = LlmProvider(
        id=uuid.uuid4(),
        user_id=user_id,
        name=f"t014-reopen-{uuid.uuid4().hex[:6]}",
        agent_kind="claude",
        encrypted_api_key=ct,
        key_id=key_id,
        base_url=base_url,
        model=None,
        is_default=False,
        api_format="anthropic",
    )
    session.add(row)
    await session.commit()
    await session.refresh(row)
    return row.id


class TestReopenSessionProviderCredential:
    """ql-20260827-014：reopen 必须把会话级供应商带到 daemon（lease 键 + WS 凭证）。

    生产实证（阿里云 b70bf7b2）：reopen 建 lease 漏写 ``session_llm_provider_id``
    且 SESSION_RESUME payload 不带 provider_config → daemon 恢复的 SDK 子进程无
    凭证（隔离 CLAUDE_CONFIG_DIR 无本机 OAuth 兜底）→ "Not logged in" 秒退 →
    会话回 ended，每次重开约 2s 死亡循环。
    """

    async def test_reopen_with_provider_writes_lease_key_and_ws_credential(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
        monkeypatch,
    ) -> None:
        """会话绑了供应商 → 新 lease metadata 带 session_llm_provider_id +
        SESSION_RESUME payload 带解密后的 provider_config（含 api_key 明文）。"""
        from app.modules.daemon import ws_hub

        admin = await _admin(db_session)
        rt = await _make_runtime(db_session, admin.id)
        old_lease = await _make_completed_lease(db_session, rt.id, "sdk-prov-1")
        provider_id = await _seed_provider(db_session, admin.id, api_key="sk-reopen-key")
        sess = await _make_session(
            db_session,
            admin.id,
            rt.id,
            status="ended",
            agent_session_id="sdk-prov-1",
            lease_id=old_lease.id,
            llm_provider_id=provider_id,
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

        # lease metadata：新 lease 带 session_llm_provider_id（create 路径同款键）。
        new_lease_id = (
            await db_session.execute(
                select(AgentSession.lease_id).where(AgentSession.id == sess.id)
            )
        ).scalar_one()
        meta = (
            await db_session.execute(
                select(DaemonTaskLease.metadata_).where(DaemonTaskLease.id == new_lease_id)
            )
        ).scalar_one()
        assert meta.get("session_llm_provider_id") == str(provider_id)

        # WS payload：provider_config 已解密（结构同 claim payload，api_key 明文）。
        assert len(sent) == 1
        _, msg_type, payload = sent[0]
        assert msg_type == protocol.DAEMON_MSG_SESSION_RESUME
        provider_config = payload.get("provider_config")
        assert isinstance(provider_config, dict)
        assert provider_config.get("api_key") == "sk-reopen-key"
        assert provider_config.get("base_url") == "https://open.bigmodel.cn/api/anthropic"

    async def test_reopen_without_provider_omits_credential(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
        monkeypatch,
    ) -> None:
        """会话无供应商（llm_provider_id=None，本机凭证链）→ payload 不带
        provider_config 键、lease metadata 不带 session_llm_provider_id（零回归）。"""
        from app.modules.daemon import ws_hub

        admin = await _admin(db_session)
        rt = await _make_runtime(db_session, admin.id)
        old_lease = await _make_completed_lease(db_session, rt.id, "sdk-noprov-1")
        sess = await _make_session(
            db_session,
            admin.id,
            rt.id,
            status="ended",
            agent_session_id="sdk-noprov-1",
            lease_id=old_lease.id,
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
        _, _, payload = sent[0]
        assert "provider_config" not in payload
        new_lease_id = (
            await db_session.execute(
                select(AgentSession.lease_id).where(AgentSession.id == sess.id)
            )
        ).scalar_one()
        meta = (
            await db_session.execute(
                select(DaemonTaskLease.metadata_).where(DaemonTaskLease.id == new_lease_id)
            )
        ).scalar_one()
        assert "session_llm_provider_id" not in (meta or {})

    async def test_reopen_stale_provider_id_degrades_to_no_credential(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
        monkeypatch,
    ) -> None:
        """llm_provider_id 指向已不存在的供应商 → 解析降级（payload 缺键、
        reopen 仍 200 reconnecting），不阻断重开（对齐 claim 链路降级语义）。"""
        from app.modules.daemon import ws_hub

        admin = await _admin(db_session)
        rt = await _make_runtime(db_session, admin.id)
        old_lease = await _make_completed_lease(db_session, rt.id, "sdk-stale-1")
        # 不落 LlmProvider 行——llm_provider_id 直接指向幽灵 id。
        sess = await _make_session(
            db_session,
            admin.id,
            rt.id,
            status="ended",
            agent_session_id="sdk-stale-1",
            lease_id=old_lease.id,
            llm_provider_id=uuid.uuid4(),
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
        status_row = (
            await db_session.execute(select(AgentSession.status).where(AgentSession.id == sess.id))
        ).scalar_one()
        assert status_row == "reconnecting"

        assert len(sent) == 1
        _, _, payload = sent[0]
        assert "provider_config" not in payload


# ── DS-5/DS-7（2026-08-21-session-reopen-resume）：reopen 前置校验扩展 ─────────


class TestReopenReconnectingRetryWindow:
    """DS-5：reconnecting 且 last_active_at 距今 > RECONNECTING_RETRY_WINDOW_SEC
    （180s）→ 放行二次 reopen（旧挂起 lease 置 cancelled、新建 lease 旋转
    claim_token、SESSION_RESUME 重发）；窗口内维持 DaemonSessionNotActive 409。
    超时基准锁 last_active_at（F2）。"""

    async def test_reopen_stale_reconnecting_succeeds(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
        monkeypatch,
    ) -> None:
        """窗口外（300s > 180s）：二次 reopen 成功，旧 pending lease → cancelled，
        新 interactive lease 持新 claim_token，SESSION_RESUME 指向新 lease 重发。"""
        from app.modules.daemon import ws_hub

        admin = await _admin(db_session)
        rt = await _make_runtime(db_session, admin.id)
        stale_lease = await _make_pending_lease(db_session, rt.id, "sdk-retry-1")
        stale_ts = datetime.now(UTC) - timedelta(seconds=300)
        sess = await _make_session(
            db_session,
            admin.id,
            rt.id,
            status="reconnecting",
            agent_session_id="sdk-retry-1",
            lease_id=stale_lease.id,
            last_active_at=stale_ts,
        )

        hub = ws_hub.get_daemon_ws_hub()
        monkeypatch.setattr(hub, "is_connected", lambda _rid: True)
        resume_payloads: list[dict] = []

        async def _capture(_daemon_id, _msg, payload):
            resume_payloads.append(payload)
            return True

        monkeypatch.setattr(hub, "send_session_control", _capture)

        resp = await client.post(f"/api/daemon/sessions/{sess.id}/reopen", headers=auth_headers)
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["session_id"] == str(sess.id)
        assert body["status"] == "reconnecting"

        # session：仍 reconnecting，但换新 lease 且 last_active_at 刷新为本次 reopen。
        sess_row = (
            await db_session.execute(
                select(
                    AgentSession.status,
                    AgentSession.lease_id,
                    AgentSession.last_active_at,
                ).where(AgentSession.id == sess.id)
            )
        ).one()
        assert sess_row.status == "reconnecting"
        new_lease_id = sess_row.lease_id
        assert new_lease_id is not None
        assert new_lease_id != stale_lease.id
        assert sess_row.last_active_at is not None
        # SQLite 读回 naive datetime，补 UTC 后再与造数据时刻比较（naive 值
        # 本身即按 UTC 写入）。
        refreshed_at = sess_row.last_active_at
        if refreshed_at.tzinfo is None:
            refreshed_at = refreshed_at.replace(tzinfo=UTC)
        assert refreshed_at > stale_ts

        # 旧挂起 lease 收敛 cancelled（DS-6 取值：interactive 恒 NULL
        # lease_expires_at，不可用 expired；cancelled 与"恢复放弃"语义一致）。
        old_status = (
            await db_session.execute(
                select(DaemonTaskLease.status).where(DaemonTaskLease.id == stale_lease.id)
            )
        ).scalar_one()
        assert old_status == "cancelled"

        # 新 lease：interactive + pending + 旋转 claim_token。
        new_lease = (
            await db_session.execute(
                select(
                    DaemonTaskLease.kind, DaemonTaskLease.status, DaemonTaskLease.metadata_
                ).where(DaemonTaskLease.id == new_lease_id)
            )
        ).one()
        assert new_lease.kind == "interactive"
        assert new_lease.status == "pending"
        new_token = (new_lease.metadata_ or {}).get("claim_token")
        assert isinstance(new_token, str) and len(new_token) >= 32
        assert new_token != "stale-token-deadbeef"

        # SESSION_RESUME 重发一次，lease_id 指向新 lease。
        assert len(resume_payloads) == 1
        assert resume_payloads[0]["lease_id"] == str(new_lease_id)
        assert resume_payloads[0]["agent_session_id"] == "sdk-retry-1"

    async def test_reopen_reconnecting_within_window_409(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
        monkeypatch,
    ) -> None:
        """窗口内（60s < 180s）：恢复还在路上，维持 DaemonSessionNotActive 409，
        不收敛旧 lease、不新建 lease、不发 SESSION_RESUME。"""
        from app.modules.daemon import ws_hub

        admin = await _admin(db_session)
        rt = await _make_runtime(db_session, admin.id)
        pending_lease = await _make_pending_lease(db_session, rt.id, "sdk-soon-1")
        sess = await _make_session(
            db_session,
            admin.id,
            rt.id,
            status="reconnecting",
            agent_session_id="sdk-soon-1",
            lease_id=pending_lease.id,
            last_active_at=datetime.now(UTC) - timedelta(seconds=60),
        )

        hub = ws_hub.get_daemon_ws_hub()
        monkeypatch.setattr(hub, "is_connected", lambda _rid: True)
        sent: list[dict] = []

        async def _capture(_daemon_id, _msg, payload):
            sent.append(payload)
            return True

        monkeypatch.setattr(hub, "send_session_control", _capture)

        resp = await client.post(f"/api/daemon/sessions/{sess.id}/reopen", headers=auth_headers)
        assert resp.status_code == 409
        assert resp.json()["code"] == "HTTP_409_DAEMON_SESSION_NOT_ACTIVE"
        assert sent == []

        # 状态不变、lease 不动不新建。
        sess_row = (
            await db_session.execute(
                select(AgentSession.status, AgentSession.lease_id).where(AgentSession.id == sess.id)
            )
        ).one()
        assert sess_row.status == "reconnecting"
        assert sess_row.lease_id == pending_lease.id
        old_status = (
            await db_session.execute(
                select(DaemonTaskLease.status).where(DaemonTaskLease.id == pending_lease.id)
            )
        ).scalar_one()
        assert old_status == "pending"

    async def test_reopen_reconnecting_null_last_active_409(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
        monkeypatch,
    ) -> None:
        """last_active_at 为 NULL（数据异常/极老行）：保守不放行，维持 409。"""
        from sqlalchemy import update

        from app.modules.daemon import ws_hub

        admin = await _admin(db_session)
        rt = await _make_runtime(db_session, admin.id)
        sess = await _make_session(
            db_session,
            admin.id,
            rt.id,
            status="reconnecting",
            agent_session_id="sdk-null-1",
        )
        await db_session.execute(
            update(AgentSession).where(AgentSession.id == sess.id).values(last_active_at=None)
        )
        await db_session.commit()
        db_session.expunge_all()

        hub = ws_hub.get_daemon_ws_hub()
        monkeypatch.setattr(hub, "is_connected", lambda _rid: True)

        resp = await client.post(f"/api/daemon/sessions/{sess.id}/reopen", headers=auth_headers)
        assert resp.status_code == 409
        assert "NOT_ACTIVE" in resp.json()["code"]

    async def test_reopen_failed_session_returns_reconnecting(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
        monkeypatch,
    ) -> None:
        """回归：failed 会话（含 ended，见存量用例）正常 reopen 路径不变。"""
        from app.modules.daemon import ws_hub

        admin = await _admin(db_session)
        rt = await _make_runtime(db_session, admin.id)
        old_lease = await _make_completed_lease(db_session, rt.id, "sdk-regress-1")
        sess = await _make_session(
            db_session,
            admin.id,
            rt.id,
            status="failed",
            agent_session_id="sdk-regress-1",
            lease_id=old_lease.id,
        )

        hub = ws_hub.get_daemon_ws_hub()
        monkeypatch.setattr(hub, "is_connected", lambda _rid: True)
        monkeypatch.setattr(hub, "send_session_control", lambda *a, **k: _async_true())

        resp = await client.post(f"/api/daemon/sessions/{sess.id}/reopen", headers=auth_headers)
        assert resp.status_code == 200, resp.text
        assert resp.json()["status"] == "reconnecting"

        # ended/failed 路径不动旧 lease（已是终态 completed）。
        old_status = (
            await db_session.execute(
                select(DaemonTaskLease.status).where(DaemonTaskLease.id == old_lease.id)
            )
        ).scalar_one()
        assert old_status == "completed"


class TestReopenEmptyCwd:
    """DS-7：cwd 为空（NULL/空串）→ 409 专用错误码 HTTP_409_DAEMON_SESSION_NO_CWD
    + 中文文案；不新建 lease、不发 SESSION_RESUME。scan/bootstrap 会话不写 cwd
    （agent/service.py、spec_workspace/bootstrap.py），空 cwd 的 SDK resume 必然
    失败，提前拒绝优于让 daemon 报错。"""

    @staticmethod
    async def _assert_rejected_no_side_effects(
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
        monkeypatch,
        sess: AgentSession,
        rt: DaemonRuntime,
    ) -> None:
        from app.modules.daemon import ws_hub

        hub = ws_hub.get_daemon_ws_hub()
        monkeypatch.setattr(hub, "is_connected", lambda _rid: True)
        sent: list[dict] = []

        async def _capture(_daemon_id, _msg, payload):
            sent.append(payload)
            return True

        monkeypatch.setattr(hub, "send_session_control", _capture)

        resp = await client.post(f"/api/daemon/sessions/{sess.id}/reopen", headers=auth_headers)
        assert resp.status_code == 409
        body = resp.json()
        assert body["code"] == "HTTP_409_DAEMON_SESSION_NO_CWD"
        assert body["message"] == "该会话无关联工作目录，无法恢复对话记录"

        # 无副作用：状态不变、不新建 lease、不下发 SESSION_RESUME。
        status_row = (
            await db_session.execute(select(AgentSession.status).where(AgentSession.id == sess.id))
        ).scalar_one()
        assert status_row == "ended"
        lease_count = (
            await db_session.execute(
                select(func.count())
                .select_from(DaemonTaskLease)
                .where(DaemonTaskLease.runtime_id == rt.id)
            )
        ).scalar_one()
        assert lease_count == 0
        assert sent == []

    async def test_reopen_null_cwd_409(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
        monkeypatch,
    ) -> None:
        admin = await _admin(db_session)
        rt = await _make_runtime(db_session, admin.id)
        sess = await _make_session(
            db_session,
            admin.id,
            rt.id,
            status="ended",
            agent_session_id="sdk-ncwd-1",
            cwd=None,
        )
        await self._assert_rejected_no_side_effects(
            client, auth_headers, db_session, monkeypatch, sess, rt
        )

    async def test_reopen_empty_string_cwd_409(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
        monkeypatch,
    ) -> None:
        admin = await _admin(db_session)
        rt = await _make_runtime(db_session, admin.id)
        sess = await _make_session(
            db_session,
            admin.id,
            rt.id,
            status="ended",
            agent_session_id="sdk-ncwd-2",
            cwd="",
        )
        await self._assert_rejected_no_side_effects(
            client, auth_headers, db_session, monkeypatch, sess, rt
        )


# ── task-07 §14: confirm path friendliness ────────────────────────────────────


class TestReopenConfirmLinkage:
    """design §14: confirm_session_reconnected must succeed for a reopen session
    bound to a brand-new lease + rotated token. confirm keys on session_id +
    runtime_id; DS-4（2026-08-21-session-reopen-resume）新增可选 lease_id 仅做
    陈旧确认防误翻——不携带（旧 daemon 重启 recover 链路）时行为不变。"""

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

    # ── DS-4（2026-08-21-session-reopen-resume）：可选 lease_id 陈旧确认防误翻 ──

    async def _reopen_and_capture_lease_id(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
        monkeypatch,
        *,
        agent_session_id: str,
    ) -> tuple[AgentSession, uuid.UUID, uuid.UUID]:
        """reopen 一次并返回 (session, 当前 lease_id, 旧 lease_id)。

        当前 lease_id 取自 SESSION_RESUME payload（daemon 即由此获得并在
        confirm/mark-failed 回传，DS-3/DS-4 契约）；旧 lease_id 是 reopen 前
        挂在 session 上的 completed lease（陈旧确认模拟源）。
        """
        from app.modules.daemon import ws_hub

        admin = await _admin(db_session)
        rt = await _make_runtime(db_session, admin.id)
        old_lease = await _make_completed_lease(db_session, rt.id, agent_session_id)
        sess = await _make_session(
            db_session,
            admin.id,
            rt.id,
            status="ended",
            agent_session_id=agent_session_id,
            lease_id=old_lease.id,
        )

        hub = ws_hub.get_daemon_ws_hub()
        monkeypatch.setattr(hub, "is_connected", lambda _rid: True)
        resume_payloads: list[dict[str, object]] = []

        async def _capture_send(_daemon_id: uuid.UUID, _msg: str, payload: dict) -> bool:
            resume_payloads.append(payload)
            return True

        monkeypatch.setattr(hub, "send_session_control", _capture_send)

        resp = await client.post(f"/api/daemon/sessions/{sess.id}/reopen", headers=auth_headers)
        assert resp.status_code == 200, resp.text
        assert len(resume_payloads) == 1
        current_lease_id = uuid.UUID(str(resume_payloads[0]["lease_id"]))
        assert current_lease_id != old_lease.id
        return sess, current_lease_id, old_lease.id

    async def test_confirm_with_matching_lease_id_flips_active(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
        monkeypatch,
    ) -> None:
        """DS-4：confirm 携带与当前 lease 匹配的 lease_id → 正常翻 active。"""
        sess, current_lease_id, _old = await self._reopen_and_capture_lease_id(
            client, auth_headers, db_session, monkeypatch, agent_session_id="sdk-confirm-match"
        )

        db_session.expunge_all()
        resp = await client.post(
            f"/api/daemon/sessions/{sess.id}/confirm-reconnected",
            headers=auth_headers,
            json={"runtime_id": str(sess.runtime_id), "lease_id": str(current_lease_id)},
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["status"] == "active"

        status_row = (
            await db_session.execute(select(AgentSession.status).where(AgentSession.id == sess.id))
        ).scalar_one()
        assert status_row == "active"

    async def test_confirm_with_stale_lease_id_skips_idempotently(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
        monkeypatch,
    ) -> None:
        """DS-4：confirm 携带陈旧 lease_id（reopen 前旧 lease）→ 幂等跳过。

        迟到的旧确认不得误翻第二次 reopen 的 reconnecting（不翻转、不报错、
        返回当前状态）。
        """
        sess, _current, old_lease_id = await self._reopen_and_capture_lease_id(
            client, auth_headers, db_session, monkeypatch, agent_session_id="sdk-confirm-stale"
        )

        db_session.expunge_all()
        resp = await client.post(
            f"/api/daemon/sessions/{sess.id}/confirm-reconnected",
            headers=auth_headers,
            json={"runtime_id": str(sess.runtime_id), "lease_id": str(old_lease_id)},
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["status"] == "reconnecting"

        status_row = (
            await db_session.execute(select(AgentSession.status).where(AgentSession.id == sess.id))
        ).scalar_one()
        assert status_row == "reconnecting"

    async def test_mark_recovery_failed_with_matching_lease_flips_failed(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
        monkeypatch,
    ) -> None:
        """DS-4：mark-recovery-failed 携带匹配 lease_id → reconnecting → failed。"""
        sess, current_lease_id, _old = await self._reopen_and_capture_lease_id(
            client, auth_headers, db_session, monkeypatch, agent_session_id="sdk-markmatch"
        )

        db_session.expunge_all()
        resp = await client.post(
            f"/api/daemon/sessions/{sess.id}/mark-recovery-failed",
            headers=auth_headers,
            json={
                "runtime_id": str(sess.runtime_id),
                "lease_id": str(current_lease_id),
                "reason": "restore_failed",
            },
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["status"] == "failed"

        row = (
            await db_session.execute(
                select(AgentSession.status, AgentSession.ended_at).where(AgentSession.id == sess.id)
            )
        ).one()
        assert row.status == "failed"
        assert row.ended_at is not None

    async def test_mark_recovery_failed_converges_pending_lease(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
        monkeypatch,
    ) -> None:
        """ql-20260823-007：恢复失败翻 failed 时挂起租约收敛 cancelled（防永挂）。

        reopen 创建的租约在 resume 失败后即死——此前无人收口，含被任务轮询误
        认领的 claimed 态都永挂（2026-08-23 bdec91a4 事故的租约残留）。
        """
        sess, current_lease_id, _old = await self._reopen_and_capture_lease_id(
            client, auth_headers, db_session, monkeypatch, agent_session_id="sdk-leaseconv"
        )

        db_session.expunge_all()
        resp = await client.post(
            f"/api/daemon/sessions/{sess.id}/mark-recovery-failed",
            headers=auth_headers,
            json={
                "runtime_id": str(sess.runtime_id),
                "lease_id": str(current_lease_id),
                "reason": "restore_failed",
            },
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["status"] == "failed"

        lease_status = (
            await db_session.execute(
                select(DaemonTaskLease.status).where(DaemonTaskLease.id == current_lease_id)
            )
        ).scalar_one()
        assert lease_status == "cancelled"

    async def test_mark_recovery_failed_with_stale_lease_skips(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
        monkeypatch,
    ) -> None:
        """DS-4：mark-recovery-failed 携带陈旧 lease_id → 幂等跳过（不误杀）。"""
        sess, _current, old_lease_id = await self._reopen_and_capture_lease_id(
            client, auth_headers, db_session, monkeypatch, agent_session_id="sdk-markstale"
        )

        db_session.expunge_all()
        resp = await client.post(
            f"/api/daemon/sessions/{sess.id}/mark-recovery-failed",
            headers=auth_headers,
            json={
                "runtime_id": str(sess.runtime_id),
                "lease_id": str(old_lease_id),
                "reason": "restore_failed",
            },
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["status"] == "reconnecting"

        status_row = (
            await db_session.execute(select(AgentSession.status).where(AgentSession.id == sess.id))
        ).scalar_one()
        assert status_row == "reconnecting"


async def _async_true() -> bool:
    return True
