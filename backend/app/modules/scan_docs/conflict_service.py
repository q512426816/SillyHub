"""Conflict archive service for scan document overwrite tracking (D-001@V1).

Change 2026-07-01-collaborative-workspace task-07: when apply_sync or reparse
overwrites a scan document path with a newer-mtime version, the old content +
source metadata is archived here for read-only conflict history playback.

All methods are session-scoped — they never commit or flush; the caller owns
the transaction boundary.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import col

from app.core.logging import get_logger
from app.modules.scan_docs.conflict_model import ScanDocConflictHistory

log = get_logger(__name__)


class ScanDocConflictService:
    """Archiving + querying scan document conflict history (D-001@V1).

    Archive failures are logged as warnings only (D-001 "do not block") and
    must not propagate to the caller — wrap calls to :meth:`archive_conflict`
    in ``try/except`` only when you want the main flow to survive.
    """

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def archive_conflict(
        self,
        workspace_id: uuid.UUID,
        path: str,
        *,
        old_content: str | None,
        old_source_member_id: uuid.UUID | None,
        old_source_runtime_id: uuid.UUID | None,
        old_mtime: datetime | None,
        new_source_member_id: uuid.UUID | None,
        new_mtime: datetime | None,
    ) -> None:
        """Archive one overwritten version. Does NOT commit.

        The archive row deliberately stores source ids as plain columns (no FK)
        so that deleting a user or runtime never cascades to loss of conflict
        history — these are audit records.
        """
        conflict = ScanDocConflictHistory(
            workspace_id=workspace_id,
            path=path,
            old_content=old_content,
            old_source_member_id=old_source_member_id,
            old_source_runtime_id=old_source_runtime_id,
            old_mtime=old_mtime,
            new_source_member_id=new_source_member_id,
            new_mtime=new_mtime,
        )
        self._session.add(conflict)

    async def list_history(
        self,
        workspace_id: uuid.UUID,
        path: str,
        *,
        limit: int = 50,
        offset: int = 0,
    ) -> list[ScanDocConflictHistory]:
        """Return archived versions for a path, newest-first."""
        stmt = (
            select(ScanDocConflictHistory)
            .where(col(ScanDocConflictHistory.workspace_id) == workspace_id)
            .where(col(ScanDocConflictHistory.path) == path)
            .order_by(col(ScanDocConflictHistory.created_at).desc())
            .offset(offset)
            .limit(limit)
        )
        return list((await self._session.execute(stmt)).scalars().all())

    async def get_history(
        self,
        workspace_id: uuid.UUID,
        history_id: uuid.UUID,
    ) -> ScanDocConflictHistory | None:
        """Return a single archived version by its id."""
        stmt = (
            select(ScanDocConflictHistory)
            .where(col(ScanDocConflictHistory.id) == history_id)
            .where(col(ScanDocConflictHistory.workspace_id) == workspace_id)
        )
        return (await self._session.execute(stmt)).scalars().first()
