"""Knowledge / Quicklog service — reads from filesystem, no DB persistence."""

from __future__ import annotations

import asyncio
import uuid
from pathlib import Path

from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.knowledge.parser import KnowledgeParser, ParsedEntry
from app.modules.knowledge.schema import KnowledgeEntry, KnowledgeList, QuicklogEntry, QuicklogList
from app.modules.workspace.service import WorkspaceService


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

        task-09（2026-07-10-remove-server-local-workspace-mode）：单一 daemon-client
        后所有 workspace 均走 platform-managed spec_root（扁平布局，knowledge/ 直接在
        spec_root 下）。先尝试读 SpecWorkspaceService.spec_root，失败兜底
        ``Path(root_path) / ".sillyspec"``（spec_workspace 无数据时零回归）。
        """
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
        # BQ-2（2026-08-20 审计）：同步 rglob+read 移线程池，别占事件循环
        # （对齐 scan_docs task-01 范式）。
        entries = await asyncio.to_thread(self._parser.parse_knowledge, root)
        # task-03（2026-09-20-knowledge-effect-panel）：列表透传文件级 use_count
        # （无数据 0；proposed 条目同口径，不分 zone 特判）。
        file_use = await self._usage_file_counts(workspace_id)
        items = [
            self._to_knowledge_entry(
                e, include_content=False, use_count=file_use.get(e.filename, 0)
            )
            for e in entries
        ]
        return KnowledgeList(items=items, total=len(items))

    async def _usage_file_counts(self, workspace_id: uuid.UUID) -> dict[str, int]:
        """文件级使用计数：使用计数行（type∈{inject, fr-inject}）matched_anchors
        拆锚点后按 ``#`` 前缀（=filename）聚合，与 HitsService.stats 的
        entry_counts 同口径（不整跑 stats——列表低频单查仅取锚点列，开销可控）。

        延迟导入防环：hits.py 顶层 import 本模块（复用 _spec_content_root）。
        """
        from sqlalchemy import select

        from app.modules.knowledge.hits import USAGE_TYPES, KnowledgeHit

        rows = (
            (
                await self._session.execute(
                    select(KnowledgeHit.matched_anchors).where(
                        KnowledgeHit.workspace_id == workspace_id,
                        KnowledgeHit.type.in_(USAGE_TYPES),
                    )
                )
            )
            .scalars()
            .all()
        )
        counts: dict[str, int] = {}
        for matched in rows:
            for anchor in matched or []:
                file_key = anchor.split("#", 1)[0]
                counts[file_key] = counts.get(file_key, 0) + 1
        return counts

    async def get_knowledge(self, workspace_id: uuid.UUID, filename: str) -> KnowledgeEntry:
        workspace = await self._ws_service.get(workspace_id)
        root = await self._spec_content_root(workspace)
        entries = await asyncio.to_thread(self._parser.parse_knowledge, root)
        for e in entries:
            if e.filename == filename:
                return self._to_knowledge_entry(e, include_content=True)

        from app.core.errors import WorkspaceNotFound

        raise WorkspaceNotFound(
            "知识库文件不存在，请刷新文件列表后重试。",
            details={"workspace_id": str(workspace_id), "filename": filename},
        )

    async def list_quicklog(self, workspace_id: uuid.UUID) -> QuicklogList:
        workspace = await self._ws_service.get(workspace_id)
        root = await self._spec_content_root(workspace)
        entries = await asyncio.to_thread(self._parser.parse_quicklog, root)
        items = [self._to_quicklog_entry(e, include_content=False) for e in entries]
        return QuicklogList(items=items, total=len(items))

    async def get_quicklog(self, workspace_id: uuid.UUID, filename: str) -> QuicklogEntry:
        workspace = await self._ws_service.get(workspace_id)
        root = await self._spec_content_root(workspace)
        entries = await asyncio.to_thread(self._parser.parse_quicklog, root)
        for e in entries:
            if e.filename == filename:
                return self._to_quicklog_entry(e, include_content=True)

        from app.core.errors import WorkspaceNotFound

        raise WorkspaceNotFound(
            "快速日志文件不存在，请刷新文件列表后重试。",
            details={"workspace_id": str(workspace_id), "filename": filename},
        )

    @staticmethod
    def _to_knowledge_entry(
        e: ParsedEntry, *, include_content: bool, use_count: int | None = None
    ) -> KnowledgeEntry:
        # task-01（2026-09-17-knowledge-precipitation）：透传 zone；get_knowledge 按
        # filename（含子目录段后值天然唯一）精确匹配，消除跨 zone 同名歧义。
        # task-03（2026-09-20-knowledge-effect-panel）：use_count 由 list 透传真实
        # 聚合值（get_knowledge 维持缺省 None，详情侧不查 hits）。
        return KnowledgeEntry(
            zone=e.zone,
            filename=e.filename,
            path=e.path,
            title=e.title,
            content=e.content if include_content else None,
            last_modified_at=e.last_modified_at,
            use_count=use_count,
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
