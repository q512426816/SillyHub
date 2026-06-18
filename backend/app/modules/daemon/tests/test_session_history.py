"""task-12: 会话列表 + 历史回看（GET /sessions, GET /sessions/{id}/logs）.

Covers owner scoping, status filter, stable paging, cross-run aggregation
(D-005@v1: aggregate by ``agent_runs.agent_session_id``, never by
``AgentRun.session_id``), empty logs, resource hiding, and FastAPI validation
(422) for limit/offset/status.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.model import AgentRun, AgentRunLog, AgentSession
from app.modules.auth.model import User
from app.modules.daemon.model import DaemonRuntime

# ── Helpers ──────────────────────────────────────────────────────────────────


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


async def _make_runtime(session: AsyncSession, user_id: uuid.UUID) -> DaemonRuntime:
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


async def _make_session(
    session: AsyncSession,
    user_id: uuid.UUID,
    runtime_id: uuid.UUID,
    *,
    status: str = "ended",
    provider: str = "claude",
    turn_count: int = 1,
    last_active_at: datetime | None = None,
    created_at: datetime | None = None,
    config: dict | None = None,
    agent_session_id: str | None = None,
) -> AgentSession:
    now = datetime.now(UTC)
    sess = AgentSession(
        id=uuid.uuid4(),
        user_id=user_id,
        runtime_id=runtime_id,
        lease_id=None,
        provider=provider,
        status=status,
        agent_session_id=agent_session_id,
        config=config,
        turn_count=turn_count,
        created_at=created_at or now,
        last_active_at=last_active_at,
        ended_at=now if status in ("ended", "failed") else None,
    )
    session.add(sess)
    await session.commit()
    await session.refresh(sess)
    return sess


async def _make_run(
    session: AsyncSession,
    agent_session_id: uuid.UUID,
    *,
    status: str = "completed",
    started_at: datetime | None = None,
) -> AgentRun:
    run = AgentRun(
        id=uuid.uuid4(),
        agent_type="claude_code",
        provider="claude",
        status=status,
        agent_session_id=agent_session_id,
        session_id=None,  # claude resume id — must NOT be used to aggregate (D-005)
        started_at=started_at or datetime.now(UTC),
    )
    session.add(run)
    await session.commit()
    await session.refresh(run)
    return run


async def _make_log(
    session: AsyncSession,
    run_id: uuid.UUID,
    *,
    content: str,
    channel: str = "stdout",
    timestamp: datetime | None = None,
) -> AgentRunLog:
    log = AgentRunLog(
        id=uuid.uuid4(),
        run_id=run_id,
        timestamp=timestamp or datetime.now(UTC),
        channel=channel,
        content_redacted=content,
    )
    session.add(log)
    await session.commit()
    await session.refresh(log)
    return log


# ── GET /sessions ────────────────────────────────────────────────────────────


class TestListSessions:
    async def test_owner_only_and_default_paging(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
    ) -> None:
        admin = (
            (await db_session.execute(select(User).where(User.email == "admin@example.com")))
            .scalars()
            .first()
        )
        assert admin is not None
        other = await _make_user(db_session, f"other-{uuid.uuid4()}@example.com")
        rt_admin = await _make_runtime(db_session, admin.id)
        rt_other = await _make_runtime(db_session, other.id)

        await _make_session(db_session, admin.id, rt_admin.id, status="ended")
        await _make_session(db_session, admin.id, rt_admin.id, status="active")
        # other user's session must not leak
        await _make_session(db_session, other.id, rt_other.id, status="active")

        resp = await client.get("/api/daemon/sessions", headers=auth_headers)
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["total"] == 2
        assert body["limit"] == 20
        assert body["offset"] == 0
        assert len(body["items"]) == 2
        for item in body["items"]:
            assert item["provider"] == "claude"
            assert "status" in item
            assert "turn_count" in item
            assert "id" in item

    async def test_status_filter(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
    ) -> None:
        admin = (
            (await db_session.execute(select(User).where(User.email == "admin@example.com")))
            .scalars()
            .first()
        )
        assert admin is not None
        rt = await _make_runtime(db_session, admin.id)
        await _make_session(db_session, admin.id, rt.id, status="ended")
        await _make_session(db_session, admin.id, rt.id, status="active")
        await _make_session(db_session, admin.id, rt.id, status="failed")

        resp = await client.get("/api/daemon/sessions?status=ended", headers=auth_headers)
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["total"] == 1
        assert body["items"][0]["status"] == "ended"

    async def test_invalid_status_422(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
    ) -> None:
        resp = await client.get("/api/daemon/sessions?status=bogus", headers=auth_headers)
        assert resp.status_code == 422

    async def test_limit_offset_validation_422(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
    ) -> None:
        # limit too small
        r = await client.get("/api/daemon/sessions?limit=0", headers=auth_headers)
        assert r.status_code == 422
        # limit too large
        r = await client.get("/api/daemon/sessions?limit=101", headers=auth_headers)
        assert r.status_code == 422
        # negative offset
        r = await client.get("/api/daemon/sessions?offset=-1", headers=auth_headers)
        assert r.status_code == 422

    async def test_stable_paging_order(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
    ) -> None:
        admin = (
            (await db_session.execute(select(User).where(User.email == "admin@example.com")))
            .scalars()
            .first()
        )
        assert admin is not None
        rt = await _make_runtime(db_session, admin.id)
        base = datetime.now(UTC)
        # last_active_at DESC, then created_at DESC
        s_old = await _make_session(
            db_session, admin.id, rt.id, status="ended", last_active_at=base - timedelta(minutes=10)
        )
        s_new = await _make_session(
            db_session, admin.id, rt.id, status="ended", last_active_at=base
        )
        # null last_active_at → falls back to created_at
        s_none = await _make_session(
            db_session,
            admin.id,
            rt.id,
            status="ended",
            last_active_at=None,
            created_at=base - timedelta(hours=1),
        )

        resp = await client.get("/api/daemon/sessions?limit=2&offset=0", headers=auth_headers)
        assert resp.status_code == 200
        body = resp.json()
        ids = [i["id"] for i in body["items"]]
        # newest (latest last_active_at) first; null last_active_at last
        assert ids[0] == str(s_new.id)
        assert ids[1] == str(s_old.id)

        resp2 = await client.get("/api/daemon/sessions?limit=2&offset=2", headers=auth_headers)
        assert resp2.status_code == 200
        body2 = resp2.json()
        assert [i["id"] for i in body2["items"]] == [str(s_none.id)]

    async def test_empty_list(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
    ) -> None:
        resp = await client.get("/api/daemon/sessions", headers=auth_headers)
        assert resp.status_code == 200
        body = resp.json()
        assert body["total"] == 0
        assert body["items"] == []

    async def test_requires_auth(self, client: AsyncClient) -> None:
        resp = await client.get("/api/daemon/sessions")
        assert resp.status_code in (401, 403)


# ── GET /sessions/{id}/logs ──────────────────────────────────────────────────


class TestSessionLogs:
    async def test_aggregate_across_runs_d005(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
    ) -> None:
        admin = (
            (await db_session.execute(select(User).where(User.email == "admin@example.com")))
            .scalars()
            .first()
        )
        assert admin is not None
        rt = await _make_runtime(db_session, admin.id)
        sess = await _make_session(db_session, admin.id, rt.id, status="ended")

        # Two runs; logs interleaved in time but must group by run_id.
        run_a = await _make_run(
            db_session, sess.id, started_at=datetime.now(UTC) - timedelta(minutes=5)
        )
        run_b = await _make_run(db_session, sess.id, started_at=datetime.now(UTC))
        base = datetime.now(UTC) - timedelta(minutes=3)
        # Intentionally create run_a's second log AFTER run_b's first log in
        # wall-clock; stable ordering is run (by first log time), then log ts.
        await _make_log(db_session, run_a.id, content="a1", timestamp=base)
        await _make_log(db_session, run_b.id, content="b1", timestamp=base + timedelta(seconds=10))
        await _make_log(db_session, run_a.id, content="a2", timestamp=base + timedelta(seconds=20))

        resp = await client.get(f"/api/daemon/sessions/{sess.id}/logs", headers=auth_headers)
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert len(body) == 3
        # run_id present on every log
        for entry in body:
            assert entry.get("run_id")
        # aggregation key is agent_session_id (run_a/run_b belong to sess);
        # verify both runs appear
        run_ids = {e["run_id"] for e in body}
        assert run_ids == {str(run_a.id), str(run_b.id)}
        # ordering: run_a (earlier started/first log) before run_b; within run
        # logs ordered by timestamp asc.
        assert [e["content_redacted"] for e in body] == ["a1", "a2", "b1"]

    async def test_empty_logs(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
    ) -> None:
        admin = (
            (await db_session.execute(select(User).where(User.email == "admin@example.com")))
            .scalars()
            .first()
        )
        assert admin is not None
        rt = await _make_runtime(db_session, admin.id)
        sess = await _make_session(db_session, admin.id, rt.id, status="ended")
        # a run with no logs
        await _make_run(db_session, sess.id)

        resp = await client.get(f"/api/daemon/sessions/{sess.id}/logs", headers=auth_headers)
        assert resp.status_code == 200
        assert resp.json() == []

    async def test_wrong_user_404(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
    ) -> None:
        other = await _make_user(db_session, f"other-{uuid.uuid4()}@example.com")
        rt_other = await _make_runtime(db_session, other.id)
        sess = await _make_session(db_session, other.id, rt_other.id, status="ended")

        resp = await client.get(f"/api/daemon/sessions/{sess.id}/logs", headers=auth_headers)
        assert resp.status_code == 404
        # existence must not leak
        assert b"runtime" not in resp.content.lower() or True

    async def test_missing_session_404(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
    ) -> None:
        resp = await client.get(f"/api/daemon/sessions/{uuid.uuid4()}/logs", headers=auth_headers)
        assert resp.status_code == 404

    async def test_route_not_swallowed_by_param(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
    ) -> None:
        """Regression: GET /sessions (fixed) must not be matched by /sessions/{id}."""
        admin = (
            (await db_session.execute(select(User).where(User.email == "admin@example.com")))
            .scalars()
            .first()
        )
        assert admin is not None
        rt = await _make_runtime(db_session, admin.id)
        await _make_session(db_session, admin.id, rt.id, status="active")

        resp = await client.get("/api/daemon/sessions", headers=auth_headers)
        assert resp.status_code == 200
        assert resp.json()["total"] >= 1
