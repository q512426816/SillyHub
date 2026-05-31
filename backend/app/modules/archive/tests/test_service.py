"""Unit tests for ArchiveService."""

from __future__ import annotations

import uuid
from pathlib import Path

import pytest

from app.modules.archive.service import ArchiveService, ChangeNotArchivable


async def _make_workspace(db_session, tmp_path: Path) -> uuid.UUID:
    from app.modules.workspace.model import Workspace

    ws_id = uuid.uuid4()
    ws = Workspace(
        id=ws_id,
        name="Test WS",
        slug=f"test-ws-{ws_id.hex[:8]}",
        root_path=str(tmp_path),
        status="active",
    )
    db_session.add(ws)
    await db_session.commit()
    return ws_id


async def _make_change(
    db_session, ws_id: uuid.UUID, status: str = "done",
) -> tuple[uuid.UUID, str]:
    from app.modules.change.model import Change

    change_id = uuid.uuid4()
    change_key = f"change-{change_id.hex[:8]}"
    change = Change(
        id=change_id,
        workspace_id=ws_id,
        change_key=change_key,
        title="Test Change",
        status=status,
        location="active",
        path=f".sillyspec/changes/{change_key}",
    )
    db_session.add(change)
    await db_session.commit()
    return change_id, change_key


async def test_archive_change_success(db_session, tmp_path):
    ws_id = await _make_workspace(db_session, tmp_path)
    change_id, change_key = await _make_change(db_session, ws_id, status="done")

    # v4 layout: .sillyspec/changes/<change_key>/MASTER.md
    change_dir = tmp_path / ".sillyspec" / "changes" / change_key
    change_dir.mkdir(parents=True)
    (change_dir / "MASTER.md").write_text("# Change", encoding="utf-8")

    svc = ArchiveService(db_session)
    archived = await svc.archive_change(ws_id, change_id)
    assert archived.status == "archived"
    assert archived.archived_at is not None
    assert archived.location == "archive"

    # v4 archive: .sillyspec/changes/archive/<change_key>/
    archive_dir = tmp_path / ".sillyspec" / "changes" / "archive" / change_key
    assert archive_dir.exists()
    assert (archive_dir / "MASTER.md").exists()


async def test_archive_change_not_done(db_session, tmp_path):
    ws_id = await _make_workspace(db_session, tmp_path)
    change_id, _ = await _make_change(db_session, ws_id, status="in_progress")

    svc = ArchiveService(db_session)
    with pytest.raises(ChangeNotArchivable):
        await svc.archive_change(ws_id, change_id)


async def test_archive_change_not_found(db_session, tmp_path):
    ws_id = await _make_workspace(db_session, tmp_path)
    svc = ArchiveService(db_session)
    with pytest.raises(Exception, match="not found"):
        await svc.archive_change(ws_id, uuid.uuid4())


async def test_distill_knowledge(db_session, tmp_path):
    ws_id = await _make_workspace(db_session, tmp_path)
    change_id, change_key = await _make_change(db_session, ws_id, status="done")

    from app.modules.change.model import ChangeDocument

    doc = ChangeDocument(
        id=uuid.uuid4(),
        change_id=change_id,
        doc_type="proposal",
        path=f".sillyspec/changes/{change_key}/proposal.md",
        exists=True,
    )
    db_session.add(doc)
    await db_session.commit()

    doc_path = tmp_path / ".sillyspec" / "changes" / change_key / "proposal.md"
    doc_path.parent.mkdir(parents=True, exist_ok=True)
    doc_path.write_text("# Proposal\nThis is a test proposal.", encoding="utf-8")

    svc = ArchiveService(db_session)
    summary = await svc.distill_knowledge(ws_id, change_id)
    assert summary["change_key"].startswith("change-")
    assert len(summary["documents"]) == 1
    assert summary["documents"][0]["type"] == "proposal"

    knowledge_file = tmp_path / ".sillyspec" / "knowledge" / f"{change_key}.md"
    assert knowledge_file.exists()


async def test_distill_knowledge_render_md():
    summary = {
        "change_key": "change-001",
        "title": "Test Change",
        "status": "done",
        "change_type": "feature",
        "affected_components": ["backend"],
        "documents": [
            {"type": "proposal", "path": "proposal.md", "content_preview": "Hello"},
        ],
        "distilled_at": "2026-01-01T00:00:00",
    }
    md = ArchiveService._render_knowledge_md(summary)
    assert "# Test Change" in md
    assert "change-001" in md
    assert "### proposal" in md
    assert "Hello" in md
