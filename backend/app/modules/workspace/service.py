"""Workspace use cases.

This module is the single place that talks to both the filesystem (via
:class:`WorkspaceScanner`) and the DB. Routers stay thin and only translate
HTTP <-> service calls.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import col

from app.core.errors import (
    WorkspaceNotFound,
    WorkspaceNotSillyspec,
    WorkspacePathDuplicate,
    WorkspacePathNotDir,
    WorkspacePathNotFound,
    WorkspacePermissionDenied,
    WorkspaceSlugDuplicate,
)
from app.core.logging import get_logger
from app.modules.workspace.model import Workspace
from app.modules.workspace.scanner import ScanResult, WorkspaceScanner
from app.modules.workspace.schema import WorkspaceCreate, slugify

log = get_logger(__name__)


class WorkspaceService:
    """Coordinates filesystem scans and DB persistence for workspaces."""

    def __init__(self, session: AsyncSession, scanner: WorkspaceScanner | None = None) -> None:
        self._session = session
        self._scanner = scanner or WorkspaceScanner()

    # ── Scanning ──────────────────────────────────────────────────────────

    def scan(self, root_path: str) -> ScanResult:
        """Run a dry-run scan and translate filesystem problems to AppError."""
        path = Path(root_path)
        self._guard_path(path)
        return self._scanner.scan(path)

    # ── Create / list / get ────────────────────────────────────────────────

    async def create(
        self,
        payload: WorkspaceCreate,
        *,
        created_by: uuid.UUID | None,
    ) -> Workspace:
        scan = self.scan(payload.root_path)
        if not scan.is_sillyspec:
            raise WorkspaceNotSillyspec(
                "Provided root_path is not a SillySpec workspace.",
                details={"root_path": scan.root_path, "warnings": scan.warnings},
            )

        slug = payload.slug or slugify(payload.name)
        now = datetime.utcnow()

        # Soft-deleted rows keep the same root_path, so before inserting a
        # fresh row we look for a tombstone we can resurrect. This is the
        # natural user expectation: "I removed it, now I want it back".
        revived = await self._resurrect_soft_deleted(
            root_path=scan.root_path,
            payload=payload,
            slug=slug,
            sillyspec_path=scan.sillyspec_path,
            created_by=created_by,
            now=now,
        )
        if revived is not None:
            return revived

        workspace = Workspace(
            id=uuid.uuid4(),
            name=payload.name,
            slug=slug,
            root_path=scan.root_path,
            sillyspec_path=scan.sillyspec_path,
            status="active",
            created_by=created_by,
            created_at=now,
            updated_at=now,
            last_scanned_at=now,
        )

        self._session.add(workspace)
        try:
            await self._session.flush()
        except IntegrityError as exc:
            await self._session.rollback()
            self._translate_integrity_error(exc, slug=slug, root_path=scan.root_path)
            raise  # _translate_integrity_error always raises; this is unreachable

        await self._session.commit()
        await self._session.refresh(workspace)
        log.info(
            "workspace.created",
            workspace_id=str(workspace.id),
            slug=workspace.slug,
            root_path=workspace.root_path,
        )
        return workspace

    async def _resurrect_soft_deleted(
        self,
        *,
        root_path: str,
        payload: WorkspaceCreate,
        slug: str,
        sillyspec_path: str,
        created_by: uuid.UUID | None,
        now: datetime,
    ) -> Workspace | None:
        """Reactivate a soft-deleted workspace that has the same root_path.

        Returns the revived row on success or ``None`` if no tombstone exists.
        Raises :class:`WorkspaceSlugDuplicate` when the desired slug is already
        taken by another active workspace.
        """
        stmt = (
            select(Workspace)
            .where(col(Workspace.root_path) == root_path)
            .where(col(Workspace.deleted_at).is_not(None))
            .order_by(col(Workspace.deleted_at).desc())
            .limit(1)
        )
        result = (await self._session.execute(stmt)).scalars().first()
        if result is None:
            return None

        result.name = payload.name
        result.slug = slug
        result.sillyspec_path = sillyspec_path
        result.status = "active"
        result.deleted_at = None
        result.created_by = created_by
        result.last_scanned_at = now
        result.updated_at = now

        try:
            await self._session.flush()
        except IntegrityError as exc:
            await self._session.rollback()
            self._translate_integrity_error(exc, slug=slug, root_path=root_path)
            raise

        await self._session.commit()
        await self._session.refresh(result)
        log.info(
            "workspace.resurrected",
            workspace_id=str(result.id),
            slug=result.slug,
            root_path=result.root_path,
        )
        return result

    async def list_(
        self,
        *,
        include_deleted: bool = False,
        limit: int = 100,
        offset: int = 0,
    ) -> tuple[list[Workspace], int]:
        stmt = select(Workspace)
        if not include_deleted:
            stmt = stmt.where(col(Workspace.deleted_at).is_(None))
        stmt = stmt.order_by(col(Workspace.created_at).desc()).limit(limit).offset(offset)

        items = list((await self._session.execute(stmt)).scalars().all())

        count_stmt = select(Workspace)
        if not include_deleted:
            count_stmt = count_stmt.where(col(Workspace.deleted_at).is_(None))
        total = len((await self._session.execute(count_stmt)).scalars().all())
        return items, total

    async def get(self, workspace_id: uuid.UUID) -> Workspace:
        workspace = await self._session.get(Workspace, workspace_id)
        if workspace is None or workspace.deleted_at is not None:
            raise WorkspaceNotFound(
                "Workspace not found.",
                details={"workspace_id": str(workspace_id)},
            )
        return workspace

    # ── Mutate ────────────────────────────────────────────────────────────

    async def rescan(self, workspace_id: uuid.UUID) -> tuple[Workspace, ScanResult]:
        workspace = await self.get(workspace_id)
        scan = self.scan(workspace.root_path)
        workspace.last_scanned_at = datetime.utcnow()
        workspace.updated_at = workspace.last_scanned_at
        await self._session.commit()
        await self._session.refresh(workspace)
        log.info(
            "workspace.rescanned",
            workspace_id=str(workspace.id),
            is_sillyspec=scan.is_sillyspec,
        )
        return workspace, scan

    async def soft_delete(self, workspace_id: uuid.UUID) -> Workspace:
        workspace = await self.get(workspace_id)
        now = datetime.utcnow()
        workspace.deleted_at = now
        workspace.updated_at = now
        workspace.status = "deleted"
        await self._session.commit()
        await self._session.refresh(workspace)
        log.info("workspace.soft_deleted", workspace_id=str(workspace.id))
        return workspace

    # ── Helpers ───────────────────────────────────────────────────────────

    @staticmethod
    def _guard_path(path: Path) -> None:
        """Translate filesystem problems into structured AppErrors."""
        try:
            if not path.exists():
                raise WorkspacePathNotFound(
                    "The given root_path does not exist.",
                    details={"root_path": str(path)},
                )
            if not path.is_dir():
                raise WorkspacePathNotDir(
                    "The given root_path is not a directory.",
                    details={"root_path": str(path)},
                )
        except PermissionError as exc:
            raise WorkspacePermissionDenied(
                "Permission denied while inspecting root_path.",
                details={"root_path": str(path), "error": str(exc)},
            ) from exc

    @staticmethod
    def _translate_integrity_error(
        exc: IntegrityError,
        *,
        slug: str,
        root_path: str,
    ) -> None:
        """Map Postgres UNIQUE violations onto specific AppError subclasses."""
        msg = str(exc.orig or exc).lower()
        if "uq_workspaces_root_path" in msg or "root_path" in msg:
            raise WorkspacePathDuplicate(
                "Another workspace is already registered for this root_path.",
                details={"root_path": root_path},
            ) from exc
        if "uq_workspaces_slug" in msg or "slug" in msg:
            raise WorkspaceSlugDuplicate(
                "Another workspace already uses this slug.",
                details={"slug": slug},
            ) from exc
        # Fallback: re-raise as duplicate path which is the most common case.
        raise WorkspacePathDuplicate(
            "Workspace uniqueness constraint violated.",
            details={"root_path": root_path, "slug": slug},
        ) from exc
