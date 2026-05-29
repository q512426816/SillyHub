"""Tests for Spec Guardian — pre-transition validation rules."""

from __future__ import annotations

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.change.model import Change, ChangeDocument
from app.modules.workflow.spec_guardian import run_guard


async def _make_change(session: AsyncSession, status: str = "draft") -> Change:
    ws_id = uuid.UUID("11111111-1111-1111-1111-111111111111")
    change = Change(
        id=uuid.uuid4(),
        workspace_id=ws_id,
        change_key="test-change",
        title="Test",
        status=status,
        location="change",
        path="test",
    )
    session.add(change)
    await session.commit()
    await session.refresh(change)
    return change


async def _add_doc(session: AsyncSession, change_id: uuid.UUID, doc_type: str) -> None:
    doc = ChangeDocument(
        id=uuid.uuid4(),
        change_id=change_id,
        doc_type=doc_type,
        path=f"test/{doc_type}.md",
        exists=True,
    )
    session.add(doc)
    await session.commit()


async def test_draft_to_proposed_requires_master(db_session: AsyncSession) -> None:
    change = await _make_change(db_session, "draft")
    violations = await run_guard(db_session, change, "proposed")
    assert len(violations) == 1
    assert "MASTER" in violations[0]


async def test_draft_to_proposed_passes_with_master(db_session: AsyncSession) -> None:
    change = await _make_change(db_session, "draft")
    await _add_doc(db_session, change.id, "master")
    violations = await run_guard(db_session, change, "proposed")
    assert violations == []


async def test_proposed_to_reviewed_requires_proposal(db_session: AsyncSession) -> None:
    change = await _make_change(db_session, "proposed")
    violations = await run_guard(db_session, change, "reviewed")
    assert len(violations) == 1
    assert "Proposal" in violations[0]


async def test_proposed_to_reviewed_passes_with_proposal(db_session: AsyncSession) -> None:
    change = await _make_change(db_session, "proposed")
    await _add_doc(db_session, change.id, "proposal")
    violations = await run_guard(db_session, change, "reviewed")
    assert violations == []


async def test_reviewed_to_approved_requires_requirements_and_design(
    db_session: AsyncSession,
) -> None:
    change = await _make_change(db_session, "reviewed")
    violations = await run_guard(db_session, change, "approved")
    assert len(violations) == 2
    types = {v.split()[0] for v in violations}
    assert "Requirements" in types
    assert "Design" in types


async def test_reviewed_to_approved_passes_with_both_docs(
    db_session: AsyncSession,
) -> None:
    change = await _make_change(db_session, "reviewed")
    await _add_doc(db_session, change.id, "requirements")
    await _add_doc(db_session, change.id, "design")
    violations = await run_guard(db_session, change, "approved")
    assert violations == []


async def test_approved_to_in_progress_requires_plan(db_session: AsyncSession) -> None:
    change = await _make_change(db_session, "approved")
    violations = await run_guard(db_session, change, "in_progress")
    assert len(violations) == 1
    assert "Plan" in violations[0]


async def test_approved_to_in_progress_passes_with_plan(db_session: AsyncSession) -> None:
    change = await _make_change(db_session, "approved")
    await _add_doc(db_session, change.id, "plan")
    violations = await run_guard(db_session, change, "in_progress")
    assert violations == []


async def test_unregistered_transition_no_guard(db_session: AsyncSession) -> None:
    change = await _make_change(db_session, "rejected")
    violations = await run_guard(db_session, change, "draft")
    assert violations == []


async def test_completed_to_merged_no_guard(db_session: AsyncSession) -> None:
    change = await _make_change(db_session, "completed")
    violations = await run_guard(db_session, change, "merged")
    assert violations == []
