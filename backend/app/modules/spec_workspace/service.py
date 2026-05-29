"""Spec workspace use cases.

This module handles CRUD and sync-status management for the ``spec_workspaces``
table. It does not touch the filesystem (that responsibility belongs to the
sync / import flows in future tasks).

author: qinyi
created_at: 2026-05-27
"""

from __future__ import annotations

import uuid
from datetime import datetime
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.errors import SpecWorkspaceNotFound
from app.core.logging import get_logger
from app.modules.spec_workspace.model import SpecWorkspace
from app.modules.spec_workspace.schema import (
    SpecWorkspaceCreate,
    SpecWorkspaceUpdate,
    SyncStatusUpdate,
)

log = get_logger(__name__)


class SpecWorkspaceService:
    """Coordinates persistence for spec workspace records."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    # ── Create / get ───────────────────────────────────────────────────────

    async def create(
        self,
        workspace_id: uuid.UUID,
        payload: SpecWorkspaceCreate,
    ) -> SpecWorkspace:
        """Create a spec workspace linked to the given workspace.

        If ``spec_root`` is not provided in the payload a sensible default is
        generated. This keeps the caller simple while still allowing explicit
        overrides.
        """
        now = datetime.utcnow()
        settings = get_settings()
        spec_root = payload.spec_root or f"{settings.spec_data_root}/{workspace_id}"

        spec_ws = SpecWorkspace(
            id=uuid.uuid4(),
            workspace_id=workspace_id,
            spec_root=spec_root,
            strategy=payload.strategy,
            repo_sillyspec_path=payload.repo_sillyspec_path,
            profile_version=payload.profile_version,
            sync_status="clean",
            last_synced_at=None,
            created_at=now,
            updated_at=now,
        )
        self._session.add(spec_ws)

        # Ensure the spec root directory exists on disk.
        spec_root_path = Path(spec_root)
        spec_root_path.mkdir(parents=True, exist_ok=True)
        await self._session.commit()
        await self._session.refresh(spec_ws)

        log.info(
            "spec_workspace.created",
            spec_workspace_id=str(spec_ws.id),
            workspace_id=str(workspace_id),
            strategy=spec_ws.strategy,
        )
        return spec_ws

    async def get(self, workspace_id: uuid.UUID) -> SpecWorkspace:
        """Return the spec workspace for the given workspace, or raise."""
        stmt = select(SpecWorkspace).where(
            SpecWorkspace.workspace_id == workspace_id,
        )
        result = (await self._session.execute(stmt)).scalars().first()
        if result is None:
            raise SpecWorkspaceNotFound(
                "Spec workspace not found for the given workspace.",
                details={"workspace_id": str(workspace_id)},
            )
        return result

    async def get_by_id(self, spec_workspace_id: uuid.UUID) -> SpecWorkspace:
        """Return a spec workspace by its own primary key, or raise."""
        spec_ws = await self._session.get(SpecWorkspace, spec_workspace_id)
        if spec_ws is None:
            raise SpecWorkspaceNotFound(
                "Spec workspace not found.",
                details={"spec_workspace_id": str(spec_workspace_id)},
            )
        return spec_ws

    # ── Update ─────────────────────────────────────────────────────────────

    async def update(
        self,
        workspace_id: uuid.UUID,
        payload: SpecWorkspaceUpdate,
    ) -> SpecWorkspace:
        """Partial-update mutable fields on the spec workspace."""
        spec_ws = await self.get(workspace_id)
        now = datetime.utcnow()

        if payload.strategy is not None:
            spec_ws.strategy = payload.strategy
        if payload.repo_sillyspec_path is not None:
            spec_ws.repo_sillyspec_path = payload.repo_sillyspec_path
        if payload.profile_version is not None:
            spec_ws.profile_version = payload.profile_version

        spec_ws.updated_at = now
        await self._session.commit()
        await self._session.refresh(spec_ws)

        log.info(
            "spec_workspace.updated",
            spec_workspace_id=str(spec_ws.id),
            workspace_id=str(workspace_id),
        )
        return spec_ws

    # ── Import / Sync (stub implementations) ────────────────────────────────

    async def import_from_repo(self, workspace_id: uuid.UUID) -> SpecWorkspace:
        """Import spec files from the repo ``.sillyspec`` directory into the
        platform-managed spec workspace.

        **Stub**: only updates ``sync_status`` to ``clean`` and stamps
        ``last_synced_at``. The actual filesystem import logic will be added
        in a later wave.
        """
        spec_ws = await self.get(workspace_id)
        now = datetime.utcnow()

        spec_ws.sync_status = "clean"
        spec_ws.last_synced_at = now
        spec_ws.updated_at = now

        await self._session.commit()
        await self._session.refresh(spec_ws)

        log.info(
            "spec_workspace.import_from_repo",
            spec_workspace_id=str(spec_ws.id),
            workspace_id=str(workspace_id),
            note="stub — no filesystem changes made",
        )
        return spec_ws

    async def sync(self, workspace_id: uuid.UUID) -> SpecWorkspace:
        """Synchronise the platform spec workspace with the repo ``.sillyspec``
        directory.

        **Stub**: only updates ``sync_status`` to ``clean`` and stamps
        ``last_synced_at``. The actual bidirectional sync logic will be added
        in a later wave.
        """
        spec_ws = await self.get(workspace_id)
        now = datetime.utcnow()

        spec_ws.sync_status = "clean"
        spec_ws.last_synced_at = now
        spec_ws.updated_at = now

        await self._session.commit()
        await self._session.refresh(spec_ws)

        log.info(
            "spec_workspace.sync",
            spec_workspace_id=str(spec_ws.id),
            workspace_id=str(workspace_id),
            note="stub — no filesystem changes made",
        )
        return spec_ws

    # ── Sync status ────────────────────────────────────────────────────────

    async def update_sync_status(
        self,
        workspace_id: uuid.UUID,
        payload: SyncStatusUpdate,
    ) -> SpecWorkspace:
        """Update the ``sync_status`` and optionally ``last_synced_at``.

        When the new status is ``clean`` we also stamp ``last_synced_at`` to
        ``now``, which is the natural semantic for "sync just completed".
        """
        spec_ws = await self.get(workspace_id)
        now = datetime.utcnow()

        spec_ws.sync_status = payload.sync_status
        if payload.sync_status == "clean":
            spec_ws.last_synced_at = now
        spec_ws.updated_at = now

        await self._session.commit()
        await self._session.refresh(spec_ws)

        log.info(
            "spec_workspace.sync_status_updated",
            spec_workspace_id=str(spec_ws.id),
            workspace_id=str(workspace_id),
            sync_status=payload.sync_status,
        )
        return spec_ws
