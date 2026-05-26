"""Change use cases.

Coordinates the filesystem parser with DB persistence. List/get queries read
from the DB; reparse re-reads the filesystem and reconciles rows. Document
content is read from the filesystem on-demand (not stored in DB).
"""

from __future__ import annotations

import uuid
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import col

from app.core.errors import ChangeDocNotFound, ChangeNotFound
from app.core.logging import get_logger
from app.modules.change.model import Change, ChangeDocument
from app.modules.change.parser import ChangeParser, ChangeParserResult, ParsedChange
from app.modules.workspace.service import WorkspaceService

log = get_logger(__name__)

MAX_CONTENT_BYTES = 1_000_000  # 1 MB


class ChangeService:
    """List, fetch, and reparse changes for a workspace."""

    def __init__(
        self,
        session: AsyncSession,
        *,
        parser: ChangeParser | None = None,
        workspace_service: WorkspaceService | None = None,
    ) -> None:
        self._session = session
        self._parser = parser or ChangeParser()
        self._workspace_service = workspace_service or WorkspaceService(session)

    # ── Queries ───────────────────────────────────────────────────────────

    async def list_(
        self,
        workspace_id: uuid.UUID,
        *,
        location: str | None = None,
        status: str | None = None,
        owner: str | None = None,
    ) -> tuple[list[Change], int]:
        await self._workspace_service.get(workspace_id)
        stmt = select(Change).where(col(Change.workspace_id) == workspace_id)
        if location:
            stmt = stmt.where(col(Change.location) == location)
        if status:
            stmt = stmt.where(col(Change.status) == status)
        if owner:
            try:
                owner_uuid = uuid.UUID(owner)
                stmt = stmt.where(col(Change.owner_id) == owner_uuid)
            except ValueError:
                pass  # invalid UUID, skip filter
        stmt = stmt.order_by(col(Change.change_key).asc())
        items = list((await self._session.execute(stmt)).scalars().all())
        return items, len(items)

    async def get(self, workspace_id: uuid.UUID, change_id: uuid.UUID) -> Change:
        await self._workspace_service.get(workspace_id)
        stmt = select(Change).where(
            col(Change.id) == change_id,
            col(Change.workspace_id) == workspace_id,
        )
        change = (await self._session.execute(stmt)).scalars().first()
        if change is None:
            raise ChangeNotFound(
                f"Change '{change_id}' not found.",
                details={
                    "workspace_id": str(workspace_id),
                    "change_id": str(change_id),
                },
            )
        return change

    async def get_documents(
        self, workspace_id: uuid.UUID, change_id: uuid.UUID
    ) -> tuple[list[ChangeDocument], list[str], list[str]]:
        change = await self.get(workspace_id, change_id)
        stmt = select(ChangeDocument).where(
            col(ChangeDocument.change_id) == change.id
        )
        docs = list((await self._session.execute(stmt)).scalars().all())
        prototypes = [
            Path(d.path).name for d in docs if d.doc_type == "prototype" and d.exists
        ]
        references = [
            Path(d.path).name for d in docs if d.doc_type == "reference" and d.exists
        ]
        return docs, prototypes, references

    async def get_document_content(
        self,
        workspace_id: uuid.UUID,
        change_id: uuid.UUID,
        doc_type: str,
        *,
        file_path: str | None = None,
    ) -> tuple[str, str | None, bool]:
        """Read document content from filesystem on-demand.

        Returns (path, content, exists).
        """
        change = await self.get(workspace_id, change_id)
        workspace = await self._workspace_service.get(workspace_id)
        root = Path(workspace.root_path)

        # Find the ChangeDocument row
        stmt = select(ChangeDocument).where(
            col(ChangeDocument.change_id) == change.id,
            col(ChangeDocument.doc_type) == doc_type,
        )
        if file_path:
            stmt = stmt.where(col(ChangeDocument.path) == file_path)
        doc = (await self._session.execute(stmt)).scalars().first()

        if doc is None or not doc.exists:
            raise ChangeDocNotFound(
                f"Document '{doc_type}' not found for change.",
                details={
                    "workspace_id": str(workspace_id),
                    "change_id": str(change_id),
                    "doc_type": doc_type,
                },
            )

        # Read from filesystem
        full_path = root / doc.path
        try:
            resolved = full_path.resolve()
            if not str(resolved).startswith(str(root.resolve())):
                raise ChangeDocNotFound("Path traversal detected.")
            if not full_path.is_file():
                return doc.path, None, False
            size = full_path.stat().st_size
            content = full_path.read_text(encoding="utf-8", errors="replace")
            if size > MAX_CONTENT_BYTES:
                content = content[: MAX_CONTENT_BYTES // 4]
            return doc.path, content, True
        except ChangeDocNotFound:
            raise
        except Exception:
            return doc.path, None, False

    # ── Reparse ───────────────────────────────────────────────────────────

    async def reparse(
        self, workspace_id: uuid.UUID
    ) -> tuple[dict[str, int], ChangeParserResult]:
        workspace = await self._workspace_service.get(workspace_id)
        sillyspec_root = Path(workspace.root_path)

        result = self._parser.parse_workspace(sillyspec_root)
        stats = {"parsed": 0, "created": 0, "updated": 0, "deleted": 0}

        # Fetch existing changes
        existing_changes = await self._fetch_existing_changes(workspace_id)
        existing_by_key = {c.change_key: c for c in existing_changes}

        seen_keys: set[str] = set()

        for parsed in result.changes:
            seen_keys.add(parsed.change_key)
            stats["parsed"] += 1

            if parsed.change_key in existing_by_key:
                row = existing_by_key[parsed.change_key]
                self._apply_parsed(row, parsed, workspace_id=workspace_id)
                stats["updated"] += 1
            else:
                row = self._build_change(parsed, workspace_id=workspace_id)
                self._session.add(row)
                stats["created"] += 1

            # Sync documents for this change
            await self._sync_docs(
                change=parsed,
                workspace_id=workspace_id,
                existing_change=(
                    existing_by_key.get(parsed.change_key)
                    if parsed.change_key in existing_by_key
                    else row
                ),
                stats=stats,
            )

        # Delete changes whose keys disappeared
        for key, row in existing_by_key.items():
            if key not in seen_keys:
                await self._session.delete(row)
                stats["deleted"] += 1

        await self._session.commit()
        log.info("changes.reparsed", workspace_id=str(workspace_id), **stats)
        return stats, result

    # ── Helpers ───────────────────────────────────────────────────────────

    async def _fetch_existing_changes(
        self, workspace_id: uuid.UUID
    ) -> list[Change]:
        stmt = select(Change).where(col(Change.workspace_id) == workspace_id)
        return list((await self._session.execute(stmt)).scalars().all())

    async def _sync_docs(
        self,
        *,
        change: ParsedChange,
        workspace_id: uuid.UUID,
        existing_change: Change,
        stats: dict[str, int],
    ) -> None:
        existing_docs = await self._fetch_existing_docs(existing_change.id)
        existing_by_key = {(d.doc_type, d.path): d for d in existing_docs}

        seen_keys: set[tuple[str, str]] = set()
        for parsed_doc in change.docs:
            key = (parsed_doc.doc_type, parsed_doc.path)
            seen_keys.add(key)

            if key in existing_by_key:
                row = existing_by_key[key]
                row.exists = parsed_doc.exists
                row.last_modified_at = parsed_doc.last_modified_at
            else:
                row = ChangeDocument(
                    id=uuid.uuid4(),
                    change_id=existing_change.id,
                    doc_type=parsed_doc.doc_type,
                    path=parsed_doc.path,
                    exists=parsed_doc.exists,
                    last_modified_at=parsed_doc.last_modified_at,
                )
                self._session.add(row)

        for key, row in existing_by_key.items():
            if key not in seen_keys:
                await self._session.delete(row)

    async def _fetch_existing_docs(
        self, change_id: uuid.UUID
    ) -> list[ChangeDocument]:
        stmt = select(ChangeDocument).where(
            col(ChangeDocument.change_id) == change_id
        )
        return list((await self._session.execute(stmt)).scalars().all())

    @staticmethod
    def _build_change(
        parsed: ParsedChange,
        *,
        workspace_id: uuid.UUID,
    ) -> Change:
        return Change(
            id=uuid.uuid4(),
            workspace_id=workspace_id,
            change_key=parsed.change_key,
            title=parsed.title,
            status=parsed.status,
            location=parsed.location,
            path=parsed.path,
            affected_components=parsed.affected_components,
            change_type=parsed.change_type,
            owner_id=None,
        )

    @staticmethod
    def _apply_parsed(
        row: Change,
        parsed: ParsedChange,
        *,
        workspace_id: uuid.UUID,
    ) -> None:
        row.title = parsed.title
        row.status = parsed.status
        row.location = parsed.location
        row.path = parsed.path
        row.affected_components = parsed.affected_components
        row.change_type = parsed.change_type
