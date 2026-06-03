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

    async def list_(self, workspace_id: uuid.UUID) -> tuple[list[ScanDocument], int]:
        await self._workspace_service.get(workspace_id)
        stmt = (
            select(ScanDocument)
            .where(col(ScanDocument.workspace_id) == workspace_id)
            .where(col(ScanDocument.exists).is_(True))
            .order_by(col(ScanDocument.path).asc())
        )
        items = list((await self._session.execute(stmt)).scalars().all())
        return items, len(items)

    async def get(
        self,
        workspace_id: uuid.UUID,
        doc_id: uuid.UUID,
    ) -> ScanDocument:
        await self._workspace_service.get(workspace_id)
        doc = await self._session.get(ScanDocument, doc_id)
        if doc is None or doc.workspace_id != workspace_id:
            raise ScanDocNotFound(
                "Scan doc not found.",
                details={
                    "workspace_id": str(workspace_id),
                    "doc_id": str(doc_id),
                },
            )
        return doc

    # -- Reparse ---

    async def reparse(self, workspace_id: uuid.UUID) -> tuple[dict[str, int], ScanDocsResult]:
        """Reparse all docs under .sillyspec/docs/ for a workspace."""
        workspace = await self._workspace_service.get(workspace_id)
        sillyspec_root = Path(workspace.root_path)

        stats = {"parsed": 0, "created": 0, "updated": 0, "deleted": 0}

        result = self._parser.parse_docs_tree(sillyspec_root)
        stats["parsed"] = len([d for d in result.docs if d.exists])

        # Fetch existing rows keyed by path
        existing = await self._fetch_existing(workspace_id=workspace_id)
        existing_by_path: dict[str, ScanDocument] = {d.path: d for d in existing}
        parsed_paths: set[str] = set()

        for parsed_doc in result.docs:
            if not parsed_doc.exists:
                continue
            parsed_paths.add(parsed_doc.path)

            if parsed_doc.path in existing_by_path:
                row = existing_by_path[parsed_doc.path]
                self._apply_parsed(row, parsed_doc)
                stats["updated"] += 1
            else:
                row = self._build_row(parsed_doc, workspace_id=workspace_id)
                self._session.add(row)
                stats["created"] += 1

        # Delete rows whose files disappeared
        for row in existing:
            if row.path not in parsed_paths:
                await self._session.delete(row)
                stats["deleted"] += 1

        await self._session.commit()
        log.info("scan_docs.reparsed", workspace_id=str(workspace_id), **stats)
        return stats, result

    # -- Helpers ---

    async def _fetch_existing(self, workspace_id: uuid.UUID) -> list[ScanDocument]:
        stmt = select(ScanDocument).where(col(ScanDocument.workspace_id) == workspace_id)
        return list((await self._session.execute(stmt)).scalars().all())

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
        row.doc_type = parsed_doc.doc_type
        row.path = parsed_doc.path
        row.title = parsed_doc.title
        row.exists = parsed_doc.exists
        row.content = parsed_doc.content
        row.last_modified_at = parsed_doc.last_modified_at
