"""Knowledge / Quicklog service — reads from filesystem, no DB persistence."""

from __future__ import annotations

import uuid
from pathlib import Path

from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.knowledge.parser import KnowledgeParser, ParsedEntry
from app.modules.knowledge.schema import KnowledgeEntry, KnowledgeList, QuicklogEntry, QuicklogList
from app.modules.workspace.service import WorkspaceService, is_daemon_client_path_source


class KnowledgeService:
    """Read-only service for knowledge and quicklog entries."""

    def __init__(
        self,
        session: AsyncSession,
        *,
        workspace_service: WorkspaceService | None = None,
        parser: KnowledgeParser | None = None,
    ) -> None:
        self._session = session
        self._ws_service = workspace_service or WorkspaceService(session)
        self._parser = parser or KnowledgeParser()

    async def _spec_content_root(self, workspace) -> Path:
        """解析 `.sillyspec` 内容根（parser 在其下找 knowledge/、quicklog/）。

        判据用 ``path_source == "daemon-client"``（与 workspace.service 一致）：
        只有 daemon-client 的 root_path 在客户端机不可达，需读 platform-managed
        spec_root（扁平，knowledge/ 直接在其下）。server-local / repo-native 读
        ``root_path / ".sillyspec"``（仓库自有 .sillyspec，R6）。
        """
        if is_daemon_client_path_source(workspace.path_source):
            try:
                from app.modules.spec_workspace.service import SpecWorkspaceService

                spec_ws = await SpecWorkspaceService(self._session).get(workspace.id)
                if spec_ws.spec_root:
                    return Path(spec_ws.spec_root)
            except Exception:
                pass
        return Path(workspace.root_path) / ".sillyspec"

    async def list_knowledge(self, workspace_id: uuid.UUID) -> KnowledgeList:
        workspace = await self._ws_service.get(workspace_id)
        root = await self._spec_content_root(workspace)
        entries = self._parser.parse_knowledge(root)
        items = [self._to_knowledge_entry(e, include_content=False) for e in entries]
        return KnowledgeList(items=items, total=len(items))

    async def get_knowledge(self, workspace_id: uuid.UUID, filename: str) -> KnowledgeEntry:
        workspace = await self._ws_service.get(workspace_id)
        root = await self._spec_content_root(workspace)
        entries = self._parser.parse_knowledge(root)
        for e in entries:
            if e.filename == filename:
                return self._to_knowledge_entry(e, include_content=True)

        from app.core.errors import WorkspaceNotFound

        raise WorkspaceNotFound(
            f"Knowledge file '{filename}' not found.",
            details={"workspace_id": str(workspace_id), "filename": filename},
        )

    async def list_quicklog(self, workspace_id: uuid.UUID) -> QuicklogList:
        workspace = await self._ws_service.get(workspace_id)
        root = await self._spec_content_root(workspace)
        entries = self._parser.parse_quicklog(root)
        items = [self._to_quicklog_entry(e, include_content=False) for e in entries]
        return QuicklogList(items=items, total=len(items))

    async def get_quicklog(self, workspace_id: uuid.UUID, filename: str) -> QuicklogEntry:
        workspace = await self._ws_service.get(workspace_id)
        root = await self._spec_content_root(workspace)
        entries = self._parser.parse_quicklog(root)
        for e in entries:
            if e.filename == filename:
                return self._to_quicklog_entry(e, include_content=True)

        from app.core.errors import WorkspaceNotFound

        raise WorkspaceNotFound(
            f"Quicklog file '{filename}' not found.",
            details={"workspace_id": str(workspace_id), "filename": filename},
        )

    @staticmethod
    def _to_knowledge_entry(e: ParsedEntry, *, include_content: bool) -> KnowledgeEntry:
        return KnowledgeEntry(
            filename=e.filename,
            path=e.path,
            title=e.title,
            content=e.content if include_content else None,
            last_modified_at=e.last_modified_at,
        )

    @staticmethod
    def _to_quicklog_entry(e: ParsedEntry, *, include_content: bool) -> QuicklogEntry:
        return QuicklogEntry(
            filename=e.filename,
            path=e.path,
            title=e.title,
            content=e.content if include_content else None,
            last_modified_at=e.last_modified_at,
        )
