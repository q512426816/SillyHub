"""Tests for AgentService.start_init_dispatch (task-06, 2026-07-02-workspace-config-flow).

AC:
- AC-I1: No existing SpecWorkspace → one is auto-created (strategy=platform-managed).
- AC-I2: Existing SpecWorkspace → reused (not duplicated).
- AC-I3: Init lease created with mode='init' and payload fields (workspace_id,
  actor_user_id, runtime_id, root_path, platform_config{server_origin,strategy},
  latest_spec_version).
- AC-I4: Daemon wake-up attempted (returns lease_id/runtime_id/claim_token even
  when daemon is offline; the daemon polls on next cycle).
- AC-X: Raise AgentRunError when member has no daemon runtime configured.
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.service import AgentService
from app.modules.daemon.model import DaemonInstance, DaemonRuntime, DaemonTaskLease
from app.modules.spec_workspace.model import SpecWorkspace
from app.modules.workspace.member_runtimes.model import WorkspaceMemberRuntime
from app.modules.workspace.model import Workspace


async def _create_user(session: AsyncSession) -> uuid.UUID:
    """Insert a User row so FK constraints are satisfied."""
    from app.modules.auth.model import User

    uid = uuid.uuid4()
    session.add(
        User(
            id=uid,
            email=f"init-test-{uid.hex[:8]}@example.com",
            password_hash="irrelevant",
            display_name="Init Test",
            status="active",
        )
    )
    await session.commit()
    return uid


async def _create_daemon_instance(session: AsyncSession, user_id: uuid.UUID) -> DaemonInstance:
    """Insert a DaemonInstance row."""
    inst = DaemonInstance(
        id=uuid.uuid4(),
        user_id=user_id,
        hostname="test-host",
        server_url="http://localhost:8000",
        status="online",
    )
    session.add(inst)
    await session.commit()
    await session.refresh(inst)
    return inst


async def _create_runtime(
    session: AsyncSession, user_id: uuid.UUID, daemon_instance_id: uuid.UUID
) -> DaemonRuntime:
    """Insert a DaemonRuntime row."""
    from datetime import UTC, datetime

    rt = DaemonRuntime(
        id=uuid.uuid4(),
        user_id=user_id,
        daemon_instance_id=daemon_instance_id,
        name="test-init-daemon",
        provider="claude_code",
        status="online",
        last_heartbeat_at=datetime.now(UTC),
    )
    session.add(rt)
    await session.commit()
    await session.refresh(rt)
    return rt


@pytest.mark.asyncio
async def test_start_init_dispatch_creates_spec_workspace_and_lease(
    db_session: AsyncSession,
) -> None:
    """AC-I1 + AC-I3: No existing SpecWorkspace → auto-created; init lease
    created with correct payload fields (mode='init', platform_config,
    latest_spec_version, root_path from binding).
    """
    # ── Setup ───────────────────────────────────────────────────────────────
    user_id = await _create_user(db_session)
    daemon = await _create_daemon_instance(db_session, user_id)
    runtime = await _create_runtime(db_session, user_id, daemon.id)

    workspace = Workspace(
        id=uuid.uuid4(),
        name="Init Test WS",
        slug=f"init-test-{uuid.uuid4().hex[:8]}",
        root_path="/repos/init-test",
        status="active",
    )
    db_session.add(workspace)

    # Per-member binding (with daemon + runtime + root_path)
    member_root_path = "/Users/test/projects/my-project"
    db_session.add(
        WorkspaceMemberRuntime(
            workspace_id=workspace.id,
            user_id=user_id,
            daemon_id=daemon.id,
            runtime_id=runtime.id,
            root_path=member_root_path,
            path_source="daemon-client",
        )
    )
    await db_session.commit()

    # ── Act ─────────────────────────────────────────────────────────────────
    service = AgentService(db_session)
    result = await service.start_init_dispatch(
        workspace_id=workspace.id,
        actor_user_id=user_id,
    )

    # ── Assert spec workspace was auto-created ──────────────────────────────
    spec_ws_stmt = select(SpecWorkspace).where(
        SpecWorkspace.workspace_id == workspace.id,
    )
    spec_ws = (await db_session.execute(spec_ws_stmt)).scalars().first()
    assert spec_ws is not None, "SpecWorkspace should have been auto-created"
    assert spec_ws.strategy == "platform-managed"
    assert spec_ws.spec_version == 0

    # ── Assert lease was created ────────────────────────────────────────────
    lease_stmt = select(DaemonTaskLease).where(
        DaemonTaskLease.id == uuid.UUID(result["lease_id"]),
    )
    lease = (await db_session.execute(lease_stmt)).scalars().first()
    assert lease is not None, "DaemonTaskLease should exist"
    assert lease.kind == "batch", "Lease kind must be batch"
    assert lease.status == "pending"
    assert lease.runtime_id == runtime.id

    # ── Assert lease metadata payload ───────────────────────────────────────
    meta = lease.metadata_ or {}
    assert meta.get("mode") == "init", f"Expected mode='init', got {meta.get('mode')}"
    assert meta.get("workspace_id") == str(workspace.id)
    assert meta.get("actor_user_id") == str(user_id)
    assert meta.get("runtime_id") == str(runtime.id)
    assert meta.get("root_path") == member_root_path

    platform_config = meta.get("platform_config", {})
    assert isinstance(platform_config, dict)
    assert platform_config.get("strategy") == "platform-managed"
    assert platform_config.get("server_origin") == "http://localhost:8000"

    assert meta.get("latest_spec_version") == 0

    # ── Assert return value ─────────────────────────────────────────────────
    assert uuid.UUID(result["lease_id"]) == lease.id
    assert uuid.UUID(result["runtime_id"]) == runtime.id
    assert len(result["claim_token"]) == 64  # secrets.token_hex(32)


@pytest.mark.asyncio
async def test_start_init_dispatch_reuses_existing_spec_workspace(
    db_session: AsyncSession,
) -> None:
    """AC-I2: Existing SpecWorkspace → reused, not duplicated."""
    user_id = await _create_user(db_session)
    daemon = await _create_daemon_instance(db_session, user_id)
    runtime = await _create_runtime(db_session, user_id, daemon.id)

    workspace = Workspace(
        id=uuid.uuid4(),
        name="Init Test WS Existing",
        slug=f"init-existing-{uuid.uuid4().hex[:8]}",
        root_path="/repos/init-existing",
        status="active",
    )
    db_session.add(workspace)
    # Pre-create the spec workspace
    db_session.add(
        SpecWorkspace(
            id=uuid.uuid4(),
            workspace_id=workspace.id,
            spec_root=f"/data/spec-workspaces/{workspace.id}",
            strategy="platform-managed",
            spec_version=3,
        )
    )
    db_session.add(
        WorkspaceMemberRuntime(
            workspace_id=workspace.id,
            user_id=user_id,
            daemon_id=daemon.id,
            runtime_id=runtime.id,
            root_path="/Users/test/proj",
            path_source="daemon-client",
        )
    )
    await db_session.commit()

    service = AgentService(db_session)
    result = await service.start_init_dispatch(
        workspace_id=workspace.id,
        actor_user_id=user_id,
    )

    # Exactly one SpecWorkspace row
    spec_ws_stmt = select(SpecWorkspace).where(
        SpecWorkspace.workspace_id == workspace.id,
    )
    rows = (await db_session.execute(spec_ws_stmt)).scalars().all()
    assert len(rows) == 1
    assert rows[0].spec_version == 3  # preserved

    # Lease latest_spec_version reflects existing row
    lease_stmt = select(DaemonTaskLease).where(
        DaemonTaskLease.id == uuid.UUID(result["lease_id"]),
    )
    lease = (await db_session.execute(lease_stmt)).scalars().first()
    assert lease is not None
    meta = lease.metadata_ or {}
    assert meta.get("latest_spec_version") == 3


@pytest.mark.asyncio
async def test_start_init_dispatch_raises_when_no_runtime(
    db_session: AsyncSession,
) -> None:
    """AC-X: Raise AgentRunError when member binding has no runtime_id."""
    user_id = await _create_user(db_session)

    workspace = Workspace(
        id=uuid.uuid4(),
        name="Init Test NoRuntime",
        slug=f"init-nort-{uuid.uuid4().hex[:8]}",
        root_path="/repos/init-nort",
        status="active",
    )
    db_session.add(workspace)
    # Binding WITHOUT runtime_id
    db_session.add(
        WorkspaceMemberRuntime(
            workspace_id=workspace.id,
            user_id=user_id,
            runtime_id=None,
            root_path="/Users/test/proj",
            path_source="daemon-client",
        )
    )
    await db_session.commit()

    service = AgentService(db_session)
    with pytest.raises(Exception) as exc_info:
        await service.start_init_dispatch(
            workspace_id=workspace.id,
            actor_user_id=user_id,
        )

    assert "no daemon configured" in str(exc_info.value).lower()


@pytest.mark.asyncio
async def test_start_init_dispatch_lease_has_correct_root_path_from_binding(
    db_session: AsyncSession,
) -> None:
    """Root_path in the lease metadata MUST come from the member binding,
    not from the workspace global root_path.
    """
    user_id = await _create_user(db_session)
    daemon = await _create_daemon_instance(db_session, user_id)
    runtime = await _create_runtime(db_session, user_id, daemon.id)

    workspace_root = "/workspace/global/path"
    member_root = "/Users/alice/my-project"

    workspace = Workspace(
        id=uuid.uuid4(),
        name="Init Test PathSource",
        slug=f"init-path-{uuid.uuid4().hex[:8]}",
        root_path=workspace_root,  # global path (deprecated)
        status="active",
    )
    db_session.add(workspace)
    db_session.add(
        WorkspaceMemberRuntime(
            workspace_id=workspace.id,
            user_id=user_id,
            daemon_id=daemon.id,
            runtime_id=runtime.id,
            root_path=member_root,  # per-member path (authoritative)
            path_source="daemon-client",
        )
    )
    await db_session.commit()

    service = AgentService(db_session)
    result = await service.start_init_dispatch(
        workspace_id=workspace.id,
        actor_user_id=user_id,
    )

    lease_stmt = select(DaemonTaskLease).where(
        DaemonTaskLease.id == uuid.UUID(result["lease_id"]),
    )
    lease = (await db_session.execute(lease_stmt)).scalars().first()
    meta = lease.metadata_ or {}
    assert meta.get("root_path") == member_root, (
        f"Root path MUST come from member binding, got: {meta.get('root_path')}"
    )
    assert meta.get("root_path") != workspace_root
