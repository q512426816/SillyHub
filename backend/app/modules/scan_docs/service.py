"""Scan docs use cases.

Coordinates the filesystem parser with DB persistence. List/get queries read
from the DB; reparse re-reads the filesystem and reconciles rows.
"""

from __future__ import annotations

import uuid
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import col

from app.core.errors import ScanDocNotFound
from app.core.logging import get_logger
from app.modules.scan_docs.model import ScanDocument
from app.modules.scan_docs.parser import ParsedDoc, ScanDocsParser, ScanDocsResult
from app.modules.workspace.service import WorkspaceService

log = get_logger(__name__)


class ScanDocsService:
    """List, fetch, and reparse scan documents for a workspace."""

    def __init__(
        self,
        session: AsyncSession,
        *,
        parser: ScanDocsParser | None = None,
        workspace_service: WorkspaceService | None = None,
    ) -> None:
        self._session = session
        self._parser = parser or ScanDocsParser()
        self._workspace_service = workspace_service or WorkspaceService(session)

    # -- Queries ---

    async def list_(
        self, workspace_id: uuid.UUID
    ) -> tuple[list[ScanDocument], int]:
        await self._workspace_service.get(workspace_id)
        stmt = (
            select(ScanDocument)
            .where(col(ScanDocument.workspace_id) == workspace_id)
            .order_by(col(ScanDocument.doc_type).asc())
        )
        items = list((await self._session.execute(stmt)).scalars().all())
        return items, len(items)

    async def get(
        self,
        workspace_id: uuid.UUID,
        doc_type: str,
    ) -> ScanDocument:
        await self._workspace_service.get(workspace_id)
        stmt = (
            select(ScanDocument)
            .where(col(ScanDocument.workspace_id) == workspace_id)
            .where(col(ScanDocument.doc_type) == doc_type)
        )
        doc = (await self._session.execute(stmt)).scalars().first()
        if doc is None:
            raise ScanDocNotFound(
                f"Scan doc '{doc_type}' not found for this workspace.",
                details={
                    "workspace_id": str(workspace_id),
                    "doc_type": doc_type,
                },
            )
        return doc

    # -- Reparse ---

    async def reparse(
        self, workspace_id: uuid.UUID
    ) -> tuple[dict[str, int], list[ScanDocsResult]]:
        """Reparse scan docs for a workspace."""
        workspace = await self._workspace_service.get(workspace_id)
        sillyspec_root = Path(workspace.root_path)

        stats = {"parsed": 0, "created": 0, "updated": 0, "deleted": 0}
        results: list[ScanDocsResult] = []

        component_key = getattr(workspace, "component_key", None)
        if component_key is None:
            # No component_key -- nothing to parse
            return stats, results

        result = self._parser.parse_component(sillyspec_root, component_key)
        results.append(result)
        stats["parsed"] += len([d for d in result.docs if d.exists])

        # Fetch existing rows for this workspace
        existing = await self._fetch_existing(workspace_id=workspace_id)
        existing_by_type = {d.doc_type: d for d in existing if d.doc_type != "OTHER"}

        for parsed_doc in result.docs:
            if parsed_doc.doc_type == "OTHER":
                continue  # handled in _sync_other_docs
            if parsed_doc.exists:
                if parsed_doc.doc_type in existing_by_type:
                    row = existing_by_type[parsed_doc.doc_type]
                    self._apply_parsed(row, parsed_doc)
                    stats["updated"] += 1
                else:
                    row = self._build_row(parsed_doc, workspace_id=workspace_id)
                    self._session.add(row)
                    stats["created"] += 1
            elif parsed_doc.doc_type in existing_by_type:
                row = existing_by_type[parsed_doc.doc_type]
                row.exists = False
                row.content = None
                row.title = None
            else:
                row = self._build_row(parsed_doc, workspace_id=workspace_id)
                self._session.add(row)
                stats["created"] += 1

        # Handle OTHER docs with composite keys
        await self._sync_other_docs(
            workspace_id=workspace_id,
            parsed_docs=result.docs,
            stats=stats,
        )

        await self._session.commit()
        log.info("scan_docs.reparsed", workspace_id=str(workspace_id), **stats)
        return stats, results

    # -- Helpers ---

    async def _fetch_existing(self, workspace_id: uuid.UUID) -> list[ScanDocument]:
        stmt = select(ScanDocument).where(
            col(ScanDocument.workspace_id) == workspace_id
        )
        return list((await self._session.execute(stmt)).scalars().all())

    async def _sync_other_docs(
        self,
        *,
        workspace_id: uuid.UUID,
        parsed_docs: list[ParsedDoc],
        stats: dict[str, int],
    ) -> None:
        """Sync OTHER-type docs which can have multiple files."""
        other_parsed = [d for d in parsed_docs if d.doc_type == "OTHER"]
        existing = await self._fetch_existing(workspace_id)
        existing_other = [d for d in existing if d.doc_type == "OTHER"]
        existing_paths = {d.path for d in existing_other}
        parsed_paths = {d.path for d in other_parsed}

        for doc in other_parsed:
            if doc.path not in existing_paths:
                row = self._build_row(doc, workspace_id=workspace_id)
                self._session.add(row)

        for row in existing_other:
            if row.path not in parsed_paths:
                await self._session.delete(row)
                stats["deleted"] += 1

    @staticmethod
    def _build_row(
        parsed_doc: ParsedDoc,
        *,
        workspace_id: uuid.UUID,
    ) -> ScanDocument:
        return ScanDocument(
            id=uuid.uuid4(),
            workspace_id=workspace_id,
            doc_type=parsed_doc.doc_type,
            path=parsed_doc.path,
            title=parsed_doc.title,
            exists=parsed_doc.exists,
            content=parsed_doc.content,
            last_modified_at=parsed_doc.last_modified_at,
        )

    @staticmethod
    def _apply_parsed(
        row: ScanDocument,
        parsed_doc: ParsedDoc,
    ) -> None:
        row.path = parsed_doc.path
        row.title = parsed_doc.title
        row.exists = parsed_doc.exists
        row.content = parsed_doc.content
        row.last_modified_at = parsed_doc.last_modified_at
