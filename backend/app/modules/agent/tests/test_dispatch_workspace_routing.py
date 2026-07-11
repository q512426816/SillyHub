"""Tests for dispatch_to_daemon workspace-bound routing.

Change ``2026-07-10-remove-server-local-workspace-mode`` (D-007)：server-local
workspace 模式已删除，所有 workspace 永远 daemon-client，绑定真相源唯一为
``WorkspaceMemberRuntime``（per-member binding）。

覆盖：
- 有 binding 行 + bound daemon 在线 → 派发到对应 runtime。
- bound daemon 离线 / 不存在 / 跨用户 → ``NoOnlineDaemonError``。
- 无 binding 行（workspace 未绑定）→ ``NoOnlineDaemonError(runtime_id=None)``。
- 无 workspace_id → ``NoOnlineDaemonError``。
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
from app.modules.daemon.model import DaemonInstance, DaemonRuntime, DaemonTaskLease
from app.modules.workspace.member_runtimes.model import WorkspaceMemberRuntime
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


async def _create_daemon_instance(
    session,
    user_id: uuid.UUID,
    *,
    status: str = "online",
) -> DaemonInstance:
    di = DaemonInstance(
        id=uuid.uuid4(),
        user_id=user_id,
        hostname=f"host-{uuid.uuid4().hex[:6]}",
        server_url="http://localhost:8000",
        status=status,
        last_heartbeat_at=datetime.now(UTC) if status == "online" else None,
    )
    session.add(di)
    await session.commit()
    await session.refresh(di)
    return di


async def _create_runtime(
    session,
    user_id: uuid.UUID,
    *,
    provider: str = "claude_code",
    status: str = "online",
    daemon_instance_id: uuid.UUID | None = None,
) -> DaemonRuntime:
    rt = DaemonRuntime(
        id=uuid.uuid4(),
        user_id=user_id,
        daemon_instance_id=daemon_instance_id,
        name=f"daemon-{uuid.uuid4().hex[:6]}",
        provider=provider,
        status=status,
        last_heartbeat_at=datetime.now(UTC) if status == "online" else None,
    )
    session.add(rt)
    await session.commit()
    await session.refresh(rt)
    return rt


async def _create_workspace(
    session,
    *,
    user_id: uuid.UUID | None = None,
    default_agent: str | None = None,
) -> Workspace:
    """Build a workspace. D-007：path_source/daemon_runtime_id 列已删除，
    绑定完全由 WorkspaceMemberRuntime 行承载。"""
    ws = Workspace(
        id=uuid.uuid4(),
        name=f"ws-{uuid.uuid4().hex[:6]}",
        slug=f"slug-{uuid.uuid4().hex[:8]}",
        root_path=f"/tmp/{uuid.uuid4().hex[:8]}",
        default_agent=default_agent,
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
    daemon_id: uuid.UUID | None = None,
    root_path: str = "/tmp/binding-path",
) -> None:
    binding = WorkspaceMemberRuntime(
        workspace_id=workspace_id,
        user_id=user_id,
        runtime_id=None,
        daemon_id=daemon_id,
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


async def _fetch_lease(session, lease_id) -> DaemonTaskLease:
    return await session.get(DaemonTaskLease, lease_id)


# ---- T2: binding routes to bound daemon's runtime ----------------------------


@pytest.mark.asyncio
async def test_t2_daemon_client_routes_to_bound_runtime(db_session):
    user_id = await _create_user(db_session)
    di = await _create_daemon_instance(db_session, user_id)
    # An "online" stray runtime on a different daemon that should NOT be selected.
    await _create_runtime(db_session, user_id, provider="claude_code")
    target_rt = await _create_runtime(
        db_session, user_id, provider="claude_code", daemon_instance_id=di.id
    )
    ws = await _create_workspace(db_session, user_id=user_id, default_agent="claude_code")
    await _create_member_binding(db_session, workspace_id=ws.id, user_id=user_id, daemon_id=di.id)
    run = await _create_agent_run(db_session)

    placement = RunPlacementService(db_session)
    lease_id = await placement.dispatch_to_daemon(run.id, user_id, workspace_id=ws.id)

    assert lease_id is not None
    assert await _lease_runtime_id(db_session, lease_id) == target_rt.id


# ---- T3: bound daemon offline -----------------------------------------------


@pytest.mark.asyncio
async def test_t3_daemon_client_bound_offline_raises(db_session):
    user_id = await _create_user(db_session)
    offline_di = await _create_daemon_instance(db_session, user_id, status="offline")
    await _create_runtime(
        db_session, user_id, provider="claude_code", daemon_instance_id=offline_di.id
    )
    ws = await _create_workspace(db_session, user_id=user_id, default_agent="claude_code")
    await _create_member_binding(
        db_session, workspace_id=ws.id, user_id=user_id, daemon_id=offline_di.id
    )
    run = await _create_agent_run(db_session)

    placement = RunPlacementService(db_session)
    with pytest.raises(NoOnlineDaemonError) as ei:
        await placement.dispatch_to_daemon(run.id, user_id, workspace_id=ws.id)
    assert "离线或不存在" in ei.value.message


# ---- T4: bound daemon missing entirely --------------------------------------


@pytest.mark.asyncio
async def test_t4_daemon_client_bound_daemon_missing_raises(db_session):
    user_id = await _create_user(db_session)
    bogus_daemon_id = uuid.uuid4()
    ws = await _create_workspace(db_session, user_id=user_id, default_agent="claude_code")
    await _create_member_binding(
        db_session, workspace_id=ws.id, user_id=user_id, daemon_id=bogus_daemon_id
    )
    run = await _create_agent_run(db_session)

    placement = RunPlacementService(db_session)
    with pytest.raises(NoOnlineDaemonError) as ei:
        await placement.dispatch_to_daemon(run.id, user_id, workspace_id=ws.id)
    assert "离线或不存在" in ei.value.message


# ---- T5: workspace with no binding row --------------------------------------


@pytest.mark.asyncio
async def test_t5_daemon_client_unbound_raises(db_session):
    user_id = await _create_user(db_session)
    # User has an online runtime, but the workspace has no binding row.
    await _create_runtime(db_session, user_id, provider="claude_code")
    ws = await _create_workspace(db_session, user_id=user_id, default_agent="claude_code")
    run = await _create_agent_run(db_session)

    placement = RunPlacementService(db_session)
    with pytest.raises(NoOnlineDaemonError) as ei:
        await placement.dispatch_to_daemon(run.id, user_id, workspace_id=ws.id)
    assert ei.value.runtime_id is None
    assert "未绑定守护进程" in ei.value.message


# ---- T6: cross-user bound daemon rejected -----------------------------------


@pytest.mark.asyncio
async def test_t6_daemon_client_cross_user_daemon_rejected(db_session):
    user_id = await _create_user(db_session, suffix="owner")
    other_id = await _create_user(db_session, suffix="other")
    other_di = await _create_daemon_instance(db_session, other_id)
    await _create_runtime(
        db_session, other_id, provider="claude_code", daemon_instance_id=other_di.id
    )
    ws = await _create_workspace(db_session, user_id=user_id, default_agent="claude_code")
    await _create_member_binding(
        db_session, workspace_id=ws.id, user_id=user_id, daemon_id=other_di.id
    )
    run = await _create_agent_run(db_session)

    placement = RunPlacementService(db_session)
    with pytest.raises(NoOnlineDaemonError) as ei:
        await placement.dispatch_to_daemon(run.id, user_id, workspace_id=ws.id)
    assert "离线或不存在" in ei.value.message


# ---- T8: provider mismatch on bound daemon -> D-008 -------------------------


@pytest.mark.asyncio
async def test_t8_provider_mismatch_raises_d008(db_session):
    user_id = await _create_user(db_session)
    di = await _create_daemon_instance(db_session, user_id)
    # Daemon only enables codex, but workspace default_agent = claude_code.
    await _create_runtime(db_session, user_id, provider="codex", daemon_instance_id=di.id)
    ws = await _create_workspace(db_session, user_id=user_id, default_agent="claude_code")
    await _create_member_binding(db_session, workspace_id=ws.id, user_id=user_id, daemon_id=di.id)
    run = await _create_agent_run(db_session)

    placement = RunPlacementService(db_session)
    with pytest.raises(NoOnlineDaemonError) as ei:
        await placement.dispatch_to_daemon(run.id, user_id, workspace_id=ws.id)
    # D-008: message mentions requested provider + enabled providers.
    assert "claude_code" in ei.value.message
    assert "codex" in ei.value.message


# ---- T10: decide_backend daemon-client aware --------------------------------


@pytest.mark.asyncio
async def test_t10_decide_backend_daemon_client_offline_raises(db_session):
    user_id = await _create_user(db_session)
    # User-level online runtime exists to prove decide did NOT fall back to it.
    await _create_runtime(db_session, user_id, status="online")
    offline_di = await _create_daemon_instance(db_session, user_id, status="offline")
    ws = await _create_workspace(db_session, user_id=user_id, default_agent="claude_code")
    await _create_member_binding(
        db_session, workspace_id=ws.id, user_id=user_id, daemon_id=offline_di.id
    )

    placement = RunPlacementService(db_session)
    with pytest.raises(NoOnlineDaemonError):
        await placement.decide_backend(workspace_id=ws.id, user_id=user_id)


@pytest.mark.asyncio
async def test_t10b_decide_backend_daemon_client_online_returns_daemon(db_session):
    user_id = await _create_user(db_session)
    di = await _create_daemon_instance(db_session, user_id, status="online")
    await _create_runtime(db_session, user_id, status="online", daemon_instance_id=di.id)
    ws = await _create_workspace(db_session, user_id=user_id, default_agent="claude_code")
    await _create_member_binding(db_session, workspace_id=ws.id, user_id=user_id, daemon_id=di.id)

    placement = RunPlacementService(db_session)
    backend = await placement.decide_backend(workspace_id=ws.id, user_id=user_id)
    assert backend.value == "daemon"
