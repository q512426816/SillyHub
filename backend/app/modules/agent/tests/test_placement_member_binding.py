"""Tests for per-member binding routing in RunPlacementService (task-01).

Covers change ``2026-07-02-workspace-config-flow`` task-01:
per-member binding (WorkspaceMemberRuntime) takes priority over legacy
Workspace.daemon_runtime_id global column for _resolve_dispatch_runtime
and _resolve_decide_runtime.

Scenarios:
- T1: Member binding exists, runtime online → dispatch uses binding's runtime.
- T2: Member binding exists, runtime offline → NoOnlineDaemonError(runtime_id).
- T3: Member binding exists, runtime cross-user → NoOnlineDaemonError.
- T4: No member binding row → falls back to workspace global column.
- T5: No member binding, workspace not daemon-client → server-local.
- T6: decide_backend with member binding (online) → DAEMON.
- T7: decide_backend with no member binding → workspace global column.
- T8: prepare_scan_interactive_dispatch uses member binding.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest
from sqlalchemy import text

from app.modules.agent.model import AgentRun
from app.modules.agent.placement import (
    NoOnlineDaemonError,
    RunPlacementService,
)
from app.modules.auth.model import User
from app.modules.daemon.model import DaemonRuntime

# Import to register workspace_member_runtimes table in BaseModel.metadata.
from app.modules.workspace.member_runtimes import model as _wmr_model  # noqa: F401
from app.modules.workspace.model import Workspace

# ---- Test helpers ------------------------------------------------------------


async def _create_user(session, suffix: str = "u") -> uuid.UUID:
    uid = uuid.uuid4()
    session.add(
        User(
            id=uid,
            email=f"test-{suffix}-{uid}@example.com",
            password_hash="x",
            display_name="T",
            status="active",
        )
    )
    await session.commit()
    return uid


async def _create_runtime(
    session,
    user_id: uuid.UUID,
    *,
    provider: str = "claude_code",
    status: str = "online",
) -> DaemonRuntime:
    rt = DaemonRuntime(
        id=uuid.uuid4(),
        user_id=user_id,
        name=f"daemon-{uuid.uuid4().hex[:6]}",
        provider=provider,
        status=status,
        last_heartbeat_at=datetime.now(UTC),
    )
    session.add(rt)
    await session.commit()
    await session.refresh(rt)
    return rt


async def _create_workspace(
    session,
    *,
    user_id: uuid.UUID | None = None,
    path_source: str = "server-local",
    daemon_runtime_id: uuid.UUID | None = None,
) -> Workspace:
    ws = Workspace(
        id=uuid.uuid4(),
        name=f"ws-{uuid.uuid4().hex[:6]}",
        slug=f"slug-{uuid.uuid4().hex[:8]}",
        root_path=f"/tmp/{uuid.uuid4().hex[:8]}",
        path_source=path_source,
        daemon_runtime_id=daemon_runtime_id,
        status="active",
        created_by=user_id,
    )
    session.add(ws)
    await session.commit()
    await session.refresh(ws)
    return ws


async def _create_member_binding(
    session,
    workspace_id: uuid.UUID,
    user_id: uuid.UUID,
    *,
    runtime_id: uuid.UUID | None = None,
    root_path: str = "/tmp/binding-path",
) -> None:
    from app.modules.workspace.member_runtimes.model import WorkspaceMemberRuntime

    binding = WorkspaceMemberRuntime(
        workspace_id=workspace_id,
        user_id=user_id,
        runtime_id=runtime_id,
        root_path=root_path,
        path_source="daemon-client",
    )
    session.add(binding)
    await session.commit()


async def _create_agent_run(session) -> AgentRun:
    run = AgentRun(id=uuid.uuid4(), agent_type="claude_code", status="pending")
    session.add(run)
    await session.commit()
    await session.refresh(run)
    return run


async def _lease_runtime_id(session, lease_id: uuid.UUID) -> uuid.UUID | None:
    result = await session.execute(
        text("SELECT runtime_id FROM daemon_task_leases WHERE id = :id"),
        {"id": lease_id.hex},
    )
    row = result.mappings().first()
    if not row or row["runtime_id"] is None:
        return None
    raw = row["runtime_id"]
    return uuid.UUID(raw) if isinstance(raw, str) else raw


# ---- T1: Member binding routes to binding's runtime (happy path) -------------


@pytest.mark.asyncio
async def test_t1_member_binding_routes_to_binding_runtime(db_session):
    """Per-member binding's runtime_id is used for dispatch."""
    user_id = await _create_user(db_session)
    # Create a stray online runtime that should NOT be selected.
    stray_rt = await _create_runtime(db_session, user_id, provider="claude_code")
    # Create the runtime the binding points to.
    target_rt = await _create_runtime(db_session, user_id, provider="codex")
    ws = await _create_workspace(
        db_session,
        user_id=user_id,
        path_source="daemon-client",
        daemon_runtime_id=stray_rt.id,  # Global column points to stray — should be ignored.
    )
    # Create per-member binding pointing to target_rt.
    await _create_member_binding(
        db_session,
        workspace_id=ws.id,
        user_id=user_id,
        runtime_id=target_rt.id,
    )
    run = await _create_agent_run(db_session)

    placement = RunPlacementService(db_session)
    lease_id = await placement.dispatch_to_daemon(run.id, user_id, workspace_id=ws.id)

    assert lease_id is not None
    # Should have used binding's runtime, NOT stray (which would also be valid
    # under the old global-column logic).
    actual = await _lease_runtime_id(db_session, lease_id)
    assert actual == target_rt.id, f"Expected binding's runtime {target_rt.id}, got {actual}"


# ---- T2: Member binding exists but runtime offline ---------------------------


@pytest.mark.asyncio
async def test_t2_member_binding_offline_runtime_raises(db_session):
    """Offline bound runtime raises NoOnlineDaemonError with runtime_id."""
    user_id = await _create_user(db_session)
    offline_rt = await _create_runtime(db_session, user_id, status="offline")
    ws = await _create_workspace(
        db_session,
        user_id=user_id,
        path_source="daemon-client",
    )
    await _create_member_binding(
        db_session,
        workspace_id=ws.id,
        user_id=user_id,
        runtime_id=offline_rt.id,
    )
    run = await _create_agent_run(db_session)

    placement = RunPlacementService(db_session)
    with pytest.raises(NoOnlineDaemonError) as ei:
        await placement.dispatch_to_daemon(run.id, user_id, workspace_id=ws.id)
    assert ei.value.runtime_id == offline_rt.id


# ---- T3: Member binding exists but runtime belongs to another user -----------


@pytest.mark.asyncio
async def test_t3_member_binding_cross_user_runtime_rejected(db_session):
    """Cross-user bound runtime raises NoOnlineDaemonError."""
    user_id = await _create_user(db_session, suffix="owner")
    other_id = await _create_user(db_session, suffix="other")
    other_rt = await _create_runtime(db_session, other_id)
    ws = await _create_workspace(
        db_session,
        user_id=user_id,
        path_source="daemon-client",
    )
    await _create_member_binding(
        db_session,
        workspace_id=ws.id,
        user_id=user_id,
        runtime_id=other_rt.id,
    )
    run = await _create_agent_run(db_session)

    placement = RunPlacementService(db_session)
    with pytest.raises(NoOnlineDaemonError) as ei:
        await placement.dispatch_to_daemon(run.id, user_id, workspace_id=ws.id)
    assert ei.value.runtime_id == other_rt.id
    assert "不属于当前用户" in ei.value.message


# ---- T4: No member binding → falls back to workspace global column -----------


@pytest.mark.asyncio
async def test_t4_no_member_binding_falls_back_to_global_column(db_session):
    """Without member binding, workspace.daemon_runtime_id is used."""
    user_id = await _create_user(db_session)
    _stray_rt = await _create_runtime(db_session, user_id, provider="claude_code")
    bound_rt = await _create_runtime(db_session, user_id, provider="codex")
    ws = await _create_workspace(
        db_session,
        user_id=user_id,
        path_source="daemon-client",
        daemon_runtime_id=bound_rt.id,
    )
    # Do NOT create a member binding row — should fall back to global column.
    run = await _create_agent_run(db_session)

    placement = RunPlacementService(db_session)
    lease_id = await placement.dispatch_to_daemon(run.id, user_id, workspace_id=ws.id)

    assert lease_id is not None
    actual = await _lease_runtime_id(db_session, lease_id)
    assert actual == bound_rt.id, f"Expected global column runtime {bound_rt.id}, got {actual}"


# ---- T5: No member binding, workspace not daemon-client → server-local -------


@pytest.mark.asyncio
async def test_t5_no_binding_server_local_uses_online_runtime(db_session):
    """Without member binding on server-local, user's online runtime is used."""
    user_id = await _create_user(db_session)
    online_rt = await _create_runtime(db_session, user_id)
    ws = await _create_workspace(
        db_session,
        user_id=user_id,
        path_source="server-local",
    )
    # No member binding — should use server-local path (_get_online_runtime).
    run = await _create_agent_run(db_session)

    placement = RunPlacementService(db_session)
    lease_id = await placement.dispatch_to_daemon(run.id, user_id, workspace_id=ws.id)

    assert lease_id is not None
    actual = await _lease_runtime_id(db_session, lease_id)
    assert actual == online_rt.id


# ---- T6: decide_backend with member binding (online) → DAEMON ---------------


@pytest.mark.asyncio
async def test_t6_decide_backend_member_binding_online(db_session):
    """decide_backend uses member binding's runtime for daemon-client ws."""
    user_id = await _create_user(db_session)
    target_rt = await _create_runtime(db_session, user_id, status="online")
    ws = await _create_workspace(
        db_session,
        user_id=user_id,
        path_source="daemon-client",
    )
    await _create_member_binding(
        db_session,
        workspace_id=ws.id,
        user_id=user_id,
        runtime_id=target_rt.id,
    )

    placement = RunPlacementService(db_session)
    backend = await placement.decide_backend(workspace_id=ws.id, user_id=user_id)
    assert backend.value == "daemon"


# ---- T7: decide_backend with no member binding → workspace global column -----


@pytest.mark.asyncio
async def test_t7_decide_backend_no_binding_falls_back_to_global(db_session):
    """Without member binding, decide_backend uses global column."""
    user_id = await _create_user(db_session)
    target_rt = await _create_runtime(db_session, user_id, status="online")
    ws = await _create_workspace(
        db_session,
        user_id=user_id,
        path_source="daemon-client",
        daemon_runtime_id=target_rt.id,
    )
    # No member binding row — should fall back to global column.

    placement = RunPlacementService(db_session)
    backend = await placement.decide_backend(workspace_id=ws.id, user_id=user_id)
    assert backend.value == "daemon"


# ---- T8: prepare_scan_interactive_dispatch uses member binding ---------------


@pytest.mark.asyncio
async def test_t8_scan_interactive_dispatch_uses_member_binding(db_session):
    """scan interactive dispatch routes via per-member binding."""
    user_id = await _create_user(db_session)
    stray_rt = await _create_runtime(db_session, user_id, provider="claude_code")
    target_rt = await _create_runtime(db_session, user_id, provider="codex")
    ws = await _create_workspace(
        db_session,
        user_id=user_id,
        path_source="daemon-client",
        daemon_runtime_id=stray_rt.id,
    )
    await _create_member_binding(
        db_session,
        workspace_id=ws.id,
        user_id=user_id,
        runtime_id=target_rt.id,
    )

    placement = RunPlacementService(db_session)

    # We cannot fully execute prepare_scan_interactive_dispatch in a unit test
    # because it creates a full interactive lease with workspace metadata.
    # Instead, test that _resolve_dispatch_runtime (internal helper) returns the
    # binding's runtime via a direct dispatch call with known workspace_id.
    session_id = uuid.uuid4()
    run_id = uuid.uuid4()
    dispatch = await placement.prepare_scan_interactive_dispatch(
        agent_session_id=session_id,
        agent_run_id=run_id,
        user_id=user_id,
        provider="codex",
        prompt="scan test prompt",
        model=None,
        root_path="/tmp/scan-path",
        spec_root="/tmp/spec-root",
        workspace_id=ws.id,
    )

    assert dispatch.runtime_id == target_rt.id, (
        f"Expected binding's runtime {target_rt.id}, got {dispatch.runtime_id}"
    )
