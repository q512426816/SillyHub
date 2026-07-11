"""Tests for ScanDocsService — adapted to workspace-only model."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from pathlib import Path

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ScanDocNotFound, WorkspaceNotFound
from app.modules.scan_docs.conflict_model import ScanDocConflictHistory
from app.modules.scan_docs.model import ScanDocument
from app.modules.scan_docs.schema import ScanDocRead, ScanDocSummary
from app.modules.scan_docs.service import ScanDocsService
from app.modules.spec_workspace.model import SpecWorkspace
from app.modules.workspace.model import Workspace

SCAN_FIXTURES = Path(__file__).parent / "fixtures" / "docs"


async def _create_workspace(
    session: AsyncSession,
    *,
    root_path: str = "/tmp/test-ws",
    component_key: str | None = "silly",
) -> Workspace:
    ws = Workspace(
        id=uuid.uuid4(),
        name="Test Workspace",
        slug=f"test-ws-{uuid.uuid4().hex[:8]}",
        root_path=root_path,
        component_key=component_key,
        status="active",
    )
    session.add(ws)
    await session.commit()
    await session.refresh(ws)
    return ws


async def _create_spec_workspace(
    session: AsyncSession,
    workspace: Workspace,
    spec_root: str,
    strategy: str = "platform-managed",
) -> SpecWorkspace:
    spec_ws = SpecWorkspace(
        id=uuid.uuid4(),
        workspace_id=workspace.id,
        spec_root=spec_root,
        strategy=strategy,
        sync_status="clean",
    )
    session.add(spec_ws)
    await session.commit()
    await session.refresh(spec_ws)
    return spec_ws


async def _create_scan_doc(
    session: AsyncSession,
    workspace_id: uuid.UUID,
    doc_type: str,
    *,
    exists: bool = True,
    content: str | None = "sample content",
) -> ScanDocument:
    doc = ScanDocument(
        id=uuid.uuid4(),
        workspace_id=workspace_id,
        doc_type=doc_type,
        path=f".sillyspec/docs/silly/scan/{doc_type}.md",
        title=f"Test {doc_type}",
        exists=exists,
        content=content,
    )
    session.add(doc)
    await session.commit()
    await session.refresh(doc)
    return doc


async def _create_conflict(
    session: AsyncSession,
    workspace_id: uuid.UUID,
    path: str,
    *,
    created_at: datetime | None = None,
) -> ScanDocConflictHistory:
    """插入一条冲突归档（D-001@V1）以测试计数/列表。"""
    row = ScanDocConflictHistory(
        id=uuid.uuid4(),
        workspace_id=workspace_id,
        path=path,
        old_content="old",
        old_source_member_id=None,
        old_source_runtime_id=None,
        old_mtime=None,
        new_source_member_id=None,
        new_mtime=None,
        created_at=created_at or datetime.now(UTC),
    )
    session.add(row)
    await session.commit()
    await session.refresh(row)
    return row


# ── list_() ──────────────────────────────────────────────────────────────


class TestListDocsRequiresWorkspace:
    """list_() raises WorkspaceNotFound for non-existent workspace."""

    async def test_raises_not_found(self, db_session: AsyncSession) -> None:
        svc = ScanDocsService(db_session)
        with pytest.raises(WorkspaceNotFound):
            await svc.list_(uuid.uuid4())


class TestListDocsReturnsEmpty:
    """list_() returns ([], 0) when workspace exists but has no scan docs."""

    async def test_empty_result(self, db_session: AsyncSession) -> None:
        ws = await _create_workspace(db_session)
        svc = ScanDocsService(db_session)
        items, total, conflict_counts = await svc.list_(ws.id)
        assert items == []
        assert total == 0
        assert conflict_counts == {}


class TestListDocsReturnsExisting:
    """list_() returns correct list when workspace has docs."""

    async def test_returns_docs(self, db_session: AsyncSession) -> None:
        ws = await _create_workspace(db_session)
        await _create_scan_doc(db_session, ws.id, "ARCHITECTURE")
        await _create_scan_doc(db_session, ws.id, "STRUCTURE")

        svc = ScanDocsService(db_session)
        items, total, _conflict_counts = await svc.list_(ws.id)
        assert total == 2
        doc_types = {d.doc_type for d in items}
        assert doc_types == {"ARCHITECTURE", "STRUCTURE"}


class TestListDocsWithQuery:
    """list_(q=) 按 path/title/content 大小写不敏感搜索，并转义 LIKE 通配符。"""

    async def _make_doc(
        self,
        session: AsyncSession,
        workspace_id: uuid.UUID,
        *,
        path: str,
        title: str | None = None,
        content: str | None = None,
        doc_type: str = "OTHER",
    ) -> ScanDocument:
        doc = ScanDocument(
            id=uuid.uuid4(),
            workspace_id=workspace_id,
            doc_type=doc_type,
            path=path,
            title=title,
            exists=True,
            content=content,
        )
        session.add(doc)
        await session.commit()
        return doc

    async def test_q_none_returns_all(self, db_session: AsyncSession) -> None:
        ws = await _create_workspace(db_session)
        await self._make_doc(db_session, ws.id, path="docs/a/auth.md", title="Auth", content="c1")
        await self._make_doc(db_session, ws.id, path="docs/a/core.md", title="Core", content="c2")
        svc = ScanDocsService(db_session)
        _items, total, _cc = await svc.list_(ws.id)
        assert total == 2

    async def test_q_matches_path(self, db_session: AsyncSession) -> None:
        ws = await _create_workspace(db_session)
        await self._make_doc(
            db_session, ws.id, path="docs/silly/flows/auth.md", title="T", content="x"
        )
        await self._make_doc(
            db_session, ws.id, path="docs/silly/modules/agent.md", title="T", content="x"
        )
        svc = ScanDocsService(db_session)
        items, total, _cc = await svc.list_(ws.id, q="auth")
        assert total == 1
        assert "auth" in items[0].path

    async def test_q_matches_title(self, db_session: AsyncSession) -> None:
        ws = await _create_workspace(db_session)
        await self._make_doc(
            db_session, ws.id, path="docs/a/x.md", title="用户管理模块", content="x"
        )
        await self._make_doc(db_session, ws.id, path="docs/a/y.md", title="其他", content="x")
        svc = ScanDocsService(db_session)
        items, total, _cc = await svc.list_(ws.id, q="用户管理")
        assert total == 1
        assert items[0].title == "用户管理模块"

    async def test_q_matches_content(self, db_session: AsyncSession) -> None:
        ws = await _create_workspace(db_session)
        await self._make_doc(
            db_session,
            ws.id,
            path="docs/a/x.md",
            title="T",
            content="这里的正文包含 rareMarker123 标记",
        )
        await self._make_doc(db_session, ws.id, path="docs/a/y.md", title="T", content="无关内容")
        svc = ScanDocsService(db_session)
        items, total, _cc = await svc.list_(ws.id, q="rareMarker123")
        assert total == 1
        assert items[0].content is not None
        assert "rareMarker123" in items[0].content

    async def test_q_case_insensitive(self, db_session: AsyncSession) -> None:
        ws = await _create_workspace(db_session)
        await self._make_doc(db_session, ws.id, path="docs/a/AUTH.md", title="T", content="x")
        svc = ScanDocsService(db_session)
        _items, total, _cc = await svc.list_(ws.id, q="auth")
        assert total == 1

    async def test_q_no_match_returns_empty(self, db_session: AsyncSession) -> None:
        ws = await _create_workspace(db_session)
        await self._make_doc(
            db_session, ws.id, path="docs/a/auth.md", title="Auth", content="content"
        )
        svc = ScanDocsService(db_session)
        items, total, _cc = await svc.list_(ws.id, q="zzznotexist")
        assert total == 0
        assert items == []

    async def test_q_escapes_like_wildcards(self, db_session: AsyncSession) -> None:
        """q 含 % 应作为字面量搜索，而非匹配全部（验证转义生效）。"""
        ws = await _create_workspace(db_session)
        await self._make_doc(
            db_session, ws.id, path="docs/a/auth.md", title="Auth", content="content"
        )
        svc = ScanDocsService(db_session)
        _items, total, _cc = await svc.list_(ws.id, q="%")
        assert total == 0  # 字面 % 不出现在任何文档，转义后不会通配匹配全部


# ── get() ────────────────────────────────────────────────────────────────


class TestGetDocByType:
    """get() returns the correct ScanDocument."""

    async def test_returns_doc(self, db_session: AsyncSession) -> None:
        ws = await _create_workspace(db_session)
        await _create_scan_doc(db_session, ws.id, "ARCHITECTURE")

        svc = ScanDocsService(db_session)
        doc = await svc.get(ws.id, "ARCHITECTURE")
        assert doc.doc_type == "ARCHITECTURE"
        assert doc.content == "sample content"


class TestGetDocNotFound:
    """get() raises ScanDocNotFound for missing doc_type."""

    async def test_raises_not_found(self, db_session: AsyncSession) -> None:
        ws = await _create_workspace(db_session)

        svc = ScanDocsService(db_session)
        with pytest.raises(ScanDocNotFound):
            await svc.get(ws.id, "NONEXISTENT")


class TestGetDocWorkspaceNotFound:
    """get() raises WorkspaceNotFound for missing workspace."""

    async def test_raises_workspace_not_found(self, db_session: AsyncSession) -> None:
        svc = ScanDocsService(db_session)
        with pytest.raises(WorkspaceNotFound):
            await svc.get(uuid.uuid4(), "ARCHITECTURE")


# ── reparse() ────────────────────────────────────────────────────────────


class TestReparseNoComponentKey:
    """reparse() returns empty stats when workspace has no component_key."""

    async def test_empty_stats(self, db_session: AsyncSession) -> None:
        ws = await _create_workspace(db_session, component_key=None)

        svc = ScanDocsService(db_session)
        stats, result = await svc.reparse(ws.id)
        assert stats == {"parsed": 0, "created": 0, "updated": 0, "deleted": 0}
        assert result.docs == []


class TestReparseCreatesDocs:
    """reparse() creates new ScanDocument rows from filesystem."""

    async def test_creates_rows(self, db_session: AsyncSession, tmp_path: Path) -> None:
        # Set up filesystem fixture
        sillyspec_root = tmp_path / "spec"
        scan_dir = sillyspec_root / "docs" / "silly" / "scan"
        scan_dir.mkdir(parents=True, exist_ok=True)
        (scan_dir / "ARCHITECTURE.md").write_text(
            "# Test Architecture\nContent here.", encoding="utf-8"
        )

        ws = await _create_workspace(
            db_session, root_path=str(sillyspec_root), component_key="silly"
        )
        await _create_spec_workspace(db_session, ws, str(sillyspec_root))

        svc = ScanDocsService(db_session)
        stats, _result = await svc.reparse(ws.id)

        assert stats["created"] > 0
        # Verify the doc exists in DB
        items, total, _cc = await svc.list_(ws.id)
        assert total > 0
        arch = next((d for d in items if d.doc_type == "ARCHITECTURE"), None)
        assert arch is not None
        assert arch.exists is True
        assert arch.content is not None
        assert "Test Architecture" in arch.content

    async def test_daemon_client_reads_flat_platform_spec_root(
        self, db_session: AsyncSession, tmp_path: Path
    ) -> None:
        """daemon-client workspace reads ``spec_root/docs/...`` without a .sillyspec wrapper."""
        spec_root = tmp_path / "spec"
        scan_dir = spec_root / "docs" / "silly" / "scan"
        scan_dir.mkdir(parents=True, exist_ok=True)
        (scan_dir / "ARCHITECTURE.md").write_text(
            "# Flat Architecture\nDaemon-client content.", encoding="utf-8"
        )

        ws = await _create_workspace(
            db_session,
            root_path=str(tmp_path / "client-unreachable"),
            component_key="silly",
        )
        await _create_spec_workspace(db_session, ws, str(spec_root))

        svc = ScanDocsService(db_session)
        stats, _result = await svc.reparse(ws.id)

        assert stats["created"] > 0
        items, total, _cc = await svc.list_(ws.id)
        assert total > 0
        arch = next((d for d in items if d.doc_type == "ARCHITECTURE"), None)
        assert arch is not None
        assert arch.path == "docs/silly/scan/ARCHITECTURE.md"
        assert arch.content is not None
        assert "Flat Architecture" in arch.content


class TestReparseUpdatesDocs:
    """reparse() updates existing rows when content changes."""

    async def test_updates_rows(self, db_session: AsyncSession, tmp_path: Path) -> None:
        # Set up filesystem fixture
        sillyspec_root = tmp_path / "spec"
        scan_dir = sillyspec_root / "docs" / "silly" / "scan"
        scan_dir.mkdir(parents=True, exist_ok=True)
        (scan_dir / "ARCHITECTURE.md").write_text("# V1 Architecture\nOriginal.", encoding="utf-8")

        ws = await _create_workspace(
            db_session, root_path=str(sillyspec_root), component_key="silly"
        )
        await _create_spec_workspace(db_session, ws, str(sillyspec_root))

        svc = ScanDocsService(db_session)

        # First reparse
        stats1, _ = await svc.reparse(ws.id)
        assert stats1["created"] > 0

        # Modify the file
        (scan_dir / "ARCHITECTURE.md").write_text(
            "# V2 Architecture\nUpdated content.", encoding="utf-8"
        )

        # Second reparse
        stats2, _ = await svc.reparse(ws.id)
        assert stats2["updated"] >= 1

        items, _, _cc = await svc.list_(ws.id)
        arch = next(d for d in items if d.doc_type == "ARCHITECTURE")
        assert "V2 Architecture" in arch.content


class TestReparseIdempotent:
    """Two consecutive reparses produce consistent state."""

    async def test_idempotent(self, db_session: AsyncSession, tmp_path: Path) -> None:
        sillyspec_root = tmp_path / "spec"
        scan_dir = sillyspec_root / "docs" / "silly" / "scan"
        scan_dir.mkdir(parents=True, exist_ok=True)
        (scan_dir / "ARCHITECTURE.md").write_text("# Stable Content\nUnchanged.", encoding="utf-8")

        ws = await _create_workspace(
            db_session, root_path=str(sillyspec_root), component_key="silly"
        )
        await _create_spec_workspace(db_session, ws, str(sillyspec_root))

        svc = ScanDocsService(db_session)
        stats1, _ = await svc.reparse(ws.id)
        stats2, _ = await svc.reparse(ws.id)

        # Second reparse should only update (no creates or deletes)
        assert stats2["created"] == 0
        assert stats2["deleted"] == 0
        assert stats2["updated"] > 0

        # Same total count
        _items1, total1, _cc = await svc.list_(ws.id)
        assert total1 == stats1["created"] + stats1["updated"]


class TestReparseRemovesDeletedFiles:
    """reparse() marks rows as exists=False when files are removed from disk."""

    async def test_marks_not_existing(self, db_session: AsyncSession, tmp_path: Path) -> None:
        sillyspec_root = tmp_path / "spec"
        scan_dir = sillyspec_root / "docs" / "silly" / "scan"
        scan_dir.mkdir(parents=True, exist_ok=True)
        arch_file = scan_dir / "ARCHITECTURE.md"
        arch_file.write_text("# Architecture\nContent.", encoding="utf-8")

        ws = await _create_workspace(
            db_session, root_path=str(sillyspec_root), component_key="silly"
        )
        await _create_spec_workspace(db_session, ws, str(sillyspec_root))

        svc = ScanDocsService(db_session)
        await svc.reparse(ws.id)

        # Delete the file from disk
        arch_file.unlink()

        # Reparse again
        _stats, _ = await svc.reparse(ws.id)

        # list_() filters by exists=True, so query directly to verify soft-delete
        stmt = select(ScanDocument).where(
            ScanDocument.workspace_id == ws.id,
            ScanDocument.doc_type == "ARCHITECTURE",
        )
        arch = (await db_session.execute(stmt)).scalar_one()
        assert arch.exists is False
        assert arch.content is None


# ── schema 字段映射 + conflict_count（task-02）─────────────────────────


class TestSchemaMapsSourceFields:
    """ScanDocSummary/ScanDocRead 通过 from_attributes 映射 model 已有列。"""

    async def test_summary_maps_source_and_hash(self, db_session: AsyncSession) -> None:
        ws = await _create_workspace(db_session)
        member_id = uuid.uuid4()
        synced = datetime.now(UTC)
        mtime = datetime.now(UTC)
        doc = ScanDocument(
            id=uuid.uuid4(),
            workspace_id=ws.id,
            doc_type="ARCH",
            path="docs/ARCH.md",
            title="t",
            exists=True,
            content="c",
            source_member_id=member_id,
            source_synced_at=synced,
            source_mtime=mtime,
            content_hash="abc123",
        )
        db_session.add(doc)
        await db_session.commit()
        await db_session.refresh(doc)

        summary = ScanDocSummary.model_validate(doc)
        assert summary.source_member_id == member_id
        assert summary.content_hash == "abc123"
        # conflict_count 默认 0（model 无此列，需 router 注入）
        assert summary.conflict_count == 0

        read = ScanDocRead.model_validate(doc)
        assert read.source_member_id == member_id
        assert read.content_hash == "abc123"
        # SQLite/aiosqlite 存 naive datetime（去掉 tzinfo 比较，详见 backend-test-sqlite-vs-pg）
        assert read.source_mtime.replace(tzinfo=None) == mtime.replace(tzinfo=None)


# ── conflict_count（task-03）─────────────────────────────────────────────


class TestListConflictCounts:
    """list_ 返回的 conflict_counts 在 0/1/多 冲突历史下都正确。"""

    async def test_zero_when_no_history(self, db_session: AsyncSession) -> None:
        ws = await _create_workspace(db_session)
        await _create_scan_doc(db_session, ws.id, "ARCH")
        svc = ScanDocsService(db_session)
        _items, _total, conflict_counts = await svc.list_(ws.id)
        assert conflict_counts == {}

    async def test_one_conflict(self, db_session: AsyncSession) -> None:
        ws = await _create_workspace(db_session)
        doc = await _create_scan_doc(db_session, ws.id, "ARCH")
        await _create_conflict(db_session, ws.id, doc.path)
        svc = ScanDocsService(db_session)
        items, _total, conflict_counts = await svc.list_(ws.id)
        assert conflict_counts == {doc.path: 1}
        # router 注入后该条目计数 = 1
        s = ScanDocSummary.model_validate(items[0])
        s = s.model_copy(update={"conflict_count": conflict_counts.get(items[0].path, 0)})
        assert s.conflict_count == 1

    async def test_multiple_conflicts_per_path(self, db_session: AsyncSession) -> None:
        ws = await _create_workspace(db_session)
        doc_a = await _create_scan_doc(db_session, ws.id, "ARCH_A")
        doc_b = await _create_scan_doc(db_session, ws.id, "ARCH_B")
        # doc_a 3 条冲突，doc_b 1 条
        await _create_conflict(db_session, ws.id, doc_a.path)
        await _create_conflict(db_session, ws.id, doc_a.path)
        await _create_conflict(db_session, ws.id, doc_a.path)
        await _create_conflict(db_session, ws.id, doc_b.path)
        svc = ScanDocsService(db_session)
        _items, _total, conflict_counts = await svc.list_(ws.id)
        assert conflict_counts == {doc_a.path: 3, doc_b.path: 1}


class TestCountConflictsSingle:
    """count_conflicts(workspace_id, path) 返回单路径计数。"""

    async def test_count(self, db_session: AsyncSession) -> None:
        ws = await _create_workspace(db_session)
        doc = await _create_scan_doc(db_session, ws.id, "ARCH")
        await _create_conflict(db_session, ws.id, doc.path)
        await _create_conflict(db_session, ws.id, doc.path)
        svc = ScanDocsService(db_session)
        assert await svc.count_conflicts(ws.id, doc.path) == 2

    async def test_count_zero(self, db_session: AsyncSession) -> None:
        ws = await _create_workspace(db_session)
        svc = ScanDocsService(db_session)
        assert await svc.count_conflicts(ws.id, "nope.md") == 0


# ── list_conflicts（task-03）─────────────────────────────────────────────


class TestListConflictsByDoc:
    """list_conflicts 按 created_at 倒序；doc 不存在抛 ScanDocNotFound。"""

    async def test_descending_by_created_at(self, db_session: AsyncSession) -> None:
        ws = await _create_workspace(db_session)
        doc = await _create_scan_doc(db_session, ws.id, "ARCH")
        # 三条递增时间戳的冲突历史
        t1 = datetime(2026, 7, 1, 12, 0, 0, tzinfo=UTC)
        t2 = datetime(2026, 7, 2, 12, 0, 0, tzinfo=UTC)
        t3 = datetime(2026, 7, 3, 12, 0, 0, tzinfo=UTC)
        await _create_conflict(db_session, ws.id, doc.path, created_at=t1)
        await _create_conflict(db_session, ws.id, doc.path, created_at=t3)
        await _create_conflict(db_session, ws.id, doc.path, created_at=t2)
        svc = ScanDocsService(db_session)
        rows = await svc.list_conflicts(ws.id, doc.id)
        # SQLite 存 naive，比较时统一去 tzinfo
        got = [
            r.created_at.replace(tzinfo=None) if r.created_at.tzinfo else r.created_at for r in rows
        ]
        want = [t3.replace(tzinfo=None), t2.replace(tzinfo=None), t1.replace(tzinfo=None)]
        assert got == want

    async def test_doc_not_found_raises(self, db_session: AsyncSession) -> None:
        ws = await _create_workspace(db_session)
        svc = ScanDocsService(db_session)
        with pytest.raises(ScanDocNotFound):
            await svc.list_conflicts(ws.id, uuid.uuid4())

    async def test_workspace_not_found_raises(self, db_session: AsyncSession) -> None:
        svc = ScanDocsService(db_session)
        with pytest.raises(WorkspaceNotFound):
            await svc.list_conflicts(uuid.uuid4(), uuid.uuid4())
