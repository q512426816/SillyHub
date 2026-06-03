"""Tests for ScanDocsService — adapted to workspace-only model."""

from __future__ import annotations

import uuid
from pathlib import Path

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ScanDocNotFound, WorkspaceNotFound
from app.modules.scan_docs.model import ScanDocument
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
        items, total = await svc.list_(ws.id)
        assert items == []
        assert total == 0


class TestListDocsReturnsExisting:
    """list_() returns correct list when workspace has docs."""

    async def test_returns_docs(self, db_session: AsyncSession) -> None:
        ws = await _create_workspace(db_session)
        await _create_scan_doc(db_session, ws.id, "ARCHITECTURE")
        await _create_scan_doc(db_session, ws.id, "STRUCTURE")

        svc = ScanDocsService(db_session)
        items, total = await svc.list_(ws.id)
        assert total == 2
        doc_types = {d.doc_type for d in items}
        assert doc_types == {"ARCHITECTURE", "STRUCTURE"}


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
        scan_dir = sillyspec_root / ".sillyspec" / "docs" / "silly" / "scan"
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
        items, total = await svc.list_(ws.id)
        assert total > 0
        arch = next((d for d in items if d.doc_type == "ARCHITECTURE"), None)
        assert arch is not None
        assert arch.exists is True
        assert arch.content is not None
        assert "Test Architecture" in arch.content


class TestReparseUpdatesDocs:
    """reparse() updates existing rows when content changes."""

    async def test_updates_rows(self, db_session: AsyncSession, tmp_path: Path) -> None:
        # Set up filesystem fixture
        sillyspec_root = tmp_path / "spec"
        scan_dir = sillyspec_root / ".sillyspec" / "docs" / "silly" / "scan"
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

        items, _ = await svc.list_(ws.id)
        arch = next(d for d in items if d.doc_type == "ARCHITECTURE")
        assert "V2 Architecture" in arch.content


class TestReparseIdempotent:
    """Two consecutive reparses produce consistent state."""

    async def test_idempotent(self, db_session: AsyncSession, tmp_path: Path) -> None:
        sillyspec_root = tmp_path / "spec"
        scan_dir = sillyspec_root / ".sillyspec" / "docs" / "silly" / "scan"
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
        _items1, total1 = await svc.list_(ws.id)
        assert total1 == stats1["created"] + stats1["updated"]


class TestReparseRemovesDeletedFiles:
    """reparse() marks rows as exists=False when files are removed from disk."""

    async def test_marks_not_existing(self, db_session: AsyncSession, tmp_path: Path) -> None:
        sillyspec_root = tmp_path / "spec"
        scan_dir = sillyspec_root / ".sillyspec" / "docs" / "silly" / "scan"
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
