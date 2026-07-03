"""Tests for WorkspaceMemberRuntime init_synced fields (D-010).

Change 2026-07-02-workspace-config-flow task-03.

Verifies:
- PUT /my-binding create path: init_synced_at / init_synced_spec_version are
  NULL (uninitialized) on a freshly-created member row.
- PUT /my-binding edit path: editing the binding (runtime/path) does NOT reset
  or otherwise touch the two init_synced_* columns — they are owned solely by
  the init-lease complete path (task-07, not yet implemented here).
- After init_synced_* are seeded manually (simulating a future init complete),
  a subsequent binding edit preserves them.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

# task-03: WorkspaceMemberRuntime.daemon_id FK 跨模块指向 daemon_instances，
# 必须导入 DaemonInstance 让其表注册进 BaseModel.metadata，否则 create_all 时
# FK 找不到目标表（NoReferencedTableError）。
from app.modules.daemon.model import DaemonInstance
from app.modules.workspace.member_runtimes.model import WorkspaceMemberRuntime
from app.modules.workspace.member_runtimes.service import (
    get_my_binding,
    upsert_my_binding,
)

pytestmark = pytest.mark.asyncio


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


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
    await session.flush()
    return inst


async def _create_user(session: AsyncSession) -> uuid.UUID:
    from app.modules.auth.model import User

    uid = uuid.uuid4()
    session.add(
        User(
            id=uid,
            email=f"member-{uid}@example.com",
            password_hash="x",
            display_name="Member",
            status="active",
        )
    )
    await session.flush()
    return uid


async def _create_workspace(session: AsyncSession) -> uuid.UUID:
    from app.modules.workspace.model import Workspace

    wid = uuid.uuid4()
    session.add(
        Workspace(
            id=wid,
            name=f"WS-{wid.hex[:8]}",
            slug=f"ws-{wid.hex[:8]}",
            root_path="/tmp/test-ws",
            status="active",
        )
    )
    await session.flush()
    return wid


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


async def test_create_binding_init_synced_fields_are_null(db_session: AsyncSession):
    """D-010: a freshly created binding must report init_synced_* == NULL."""
    user_id = await _create_user(db_session)
    workspace_id = await _create_workspace(db_session)
    daemon = await _create_daemon_instance(db_session, user_id)

    row, created = await upsert_my_binding(
        db_session,
        workspace_id,
        user_id,
        daemon_id=daemon.id,
        root_path="/tmp/my-project",
        path_source="daemon-client",
    )

    assert created is True
    assert row.init_synced_at is None
    assert row.init_synced_spec_version is None


async def test_get_my_binding_returns_init_synced_fields(db_session: AsyncSession):
    """Acceptance: get_my_binding surfaces the two new fields (currently NULL)."""
    user_id = await _create_user(db_session)
    workspace_id = await _create_workspace(db_session)

    await upsert_my_binding(
        db_session,
        workspace_id,
        user_id,
        daemon_id=None,
        root_path="/tmp/my-project",
        path_source="daemon-client",
    )

    row = await get_my_binding(db_session, workspace_id, user_id)
    assert row is not None
    assert row.init_synced_at is None
    assert row.init_synced_spec_version is None


async def test_edit_binding_does_not_touch_init_synced_fields(db_session: AsyncSession):
    """Editing runtime/path must not reset init_synced_* (owned by init complete)."""
    user_id = await _create_user(db_session)
    workspace_id = await _create_workspace(db_session)
    daemon = await _create_daemon_instance(db_session, user_id)

    # Create with NULL init_synced_*.
    row, created = await upsert_my_binding(
        db_session,
        workspace_id,
        user_id,
        daemon_id=daemon.id,
        root_path="/tmp/old",
        path_source="daemon-client",
    )
    assert created is True
    assert row.init_synced_at is None
    assert row.init_synced_spec_version is None

    # Simulate the future init-lease complete path (task-07) writing the fields.
    seeded_at = datetime.now(UTC).replace(tzinfo=None)  # SQLite stores naive
    row.init_synced_at = seeded_at
    row.init_synced_spec_version = 7
    await db_session.commit()
    await db_session.refresh(row)
    # init_synced_spec_version round-trips exactly; the datetime is stored naive
    # under aiosqlite (see memory: backend-test-sqlite-vs-pg) so compare naive.
    assert row.init_synced_spec_version == 7
    assert row.init_synced_at is not None
    assert row.init_synced_at.replace(tzinfo=None) == seeded_at

    # Now the member edits their binding (e.g. changes path).
    row2, created2 = await upsert_my_binding(
        db_session,
        workspace_id,
        user_id,
        daemon_id=daemon.id,
        root_path="/tmp/new",
        path_source="daemon-client",
    )

    assert created2 is False
    assert row2.root_path == "/tmp/new"
    # init_synced_* MUST survive the edit untouched (datetime stored naive).
    assert row2.init_synced_spec_version == 7
    assert row2.init_synced_at is not None
    assert row2.init_synced_at.replace(tzinfo=None) == seeded_at


async def test_create_binding_without_runtime_still_null_init_synced(
    db_session: AsyncSession,
):
    """Edge: binding with daemon_id=None (server-local path) also starts NULL."""
    user_id = await _create_user(db_session)
    workspace_id = await _create_workspace(db_session)

    row, created = await upsert_my_binding(
        db_session,
        workspace_id,
        user_id,
        daemon_id=None,
        root_path="/tmp/server-local",
        path_source="server-local",
    )

    assert created is True
    assert row.init_synced_at is None
    assert row.init_synced_spec_version is None


async def test_direct_model_construction_defaults_init_synced_to_none(
    db_session: AsyncSession,
):
    """Direct construction (e.g. migration seeding) defaults both fields to None."""
    user_id = await _create_user(db_session)
    workspace_id = await _create_workspace(db_session)

    binding = WorkspaceMemberRuntime(
        workspace_id=workspace_id,
        user_id=user_id,
        runtime_id=None,
        root_path="/tmp/seeded",
        path_source="server-local",
    )
    db_session.add(binding)
    await db_session.commit()
    await db_session.refresh(binding)

    assert binding.init_synced_at is None
    assert binding.init_synced_spec_version is None
