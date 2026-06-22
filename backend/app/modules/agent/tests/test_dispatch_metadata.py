"""Tests for dispatch_to_daemon context-field persistence (task-03).

Covers AC-01..05 of ``2026-06-14-unified-agent-execution`` task-03:

- AC-01: ``dispatch_to_daemon(repo_url=..., branch=...)`` persists the bundle
  context into ``daemon_task_leases.metadata``.
- AC-02: stage-run fields (``prompt``/``step_prompt``/``stage``/``read_only``)
  are persisted; ``read_only=False`` is NOT swallowed by a truthy guard.
- AC-03: scan-run fields (``root_path``/``spec_root``/``runtime_root``) are
  persisted.
- AC-04: ``None`` (unset) context fields are omitted from metadata.
- AC-04b: legacy 2-positional-arg call stays compatible (design §9).
- AC-05: ``_build_claim_payload`` propagates the bundle fields (``repo_url``/
  ``branch``/``allowed_paths``/``tool_config``/``timeout_seconds``) from lease
  metadata into the daemon claim payload.

These also form the skeleton that task-11 (backend pytest suite) reuses.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest

from app.modules.agent.model import AgentRun
from app.modules.agent.placement import RunPlacementService
from app.modules.auth.model import User
from app.modules.daemon.lease.context import build_claim_payload
from app.modules.daemon.model import DaemonRuntime, DaemonTaskLease

# ---- Test helpers ------------------------------------------------------------


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


async def _create_agent_run(session, agent_type: str = "claude_code") -> AgentRun:
    run = AgentRun(id=uuid.uuid4(), agent_type=agent_type, status="pending")
    session.add(run)
    await session.commit()
    await session.refresh(run)
    return run


async def _fetch_lease(session, lease_id) -> DaemonTaskLease:
    return await session.get(DaemonTaskLease, lease_id)


# ---- AC-01: repo_url / branch ------------------------------------------------


@pytest.mark.asyncio
async def test_dispatch_to_daemon_writes_repo_branch(db_session):
    user_id = await _create_user(db_session)
    await _create_runtime(db_session, user_id)
    run = await _create_agent_run(db_session)

    placement = RunPlacementService(db_session)
    lease_id = await placement.dispatch_to_daemon(
        run.id,
        user_id,
        repo_url="https://github.com/acme/repo.git",
        branch="dev",
    )

    assert lease_id is not None
    meta = (await _fetch_lease(db_session, lease_id)).metadata_ or {}
    assert meta["repo_url"] == "https://github.com/acme/repo.git"
    assert meta["branch"] == "dev"


# ---- AC-02: stage fields (read_only=False preserved) -------------------------


@pytest.mark.asyncio
async def test_dispatch_to_daemon_writes_stage_fields(db_session):
    user_id = await _create_user(db_session)
    await _create_runtime(db_session, user_id)
    run = await _create_agent_run(db_session)

    placement = RunPlacementService(db_session)
    lease_id = await placement.dispatch_to_daemon(
        run.id,
        user_id,
        prompt="P",
        step_prompt="S",
        stage="implementation",
        read_only=False,
    )

    meta = (await _fetch_lease(db_session, lease_id)).metadata_ or {}
    assert meta["prompt"] == "P"
    assert meta["step_prompt"] == "S"
    assert meta["stage"] == "implementation"
    # read_only=False MUST be persisted (not swallowed by `if read_only:`).
    assert meta["read_only"] is False


# ---- AC-03: scan fields ------------------------------------------------------


@pytest.mark.asyncio
async def test_dispatch_to_daemon_writes_scan_fields(db_session):
    user_id = await _create_user(db_session)
    await _create_runtime(db_session, user_id)
    run = await _create_agent_run(db_session)

    placement = RunPlacementService(db_session)
    lease_id = await placement.dispatch_to_daemon(
        run.id,
        user_id,
        root_path="/r",
        spec_root="/s",
        runtime_root="/rt",
    )

    meta = (await _fetch_lease(db_session, lease_id)).metadata_ or {}
    assert meta["root_path"] == "/r"
    assert meta["spec_root"] == "/s"
    assert meta["runtime_root"] == "/rt"


# ---- AC-04: None fields omitted ----------------------------------------------


@pytest.mark.asyncio
async def test_dispatch_to_daemon_omits_none_fields(db_session):
    user_id = await _create_user(db_session)
    await _create_runtime(db_session, user_id)
    run = await _create_agent_run(db_session)

    placement = RunPlacementService(db_session)
    lease_id = await placement.dispatch_to_daemon(run.id, user_id, prompt="P")

    meta = (await _fetch_lease(db_session, lease_id)).metadata_ or {}
    assert meta["prompt"] == "P"
    assert "repo_url" not in meta
    assert "branch" not in meta
    assert "stage" not in meta
    assert "root_path" not in meta


# ---- AC-04b: backward compatible 2-positional-arg call -----------------------


@pytest.mark.asyncio
async def test_dispatch_to_daemon_backward_compatible_2_args(db_session):
    user_id = await _create_user(db_session)
    await _create_runtime(db_session, user_id)
    run = await _create_agent_run(db_session)

    placement = RunPlacementService(db_session)
    # Legacy 2-positional-arg call must still work (design §9 brownfield).
    lease_id = await placement.dispatch_to_daemon(run.id, user_id)

    assert lease_id is not None
    lease = await _fetch_lease(db_session, lease_id)
    assert lease.status == "pending"


@pytest.mark.asyncio
async def test_dispatch_to_daemon_writes_provider_model(db_session):
    user_id = await _create_user(db_session)
    await _create_runtime(db_session, user_id)
    run = await _create_agent_run(db_session)

    placement = RunPlacementService(db_session)
    lease_id = await placement.dispatch_to_daemon(
        run.id,
        user_id,
        provider="codex",
        model="gpt-5-codex",
    )

    meta = (await _fetch_lease(db_session, lease_id)).metadata_ or {}
    assert meta["provider"] == "codex"
    assert meta["model"] == "gpt-5-codex"


# ---- AC-05: _build_claim_payload propagates bundle fields --------------------


@pytest.mark.asyncio
async def test_build_claim_payload_propagates_bundle_fields(db_session):
    user_id = await _create_user(db_session)
    rt = await _create_runtime(db_session, user_id)
    run = await _create_agent_run(db_session)

    bundle_meta = {
        "repo_url": "https://github.com/acme/repo.git",
        "branch": "main",
        "allowed_paths": ["src/", "tests/"],
        "tool_config": {"max_tokens": 8192},
        "timeout_seconds": 300,
        "model": "claude-sonnet-4",
    }
    lease = DaemonTaskLease(
        id=uuid.uuid4(),
        runtime_id=rt.id,
        agent_run_id=run.id,
        status="claimed",
        metadata_=bundle_meta,
    )
    db_session.add(lease)
    await db_session.commit()

    payload = await build_claim_payload(db_session, lease)

    assert payload["repo_url"] == "https://github.com/acme/repo.git"
    assert payload["branch"] == "main"
    assert payload["allowed_paths"] == ["src/", "tests/"]
    assert payload["tool_config"] == {"max_tokens": 8192}
    assert payload["timeout_seconds"] == 300
    assert payload["model"] == "claude-sonnet-4"
