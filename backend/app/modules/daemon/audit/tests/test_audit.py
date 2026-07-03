"""Tests for the daemon audit service + endpoints (task-10 / D-006@v1).

Covers:
- POST /api/daemon/audit/batch: claim_token valid → batch insert; wrong token /
  cross-runtime token → 403; over-cap batch → 422 (schema max_length).
- GET .../policy-audit: pagination + filters (decision/provider/tool/path) and
  created_at DESC ordering.
- service.cleanup_old (R-05).

Calls the endpoint async functions directly (function == endpoint), passing a
mock User, mirroring test_change_write_router.py. SQLite in-memory via the
shared ``db_session`` fixture.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from typing import Any

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.daemon.audit.model import PolicyAuditLog
from app.modules.daemon.audit.router import (
    list_policy_audit,
    post_audit_batch,
)
from app.modules.daemon.audit.schema import (
    AUDIT_BATCH_MAX_EVENTS,
    AuditBatchRequest,
    AuditEventIn,
)
from app.modules.daemon.audit.service import (
    AUDIT_RETENTION_DAYS,
    AuditService,
    DaemonAuditAuthDenied,
    DaemonAuditRuntimeMismatch,
)
from app.modules.daemon.model import DaemonRuntime
from app.modules.daemon.tests.test_lease_service import (
    _create_runtime,
    _create_user,
)

# ── Helpers ──────────────────────────────────────────────────────────────────


async def _create_lease_claimed(
    session: AsyncSession,
    *,
    runtime_id: uuid.UUID,
    claim_token: str,
) -> uuid.UUID:
    """Insert a claimed DaemonTaskLease carrying the given claim_token."""
    from app.modules.agent.model import AgentRun
    from app.modules.daemon.model import DaemonTaskLease

    user_id = (await session.get(DaemonRuntime, runtime_id)).user_id  # type: ignore[union-attr]
    agent_run = AgentRun(
        id=uuid.uuid4(),
        user_id=user_id,
        agent_type="daemon",
        provider="claude_code",
        status="running",
        started_at=datetime.now(UTC),
    )
    session.add(agent_run)
    await session.flush()
    now = datetime.now(UTC)
    lease = DaemonTaskLease(
        id=uuid.uuid4(),
        runtime_id=runtime_id,
        agent_run_id=agent_run.id,
        status="claimed",
        claimed_at=now,
        lease_expires_at=now + timedelta(minutes=10),
        attempt_number=1,
        metadata_={"claim_token": claim_token},
        created_at=now,
        updated_at=now,
    )
    session.add(lease)
    await session.commit()
    return lease.id


def _event(decision: str = "ALLOW", **kw: Any) -> AuditEventIn:
    base: dict[str, Any] = {
        "decision": decision,  # type: ignore[dict-item]
        "provider": "claude",
        "tool": "Write",
        "path": "/tmp/a.txt",
        "reason": "",
        "ts": datetime.now(UTC),
    }
    base.update(kw)
    return AuditEventIn(**base)  # type: ignore[arg-type]


def _user(uid: uuid.UUID) -> SimpleNamespace:
    return SimpleNamespace(id=uid, is_platform_admin=True, email="x@x")


# ── Service: auth ────────────────────────────────────────────────────────────


class TestVerifyClaimToken:
    @pytest.mark.asyncio
    async def test_valid_token_accepted(self, db_session: AsyncSession) -> None:
        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)
        token = "tok-" + uuid.uuid4().hex
        await _create_lease_claimed(db_session, runtime_id=rt.id, claim_token=token)
        svc = AuditService(db_session)
        lease = await svc._verify_claim_token(rt.id, token)
        assert lease.runtime_id == rt.id

    @pytest.mark.asyncio
    async def test_wrong_token_denied(self, db_session: AsyncSession) -> None:
        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)
        await _create_lease_claimed(db_session, runtime_id=rt.id, claim_token="real")
        svc = AuditService(db_session)
        with pytest.raises(DaemonAuditAuthDenied):
            await svc._verify_claim_token(rt.id, "wrong")

    @pytest.mark.asyncio
    async def test_token_other_runtime_mismatch(self, db_session: AsyncSession) -> None:
        uid = await _create_user(db_session)
        rt_a = await _create_runtime(db_session, uid)
        rt_b = await _create_runtime(db_session, uid)
        token = "tok-" + uuid.uuid4().hex
        # token bound to rt_a, presented for rt_b
        await _create_lease_claimed(db_session, runtime_id=rt_a.id, claim_token=token)
        svc = AuditService(db_session)
        with pytest.raises(DaemonAuditRuntimeMismatch):
            await svc._verify_claim_token(rt_b.id, token)


# ── Service: batch_insert + query ────────────────────────────────────────────


class TestBatchInsertQuery:
    @pytest.mark.asyncio
    async def test_batch_insert_writes_rows(self, db_session: AsyncSession) -> None:
        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)
        ws = uuid.uuid4()
        svc = AuditService(db_session)
        events = [_event("ALLOW", path="/tmp/1"), _event("DENY", reason="outside")]
        n = await svc.batch_insert(rt.id, events, workspace_id=ws)
        assert n == 2
        rows = (await db_session.execute(select(PolicyAuditLog))).scalars().all()
        assert len(rows) == 2
        assert {r.workspace_id for r in rows} == {ws}

    @pytest.mark.asyncio
    async def test_query_pagination_and_order(self, db_session: AsyncSession) -> None:
        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)
        ws = uuid.uuid4()
        svc = AuditService(db_session)
        base = datetime.now(UTC) - timedelta(minutes=10)
        events = [
            _event("ALLOW", path=f"/tmp/o{i}", ts=base + timedelta(seconds=i)) for i in range(5)
        ]
        await svc.batch_insert(rt.id, events, workspace_id=ws)
        items, total = await svc.query(workspace_id=ws, runtime_id=rt.id, limit=2, offset=0)
        assert total == 5
        assert len(items) == 2
        # DESC: newest first
        assert items[0].created_at >= items[1].created_at

    @pytest.mark.asyncio
    async def test_query_filters(self, db_session: AsyncSession) -> None:
        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)
        ws = uuid.uuid4()
        svc = AuditService(db_session)
        await svc.batch_insert(
            rt.id,
            [
                _event("ALLOW", tool="Write", path="/tmp/a"),
                _event("DENY", tool="Bash", path="/secret/x"),
                _event("ALLOW", tool="Edit", path="/tmp/b"),
            ],
            workspace_id=ws,
        )
        # decision filter
        _, deny_total = await svc.query(workspace_id=ws, runtime_id=rt.id, decision="DENY")
        assert deny_total == 1
        # tool filter
        _, write_total = await svc.query(workspace_id=ws, runtime_id=rt.id, tool="Write")
        assert write_total == 1
        # path substring filter
        _, tmp_total = await svc.query(workspace_id=ws, runtime_id=rt.id, path_contains="/tmp/")
        assert tmp_total == 2
        # provider filter
        _, prov_total = await svc.query(workspace_id=ws, runtime_id=rt.id, provider="claude")
        assert prov_total == 3

    @pytest.mark.asyncio
    async def test_query_other_runtime_excluded(self, db_session: AsyncSession) -> None:
        uid = await _create_user(db_session)
        rt_a = await _create_runtime(db_session, uid)
        rt_b = await _create_runtime(db_session, uid)
        ws = uuid.uuid4()
        svc = AuditService(db_session)
        await svc.batch_insert(rt_a.id, [_event()], workspace_id=ws)
        items, total = await svc.query(workspace_id=ws, runtime_id=rt_b.id)
        assert total == 0 and items == []


class TestCleanup:
    @pytest.mark.asyncio
    async def test_cleanup_old_deletes_aged_rows(self, db_session: AsyncSession) -> None:
        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)
        svc = AuditService(db_session)
        old = datetime.now(UTC) - timedelta(days=AUDIT_RETENTION_DAYS + 5)
        fresh = datetime.now(UTC)
        await svc.batch_insert(rt.id, [_event(ts=old), _event(ts=fresh)])
        deleted = await svc.cleanup_old()
        assert deleted == 1
        _, total = await svc.query(runtime_id=rt.id)
        assert total == 1


# ── Endpoint layer ───────────────────────────────────────────────────────────


class TestPostAuditBatchEndpoint:
    @pytest.mark.asyncio
    async def test_batch_accepted_with_valid_token(self, db_session: AsyncSession) -> None:
        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)
        token = "tok-" + uuid.uuid4().hex
        await _create_lease_claimed(db_session, runtime_id=rt.id, claim_token=token)
        req = AuditBatchRequest(
            runtime_id=rt.id,
            claim_token=token,
            workspace_id=uuid.uuid4(),
            events=[_event("ALLOW"), _event("DENY", reason="x")],
        )
        resp = await post_audit_batch(req, db_session, _user(uid))  # type: ignore[arg-type]
        assert resp.accepted == 2
        assert resp.runtime_id == rt.id

    @pytest.mark.asyncio
    async def test_batch_rejected_bad_token(self, db_session: AsyncSession) -> None:
        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)
        await _create_lease_claimed(db_session, runtime_id=rt.id, claim_token="real")
        req = AuditBatchRequest(
            runtime_id=rt.id,
            claim_token="bogus",
            events=[_event()],
        )
        with pytest.raises(DaemonAuditAuthDenied):
            await post_audit_batch(req, db_session, _user(uid))  # type: ignore[arg-type]

    @pytest.mark.asyncio
    async def test_batch_rejected_cross_runtime_token(self, db_session: AsyncSession) -> None:
        uid = await _create_user(db_session)
        rt_a = await _create_runtime(db_session, uid)
        rt_b = await _create_runtime(db_session, uid)
        token = "tok-" + uuid.uuid4().hex
        await _create_lease_claimed(db_session, runtime_id=rt_a.id, claim_token=token)
        req = AuditBatchRequest(
            runtime_id=rt_b.id,
            claim_token=token,
            events=[_event()],
        )
        with pytest.raises(DaemonAuditRuntimeMismatch):
            await post_audit_batch(req, db_session, _user(uid))  # type: ignore[arg-type]


class TestListPolicyAuditEndpoint:
    @pytest.mark.asyncio
    async def test_list_returns_filtered_page(self, db_session: AsyncSession) -> None:
        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)
        ws = uuid.uuid4()
        svc = AuditService(db_session)
        await svc.batch_insert(
            rt.id,
            [
                _event("ALLOW", tool="Write"),
                _event("DENY", tool="Bash"),
                _event("ALLOW", tool="Write"),
            ],
            workspace_id=ws,
        )
        page = await list_policy_audit(
            workspace_id=ws,
            runtime_id=rt.id,
            session=db_session,
            user=_user(uid),  # type: ignore[arg-type]
            decision="ALLOW",
            provider=None,
            tool=None,
            path=None,
            since=None,
            until=None,
            limit=50,
            offset=0,
        )
        assert page.total == 2
        assert len(page.items) == 2
        assert {i.decision for i in page.items} == {"ALLOW"}

    @pytest.mark.asyncio
    async def test_list_pagination(self, db_session: AsyncSession) -> None:
        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)
        ws = uuid.uuid4()
        svc = AuditService(db_session)
        await svc.batch_insert(
            rt.id,
            [_event("ALLOW", path=f"/p{i}") for i in range(3)],
            workspace_id=ws,
        )
        page = await list_policy_audit(
            workspace_id=ws,
            runtime_id=rt.id,
            session=db_session,
            user=_user(uid),  # type: ignore[arg-type]
            decision=None,
            provider=None,
            tool=None,
            path=None,
            since=None,
            until=None,
            limit=2,
            offset=0,
        )
        assert page.total == 3 and len(page.items) == 2
        page2 = await list_policy_audit(
            workspace_id=ws,
            runtime_id=rt.id,
            session=db_session,
            user=_user(uid),  # type: ignore[arg-type]
            decision=None,
            provider=None,
            tool=None,
            path=None,
            since=None,
            until=None,
            limit=2,
            offset=2,
        )
        assert page2.total == 3 and len(page2.items) == 1


class TestBatchCap:
    def test_schema_enforces_max_events(self) -> None:
        # Over-cap batches must fail validation (422 at the HTTP layer).
        too_many = [_event() for _ in range(AUDIT_BATCH_MAX_EVENTS + 1)]
        with pytest.raises(Exception):
            AuditBatchRequest(
                runtime_id=uuid.uuid4(),
                claim_token="t",
                events=too_many,
            )
