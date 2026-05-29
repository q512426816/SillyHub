"""Archive Service.

Archives completed changes by moving their directory to an archive location.
Generates knowledge summaries from change content.
"""

from __future__ import annotations

import shutil
import uuid
from datetime import datetime
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError
from app.core.logging import get_logger
from app.modules.change.model import Change, ChangeDocument
from app.modules.workspace.model import Workspace

log = get_logger(__name__)


class ArchiveError(AppError):
    code = "ARCHIVE_ERROR"
    http_status = 400


class ArchiveNotFound(AppError):
    code = "ARCHIVE_NOT_FOUND"
    http_status = 404


class ChangeNotArchivable(ArchiveError):
    code = "CHANGE_NOT_ARCHIVABLE"
    http_status = 409


class ArchiveService:
    """Archive completed changes and distill knowledge."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def archive_change(
        self,
        workspace_id: uuid.UUID,
        change_id: uuid.UUID,
    ) -> Change:
        change = await self._session.get(Change, change_id)
        if change is None:
            raise ArchiveNotFound(f"Change '{change_id}' not found.")
        if change.workspace_id != workspace_id:
            raise ArchiveNotFound("Change does not belong to workspace.")
        if change.status != "done":
            raise ChangeNotArchivable(
                "Only changes with status 'done' can be archived.",
                details={"current_status": change.status},
            )

        workspace = await self._session.get(Workspace, workspace_id)
        if workspace is None:
            raise ArchiveNotFound(f"Workspace '{workspace_id}' not found.")

        ws_root = Path(workspace.root_path)
        change_dir = ws_root / change.path
        archive_dir = ws_root / "archive" / change.path.replace("/", "-")

        if change_dir.exists():
            archive_dir.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(change_dir), str(archive_dir))
            log.info("archive_moved", change_id=str(change_id), dest=str(archive_dir))

        change.status = "archived"
        change.archived_at = datetime.utcnow()
        await self._session.commit()
        await self._session.refresh(change)

        log.info("change_archived", change_id=str(change_id))
        return change

    async def distill_knowledge(
        self,
        workspace_id: uuid.UUID,
        change_id: uuid.UUID,
    ) -> dict:
        """Generate a knowledge summary from a completed change."""
        change = await self._session.get(Change, change_id)
        if change is None:
            raise ArchiveNotFound(f"Change '{change_id}' not found.")
        if change.workspace_id != workspace_id:
            raise ArchiveNotFound("Change does not belong to workspace.")

        stmt = (
            select(ChangeDocument)
            .where(ChangeDocument.change_id == change_id)
            .order_by(ChangeDocument.doc_type)
        )
        docs = list((await self._session.execute(stmt)).scalars().all())

        workspace = await self._session.get(Workspace, workspace_id)
        ws_root = Path(workspace.root_path) if workspace else Path(".")

        doc_summaries: list[dict] = []
        for doc in docs:
            doc_path = ws_root / doc.path
            content = ""
            if doc_path.exists() and doc_path.is_file():
                content = doc_path.read_text(encoding="utf-8", errors="replace")[:2000]
            doc_summaries.append({
                "type": doc.doc_type,
                "path": doc.path,
                "content_preview": content[:500] if content else None,
            })

        summary = {
            "change_key": change.change_key,
            "title": change.title,
            "status": change.status,
            "change_type": change.change_type,
            "affected_components": change.affected_components,
            "documents": doc_summaries,
            "distilled_at": datetime.utcnow().isoformat(),
        }

        # Write knowledge file
        knowledge_dir = ws_root / ".sillyspec" / "knowledge"
        knowledge_dir.mkdir(parents=True, exist_ok=True)
        knowledge_file = knowledge_dir / f"{change.change_key}.md"
        knowledge_content = self._render_knowledge_md(summary)
        knowledge_file.write_text(knowledge_content, encoding="utf-8")

        log.info("knowledge_distilled", change_id=str(change_id))
        return summary

    @staticmethod
    def _render_knowledge_md(summary: dict) -> str:
        lines = [
            f"# {summary['title'] or summary['change_key']}",
            "",
            f"- **Change Key**: {summary['change_key']}",
            f"- **Status**: {summary['status']}",
            f"- **Type**: {summary['change_type'] or 'N/A'}",
            f"- **Components**: {', '.join(summary['affected_components']) or 'N/A'}",
            "",
        ]
        if summary.get("documents"):
            lines.append("## Documents")
            lines.append("")
            for doc in summary["documents"]:
                lines.append(f"### {doc['type']} ({doc['path']})")
                if doc.get("content_preview"):
                    lines.append("```")
                    lines.append(doc["content_preview"])
                    lines.append("```")
                lines.append("")
        return "\n".join(lines)
