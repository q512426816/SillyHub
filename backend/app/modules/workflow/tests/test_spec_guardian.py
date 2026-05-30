"""Tests for Spec Guardian — pre-transition validation rules."""

from __future__ import annotations

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.auth.model import User
from app.modules.change.model import Change, ChangeDocument
from app.modules.workflow.model import ChangeReview
from app.modules.workflow.spec_guardian import run_guard
from app.modules.workspace.model import Workspace


async def _ensure_workspace(session: AsyncSession) -> Workspace:
    """Create or get a test workspace (idempotent)."""
    ws_id = uuid.UUID("11111111-1111-1111-1111-111111111111")
    existing = await session.get(Workspace, ws_id)
    if existing is not None:
        return existing
    ws = Workspace(
        id=ws_id,
        name="Test Workspace",
        slug="test-workspace",
        root_path="/tmp/test",
        status="active",
    )
    session.add(ws)
    await session.flush()
    return ws


async def _ensure_user(session: AsyncSession) -> User:
    """Create or get a test user for reviewer FK (idempotent)."""
    user_id = uuid.UUID("22222222-2222-2222-2222-222222222222")
    existing = await session.get(User, user_id)
    if existing is not None:
        return existing
    user = User(
        id=user_id,
        email="reviewer@test.com",
        password_hash="$2b$12$fakehash",
        display_name="Reviewer",
        status="active",
    )
    session.add(user)
    await session.flush()
    return user


async def _make_change(session: AsyncSession, status: str = "draft") -> Change:
    ws = await _ensure_workspace(session)
    change = Change(
        id=uuid.uuid4(),
        workspace_id=ws.id,
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


async def _add_doc(
    session: AsyncSession,
    change_id: uuid.UUID,
    doc_type: str,
    *,
    word_count: int | None = None,
) -> None:
    doc = ChangeDocument(
        id=uuid.uuid4(),
        change_id=change_id,
        doc_type=doc_type,
        path=f"test/{doc_type}.md",
        exists=True,
        word_count=word_count,
    )
    session.add(doc)
    await session.commit()


# ── Original tests ───────────────────────────────────────────────────────


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
    types = {v.split()[0] for v in violations}
    assert "Requirements" in types
    assert "Design" in types


async def test_reviewed_to_approved_passes_with_both_docs(
    db_session: AsyncSession,
) -> None:
    change = await _make_change(db_session, "reviewed")
    await _add_doc(db_session, change.id, "requirements", word_count=200)
    await _add_doc(db_session, change.id, "design", word_count=200)
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


# ── G4: word count >= 100 ────────────────────────────────────────────────


async def test_g4_word_count_below_100_blocked(db_session: AsyncSession) -> None:
    """Reviewed -> approved with doc < 100 words should be blocked."""
    change = await _make_change(db_session, "reviewed")
    await _add_doc(db_session, change.id, "requirements", word_count=50)
    await _add_doc(db_session, change.id, "design", word_count=200)
    violations = await run_guard(db_session, change, "approved")
    word_violations = [v for v in violations if "words" in v]
    assert len(word_violations) == 1
    assert "50" in word_violations[0]


async def test_g4_word_count_exactly_100_passes(db_session: AsyncSession) -> None:
    """Reviewed -> approved with doc == 100 words should pass."""
    change = await _make_change(db_session, "reviewed")
    await _add_doc(db_session, change.id, "requirements", word_count=100)
    await _add_doc(db_session, change.id, "design", word_count=100)
    violations = await run_guard(db_session, change, "approved")
    word_violations = [v for v in violations if "words" in v]
    assert word_violations == []


async def test_g4_word_count_none_treated_as_zero(db_session: AsyncSession) -> None:
    """Reviewed -> approved with word_count=None should be blocked (treated as 0)."""
    change = await _make_change(db_session, "reviewed")
    await _add_doc(db_session, change.id, "requirements", word_count=None)
    await _add_doc(db_session, change.id, "design", word_count=200)
    violations = await run_guard(db_session, change, "approved")
    word_violations = [v for v in violations if "words" in v]
    assert len(word_violations) == 1
    assert "0" in word_violations[0]


# ── G5: component existence ──────────────────────────────────────────────


async def test_g5_missing_component_blocked(db_session: AsyncSession) -> None:
    """Reviewed -> approved with non-existent component should be blocked."""
    change = await _make_change(db_session, "reviewed")
    change.affected_components = ["non-existent-component"]
    db_session.add(change)
    await db_session.commit()
    await _add_doc(db_session, change.id, "requirements", word_count=200)
    await _add_doc(db_session, change.id, "design", word_count=200)
    violations = await run_guard(db_session, change, "approved")
    comp_violations = [v for v in violations if "component" in v.lower()]
    assert len(comp_violations) == 1


async def test_g5_empty_components_passes(db_session: AsyncSession) -> None:
    """Reviewed -> approved with empty affected_components should pass."""
    change = await _make_change(db_session, "reviewed")
    change.affected_components = []
    db_session.add(change)
    await db_session.commit()
    await _add_doc(db_session, change.id, "requirements", word_count=200)
    await _add_doc(db_session, change.id, "design", word_count=200)
    violations = await run_guard(db_session, change, "approved")
    comp_violations = [v for v in violations if "component" in v.lower()]
    assert comp_violations == []


async def test_g5_existing_component_passes(db_session: AsyncSession) -> None:
    """Reviewed -> approved with existing component workspace should pass."""
    ws = await _ensure_workspace(db_session)
    ws.component_key = "backend"
    db_session.add(ws)
    await db_session.commit()

    change = await _make_change(db_session, "reviewed")
    change.affected_components = ["backend"]
    db_session.add(change)
    await db_session.commit()
    await _add_doc(db_session, change.id, "requirements", word_count=200)
    await _add_doc(db_session, change.id, "design", word_count=200)
    violations = await run_guard(db_session, change, "approved")
    comp_violations = [v for v in violations if "component" in v.lower()]
    assert comp_violations == []


# ── G7: unresolved reject review ─────────────────────────────────────────


async def test_g7_last_review_is_reject_blocked(db_session: AsyncSession) -> None:
    """Approved -> in_progress with last review = reject should be blocked."""
    change = await _make_change(db_session, "approved")
    await _add_doc(db_session, change.id, "plan")
    user = await _ensure_user(db_session)
    review = ChangeReview(
        id=uuid.uuid4(),
        change_id=change.id,
        reviewer_id=user.id,
        verdict="reject",
        comment="Not ready",
    )
    db_session.add(review)
    await db_session.commit()
    violations = await run_guard(db_session, change, "in_progress")
    reject_violations = [v for v in violations if "reject" in v.lower()]
    assert len(reject_violations) == 1


async def test_g7_no_reviews_passes(db_session: AsyncSession) -> None:
    """Approved -> in_progress with no reviews should pass."""
    change = await _make_change(db_session, "approved")
    await _add_doc(db_session, change.id, "plan")
    violations = await run_guard(db_session, change, "in_progress")
    reject_violations = [v for v in violations if "reject" in v.lower()]
    assert reject_violations == []


async def test_g7_reject_then_approve_passes(db_session: AsyncSession) -> None:
    """Approved -> in_progress with reject followed by approve should pass."""
    change = await _make_change(db_session, "approved")
    await _add_doc(db_session, change.id, "plan")
    user = await _ensure_user(db_session)
    reject = ChangeReview(
        id=uuid.uuid4(),
        change_id=change.id,
        reviewer_id=user.id,
        verdict="reject",
        comment="Not ready",
    )
    approve = ChangeReview(
        id=uuid.uuid4(),
        change_id=change.id,
        reviewer_id=user.id,
        verdict="approve",
        comment="LGTM now",
    )
    db_session.add(reject)
    db_session.add(approve)
    await db_session.commit()
    violations = await run_guard(db_session, change, "in_progress")
    reject_violations = [v for v in violations if "reject" in v.lower()]
    assert reject_violations == []
