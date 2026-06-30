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
        doc_id_or_type: uuid.UUID | str,
    ) -> ScanDocument:
        await self._workspace_service.get(workspace_id)
        if isinstance(doc_id_or_type, str):
            stmt = (
                select(ScanDocument)
                .where(col(ScanDocument.workspace_id) == workspace_id)
                .where(col(ScanDocument.doc_type) == doc_id_or_type)
            )
            doc = (await self._session.execute(stmt)).scalar_one_or_none()
        else:
            doc = await self._session.get(ScanDocument, doc_id_or_type)
            if doc is not None and doc.workspace_id != workspace_id:
                doc = None
        if doc is None:
            raise ScanDocNotFound(
                "Scan doc not found.",
                details={
                    "workspace_id": str(workspace_id),
                    "doc_id_or_type": str(doc_id_or_type),
                },
            )
        return doc

    # -- Reparse ---

    async def reparse(self, workspace_id: uuid.UUID) -> tuple[dict[str, int], ScanDocsResult]:
        """Reparse all docs under .sillyspec/docs/ for a workspace."""
        workspace = await self._workspace_service.get(workspace_id)

        # 平台 specRoot 有镜像数据就读（任意 strategy：platform-managed/repo-native/repo-mirrored）。
        # 旧逻辑只 platform-managed 读 spec_root，导致 repo-native/repo-mirrored 读 root_path
        # （daemon-client 客户端路径容器内不可达）→ DOCS_DIR_MISSING → 扫描文档不显示。
        sillyspec_root = Path(workspace.root_path)
        platform_managed = False
        try:
            from app.modules.spec_workspace.service import SpecWorkspaceService

            spec_ws_svc = SpecWorkspaceService(self._session)
            spec_ws = await spec_ws_svc.get(workspace.id)
            if spec_ws.spec_root:
                sillyspec_root = Path(spec_ws.spec_root)
                # D-005@v1：mode 看 path_source（正交于 root）。daemon-client 同步产出扁平
                # 布局（无 .sillyspec 包裹）；server-local 平台镜像仍包裹。
                from app.modules.workspace.service import is_daemon_client_path_source

                platform_managed = is_daemon_client_path_source(workspace.path_source)
        except Exception:
            pass

        stats = {"parsed": 0, "created": 0, "updated": 0, "deleted": 0}

        if not workspace.component_key:
            # Parent workspace — parse the entire docs tree recursively
            result = self._parser.parse_docs_tree(sillyspec_root, platform_managed=platform_managed)
        else:
            result = self._parser.parse_component(
                sillyspec_root, workspace.component_key, platform_managed=platform_managed
            )
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

        # Soft-delete rows whose files disappeared
        for row in existing:
            if row.path not in parsed_paths:
                row.exists = False
                row.content = None
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
