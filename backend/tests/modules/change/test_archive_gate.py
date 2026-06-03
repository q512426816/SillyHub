"""Tests for ChangeService.check_archive_gate documents_complete check (task-01).

Covers the task-01 rewrite of the ``documents_complete`` gate item: it now
判定四件套 {proposal, design, requirements, tasks} 的 ``doc_type`` 是否都
``exists=True``，缺件 ``passed=False`` 且 ``detail`` 列出缺失文档名，且不再依赖
``ChangeDocument.status``。

To isolate ``documents_complete``, every Change row is constructed in the
``accepted`` stage with the other 5 gate items pre-satisfied so a passing
``documents_complete`` yields ``can_archive=True``.
"""

from __future__ import annotations

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.change.model import Change, ChangeDocument
from app.modules.change.service import ChangeService
from app.modules.workspace.model import Workspace

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _make_workspace(session: AsyncSession) -> uuid.UUID:
    """Create a minimal Workspace row and return its id (unique name/slug)."""
    ws = Workspace(
        id=uuid.uuid4(),
        name=f"test-ws-{uuid.uuid4().hex[:6]}",
        slug=f"test-ws-{uuid.uuid4().hex[:6]}",
        root_path="/tmp/test-workspace",
        status="active",
    )
    session.add(ws)
    await session.commit()
    return ws.id


async def _make_accepted_change(session: AsyncSession, ws_id: uuid.UUID) -> Change:
    """Create a Change in 'accepted' stage with the other 5 gate items ready.

    This lets check_archive_gate proceed past the accepted short-circuit and
    pass checks 1-5, so documents_complete is the only deciding factor.
    """
    change = Change(
        id=uuid.uuid4(),
        workspace_id=ws_id,
        change_key=f"test-{uuid.uuid4().hex[:8]}",
        title="Test change for archive gate",
        status="draft",
        location="active",
        path="/tmp/test",
        current_stage="accepted",
        feedback_category=None,
        stages={
            "ac_confirmed": True,
            "tech_verification_passed": True,
            "business_review_passed": True,
            "feedback_history": [],
        },
    )
    session.add(change)
    await session.commit()
    await session.refresh(change)
    return change


async def _add_doc(
    session: AsyncSession,
    change_id: uuid.UUID,
    doc_type: str,
    *,
    exists: bool = True,
) -> None:
    """Add a ChangeDocument row. status is left None (regression guard)."""
    doc = ChangeDocument(
        change_id=change_id,
        doc_type=doc_type,
        path=f"/tmp/test/{doc_type}.md",
        exists=exists,
        status=None,
    )
    session.add(doc)
    await session.commit()


def _doc_check(resp):
    """Extract the documents_complete check item by name (not index)."""
    return next(c for c in resp.checks if c.name == "documents_complete")


# ===================================================================
# Test cases
# ===================================================================


async def test_documents_complete_passes_when_all_four_present(
    db_session: AsyncSession,
) -> None:
    """四件套齐全 → documents_complete.passed=True, detail=="", can_archive=True."""
    ws_id = await _make_workspace(db_session)
    change = await _make_accepted_change(db_session, ws_id)
    for doc_type in ("proposal", "design", "requirements", "tasks"):
        await _add_doc(db_session, change.id, doc_type)

    svc = ChangeService(db_session)
    resp = await svc.check_archive_gate(ws_id, change.id)

    item = _doc_check(resp)
    assert item.passed is True
    assert item.detail == ""
    assert resp.can_archive is True


async def test_documents_complete_fails_when_design_missing(
    db_session: AsyncSession,
) -> None:
    """缺 design → passed=False, detail 含 'design', can_archive=False."""
    ws_id = await _make_workspace(db_session)
    change = await _make_accepted_change(db_session, ws_id)
    for doc_type in ("proposal", "requirements", "tasks"):
        await _add_doc(db_session, change.id, doc_type)

    svc = ChangeService(db_session)
    resp = await svc.check_archive_gate(ws_id, change.id)

    item = _doc_check(resp)
    assert item.passed is False
    assert "design" in item.detail
    assert resp.can_archive is False


async def test_documents_complete_detail_lists_all_missing(
    db_session: AsyncSession,
) -> None:
    """同时缺 requirements 与 tasks → detail 同时含两者（子串，不绑顺序）。"""
    ws_id = await _make_workspace(db_session)
    change = await _make_accepted_change(db_session, ws_id)
    for doc_type in ("proposal", "design"):
        await _add_doc(db_session, change.id, doc_type)

    svc = ChangeService(db_session)
    resp = await svc.check_archive_gate(ws_id, change.id)

    item = _doc_check(resp)
    assert item.passed is False
    assert "requirements" in item.detail
    assert "tasks" in item.detail


async def test_documents_complete_ignores_optional_docs(
    db_session: AsyncSession,
) -> None:
    """四件套齐全(status=None)+缺可选文档 → passed=True（可选文档不计入分母）。"""
    ws_id = await _make_workspace(db_session)
    change = await _make_accepted_change(db_session, ws_id)
    # 四件套齐全，status 全留 None（回归保护：不再依赖 status）
    for doc_type in ("proposal", "design", "requirements", "tasks"):
        await _add_doc(db_session, change.id, doc_type)
    # 一个 exists=False 的可选文档不应影响判定
    await _add_doc(db_session, change.id, "plan", exists=False)

    svc = ChangeService(db_session)
    resp = await svc.check_archive_gate(ws_id, change.id)

    item = _doc_check(resp)
    assert item.passed is True
    assert item.detail == ""
    assert resp.can_archive is True
