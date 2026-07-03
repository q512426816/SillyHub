"""Workspace member runtime binding CRUD (change 2026-07-01-collaborative-workspace)."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import col

from app.core.errors import AppError
from app.core.logging import get_logger
from app.modules.daemon.model import DaemonInstance
from app.modules.workspace.member_runtimes.model import WorkspaceMemberRuntime

log = get_logger(__name__)


async def get_my_binding(
    session: AsyncSession,
    workspace_id: uuid.UUID,
    user_id: uuid.UUID,
) -> WorkspaceMemberRuntime | None:
    """Return the member's binding row, or None if not configured."""
    row = await session.get(WorkspaceMemberRuntime, (workspace_id, user_id))
    return row


async def upsert_my_binding(
    session: AsyncSession,
    workspace_id: uuid.UUID,
    user_id: uuid.UUID,
    *,
    daemon_id: uuid.UUID | None,
    root_path: str,
    path_source: str,
) -> tuple[WorkspaceMemberRuntime, bool]:
    """Upsert a member's binding row. Returns ``(row, created)``.

    Change 2026-07-03-daemon-entity-binding task-09 (D-004): the binding
    target is ``daemon_id`` (FK→daemon_instances) instead of ``runtime_id``.
    ``runtime_id`` column is preserved nullable but NOT written by this
    function — it retains legacy snapshot data only.

    Raises ``AppError(403)`` if ``daemon_id`` is set but belongs to a
    different user (defensive — prevents cross-user daemon hijack).
    """
    if daemon_id is not None:
        daemon = await session.get(DaemonInstance, daemon_id)
        if daemon is None or daemon.user_id != user_id:
            raise AppError(
                "Daemon instance does not belong to you.",
                code="daemon_not_owned",
                http_status=403,
            )

    existing = await session.get(WorkspaceMemberRuntime, (workspace_id, user_id))
    now = datetime.now(UTC)
    if existing:
        # Edit path (D-007): only the editable binding columns change.
        # init_synced_at / init_synced_spec_version are NOT touched here — they
        # are written exclusively by the init-lease complete path (task-07).
        # Changing one's daemon/path must not reset initialization state.
        existing.daemon_id = daemon_id
        existing.root_path = root_path
        existing.path_source = path_source
        existing.updated_at = now
        await session.commit()
        await session.refresh(existing)
        return existing, False

    # Create path: init_synced_* start NULL (uninitialized) and remain so until
    # the member's first `init` lease completes (task-07 / task-09 migration).
    binding = WorkspaceMemberRuntime(
        workspace_id=workspace_id,
        user_id=user_id,
        daemon_id=daemon_id,
        root_path=root_path,
        path_source=path_source,
        init_synced_at=None,
        init_synced_spec_version=None,
        created_at=now,
        updated_at=now,
    )
    session.add(binding)
    await session.commit()
    await session.refresh(binding)
    return binding, True


async def list_member_bindings(
    session: AsyncSession,
    workspace_id: uuid.UUID,
) -> list[WorkspaceMemberRuntime]:
    """Return all binding rows for a workspace (owner/admin)."""
    stmt = (
        select(WorkspaceMemberRuntime)
        .where(col(WorkspaceMemberRuntime.workspace_id) == workspace_id)
        .order_by(col(WorkspaceMemberRuntime.user_id))
    )
    return list((await session.execute(stmt)).scalars().all())
