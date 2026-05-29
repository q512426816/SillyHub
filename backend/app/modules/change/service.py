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
from app.modules.change.schema import ChangeRead, ChangeSummary
from app.modules.workspace.model import ChangeWorkspace, Workspace
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

        # Query via primary workspace FK OR M:N association table
        mn_subq = select(ChangeWorkspace.change_id).where(
            col(ChangeWorkspace.workspace_id) == workspace_id,
        )
        stmt = select(Change).where(
            (col(Change.workspace_id) == workspace_id)
            | (col(Change.id).in_(mn_subq))
        )

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
        # De-duplicate (primary workspace and M:N may overlap)
        seen: set[uuid.UUID] = set()
        unique_items: list[Change] = []
        for item in items:
            if item.id not in seen:
                seen.add(item.id)
                unique_items.append(item)
        return unique_items, len(unique_items)

    async def get(self, workspace_id: uuid.UUID, change_id: uuid.UUID) -> Change:
        await self._workspace_service.get(workspace_id)

        # Try primary workspace match first
        stmt = select(Change).where(
            col(Change.id) == change_id,
            col(Change.workspace_id) == workspace_id,
        )
        change = (await self._session.execute(stmt)).scalars().first()

        # If primary workspace doesn't match, check M:N table
        if change is None:
            mn_stmt = select(ChangeWorkspace).where(
                col(ChangeWorkspace.change_id) == change_id,
                col(ChangeWorkspace.workspace_id) == workspace_id,
            )
            mn = (await self._session.execute(mn_stmt)).scalars().first()
            if mn is not None:
                change = await self._session.get(Change, change_id)

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

            # Sync M:N workspace associations
            target_id = (
                existing_by_key[parsed.change_key].id
                if parsed.change_key in existing_by_key
                else row.id
            )
            await self._sync_change_workspaces(
                change_id=target_id,
                workspace_id=workspace_id,
                parsed=parsed,
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

    # ── M:N Enrichment ──────────────────────────────────────────────────

    async def enrich_with_workspace_ids(self, change: Change) -> ChangeRead:
        """Build ChangeRead with workspace_ids populated from M:N table.

        workspace_ids list starts with the primary workspace_id, followed by
        secondary workspace IDs from the M:N table. No duplicates.
        """
        stmt = select(ChangeWorkspace.workspace_id).where(
            col(ChangeWorkspace.change_id) == change.id,
        )
        all_mn = [row[0] for row in (await self._session.execute(stmt)).all()]
        # Exclude primary workspace_id to avoid duplication
        secondary = [wid for wid in all_mn if wid != change.workspace_id]
        data = ChangeRead.model_validate(change)
        data.workspace_ids = [change.workspace_id] + secondary
        return data

    async def enrich_summaries(self, changes: list[Change]) -> list[ChangeSummary]:
        """Build ChangeSummary list with workspace_ids populated.

        Queries the M:N table for each change to get associated workspace IDs.
        For MVP scale, per-item queries are sufficient.
        """
        result: list[ChangeSummary] = []
        for c in changes:
            stmt = select(ChangeWorkspace.workspace_id).where(
                col(ChangeWorkspace.change_id) == c.id,
            )
            all_mn = [row[0] for row in (await self._session.execute(stmt)).all()]
            secondary = [wid for wid in all_mn if wid != c.workspace_id]
            data = ChangeSummary.model_validate(c)
            data.workspace_ids = [c.workspace_id] + secondary
            result.append(data)
        return result

    # ── M:N Sync ────────────────────────────────────────────────────────

    async def _sync_change_workspaces(
        self,
        change_id: uuid.UUID,
        workspace_id: uuid.UUID,
        parsed: ParsedChange,
    ) -> None:
        """Sync M:N associations for a change based on affected_components.

        Strategy:
        1. Primary workspace is always written with role="primary"
        2. affected_components matching a workspace component_key -> role="affected"
        3. Existing associations not in the new list are deleted
        """
        ws_ids: set[uuid.UUID] = {workspace_id}
        if parsed.affected_components:
            stmt = select(Workspace.id).where(
                col(Workspace.component_key).in_(parsed.affected_components),
                col(Workspace.deleted_at).is_(None),
            )
            extra = [row[0] for row in (await self._session.execute(stmt)).all()]
            ws_ids.update(extra)

        # Get existing associations
        existing_stmt = select(ChangeWorkspace).where(
            col(ChangeWorkspace.change_id) == change_id,
        )
        existing = list(
            (await self._session.execute(existing_stmt)).scalars().all()
        )
        existing_ws_ids = {cw.workspace_id for cw in existing}

        # Delete stale associations
        for cw in existing:
            if cw.workspace_id not in ws_ids:
                await self._session.delete(cw)

        # Add new associations
        for wid in ws_ids - existing_ws_ids:
            role = "primary" if wid == workspace_id else "affected"
            self._session.add(
                ChangeWorkspace(
                    change_id=change_id,
                    workspace_id=wid,
                    role=role,
                )
            )

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
