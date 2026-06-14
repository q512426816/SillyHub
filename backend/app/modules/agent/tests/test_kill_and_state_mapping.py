"""Tests for kill_run daemon lease cancellation + state mapping (task-04).

Covers AC-01..09 of ``2026-06-14-unified-agent-execution`` task-04:

- kill_run delegates to ``DaemonLeaseService.cancel_lease`` (AC-03/04).
- kill_run does NOT directly write ``run.status = "killed"`` (AC-09); the
  AgentRun status is driven asynchronously by the daemon via
  ``sync_agent_run_status``.
- No SERVER-side remnants (``_proc_registry`` / ``SIGTERM`` / ``SIGKILL`` /
  ``collect_diff``) (AC-01/02).
- Lease.status → AgentRun.status single-driver mapping (AC-05/06/07/08).
"""

from __future__ import annotations

import inspect
import uuid
from datetime import UTC, datetime, timedelta

import pytest

from app.core.errors import AgentRunNotFound
from app.modules.agent.model import AgentRun
from app.modules.agent.service import AgentService
from app.modules.auth.model import User
from app.modules.daemon.lease_service import DaemonLeaseService
from app.modules.daemon.model import DaemonRuntime, DaemonTaskLease
from app.modules.daemon.service import DaemonService

# ---- Helpers -----------------------------------------------------------------


async def _create_user(session) -> uuid.UUID:
    uid = uuid.uuid4()
    session.add(
        User(
            id=uid,
            email=f"test-{uid}@example.com",
            password_hash="irrelevant",
            display_name="Test",
            status="active",
        )
    )
    await session.commit()
    return uid


async def _create_runtime(session, user_id: uuid.UUID) -> DaemonRuntime:
    rt = DaemonRuntime(
        id=uuid.uuid4(),
        user_id=user_id,
        name="test-daemon",
        provider="claude_code",
        status="online",
        last_heartbeat_at=datetime.now(UTC),
    )
    session.add(rt)
    await session.commit()
    await session.refresh(rt)
    return rt


async def _create_agent_run(session, status: str = "pending") -> AgentRun:
    run = AgentRun(id=uuid.uuid4(), agent_type="claude_code", status=status)
    session.add(run)
    await session.commit()
    await session.refresh(run)
    return run


async def _make_claimed_lease(
    session,
    agent_run_id: uuid.UUID,
    runtime_id: uuid.UUID,
    *,
    attempt: int = 1,
    expires_in_past: bool = False,
) -> DaemonTaskLease:
    now = datetime.now(UTC)
    expires = now - timedelta(seconds=10) if expires_in_past else now + timedelta(seconds=60)
    lease = DaemonTaskLease(
        id=uuid.uuid4(),
        runtime_id=runtime_id,
        agent_run_id=agent_run_id,
        status="claimed",
        claimed_at=now,
        lease_expires_at=expires,
        attempt_number=attempt,
        metadata_={"claim_token": "tok"},
    )
    session.add(lease)
    await session.commit()
    await session.refresh(lease)
    return lease


# ---- AC-04: kill_run calls cancel_lease --------------------------------------


@pytest.mark.asyncio
async def test_kill_run_calls_cancel_lease(db_session, monkeypatch):
    user_id = await _create_user(db_session)
    rt = await _create_runtime(db_session, user_id)
    run = await _create_agent_run(db_session, status="running")
    await _make_claimed_lease(db_session, run.id, rt.id)

    calls: list[uuid.UUID] = []

    async def _spy(self, agent_run_id):
        calls.append(agent_run_id)

    monkeypatch.setattr(DaemonLeaseService, "cancel_lease", _spy)

    result = await AgentService(db_session).kill_run(run.id)

    assert calls == [run.id]
    assert result.id == run.id
    # AC-09: kill_run must NOT write killed; status stays as-is until daemon reports.
    assert result.status == "running"


# ---- AC-09: kill_run does not directly mutate status -------------------------


@pytest.mark.asyncio
async def test_kill_run_does_not_write_killed_directly(db_session):
    user_id = await _create_user(db_session)
    rt = await _create_runtime(db_session, user_id)
    run = await _create_agent_run(db_session, status="running")
    lease = await _make_claimed_lease(db_session, run.id, rt.id)

    await AgentService(db_session).kill_run(run.id)

    refreshed = await db_session.get(AgentRun, run.id)
    assert refreshed.status == "running"  # NOT killed
    # The lease IS cancelled (cancel_lease actually ran).
    refreshed_lease = await db_session.get(DaemonTaskLease, lease.id)
    assert refreshed_lease.status == "cancelled"


# ---- AC-08: idempotent when no active lease ----------------------------------


@pytest.mark.asyncio
async def test_kill_run_idempotent_no_active_lease(db_session):
    await _create_user(db_session)
    run = await _create_agent_run(db_session, status="running")
    # No lease created → cancel_lease finds none → log warning + return.

    result = await AgentService(db_session).kill_run(run.id)  # must not raise

    assert result.id == run.id


# ---- AC: AgentRunNotFound ----------------------------------------------------


@pytest.mark.asyncio
async def test_kill_run_not_found(db_session):
    with pytest.raises(AgentRunNotFound):
        await AgentService(db_session).kill_run(uuid.uuid4())


# ---- AC-01/02: static grep of service.py -------------------------------------


def test_kill_run_no_proc_registry():
    import app.modules.agent.service as svc_mod

    src = inspect.getsource(svc_mod)
    assert "_proc_registry" not in src
    assert "SIGTERM" not in src
    assert "SIGKILL" not in src


def test_kill_run_no_collect_diff():
    import app.modules.agent.service as svc_mod

    src = inspect.getsource(svc_mod)
    assert "collect_diff" not in src


# ---- State mapping (single driver) -------------------------------------------


@pytest.mark.asyncio
async def test_state_mapping_claimed_to_running(db_session):
    user_id = await _create_user(db_session)
    rt = await _create_runtime(db_session, user_id)
    run = await _create_agent_run(db_session, status="pending")
    lease = await _make_claimed_lease(db_session, run.id, rt.id)

    updated = await DaemonService(db_session).sync_agent_run_status(lease.id, "tok", "running")

    assert updated.status == "running"
    assert updated.started_at is not None


@pytest.mark.asyncio
async def test_state_mapping_cancelled_to_killed(db_session):
    user_id = await _create_user(db_session)
    rt = await _create_runtime(db_session, user_id)
    run = await _create_agent_run(db_session, status="running")
    lease = await _make_claimed_lease(db_session, run.id, rt.id)

    # kill_run → cancel_lease; daemon later reports killed via sync_agent_run_status.
    await AgentService(db_session).kill_run(run.id)
    updated = await DaemonService(db_session).sync_agent_run_status(lease.id, "tok", "killed")

    assert updated.status == "killed"


@pytest.mark.asyncio
async def test_state_mapping_completed(db_session):
    user_id = await _create_user(db_session)
    rt = await _create_runtime(db_session, user_id)
    run = await _create_agent_run(db_session, status="running")
    lease = await _make_claimed_lease(db_session, run.id, rt.id)

    await DaemonService(db_session).complete_lease(lease.id, "tok", {"status": "completed"})

    assert (await db_session.get(AgentRun, run.id)).status == "completed"


@pytest.mark.asyncio
async def test_state_mapping_expired_to_failed(db_session):
    user_id = await _create_user(db_session)
    rt = await _create_runtime(db_session, user_id)
    run = await _create_agent_run(db_session, status="running")
    # attempt=3 → max retries reached → failed
    await _make_claimed_lease(db_session, run.id, rt.id, attempt=3, expires_in_past=True)

    count = await DaemonService(db_session).handle_expired_leases_batch()

    assert count >= 1
    assert (await db_session.get(AgentRun, run.id)).status == "failed"
