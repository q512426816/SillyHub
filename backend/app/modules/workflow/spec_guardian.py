"""Spec Guardian — pre-transition validation rules.

Checks whether a change is ready for the target state before allowing
a transition.  Each rule returns a list of violation messages (empty = pass).
"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import col

from app.modules.change.model import Change, ChangeDocument
from app.modules.workflow.model import ChangeReview


async def check_change_ready_for_proposed(
    session: AsyncSession,
    change: Change,
) -> list[str]:
    """Draft -> proposed: MASTER.md must exist."""
    violations: list[str] = []
    stmt = select(ChangeDocument).where(
        col(ChangeDocument.change_id) == change.id,
        col(ChangeDocument.doc_type) == "master",
        col(ChangeDocument.exists).is_(True),
    )
    doc = (await session.execute(stmt)).scalars().first()
    if doc is None:
        violations.append("MASTER.md document is missing.")
    return violations


async def check_change_ready_for_reviewed(
    session: AsyncSession,
    change: Change,
) -> list[str]:
    """Proposed -> reviewed: proposal must exist and be non-trivial."""
    violations: list[str] = []
    stmt = select(ChangeDocument).where(
        col(ChangeDocument.change_id) == change.id,
        col(ChangeDocument.doc_type) == "proposal",
        col(ChangeDocument.exists).is_(True),
    )
    doc = (await session.execute(stmt)).scalars().first()
    if doc is None:
        violations.append("Proposal document is missing.")
    return violations


# ── G4: document word count >= 100 ──────────────────────────────────────


async def _check_docs_non_trivial(
    session: AsyncSession,
    change: Change,
) -> list[str]:
    """G4: reviewed -> approved — all existing docs must have >= 100 words."""
    violations: list[str] = []
    stmt = select(ChangeDocument).where(
        col(ChangeDocument.change_id) == change.id,
        col(ChangeDocument.exists).is_(True),
    )
    docs = (await session.execute(stmt)).scalars().all()
    for doc in docs:
        wc = doc.word_count if doc.word_count is not None else 0
        if wc < 100:
            violations.append(f"Document '{doc.doc_type}' has only {wc} words (minimum 100).")
    return violations


# ── G5: component existence ─────────────────────────────────────────────


async def _check_components_exist(
    session: AsyncSession,
    change: Change,
) -> list[str]:
    """G5: reviewed -> approved — all affected_components must exist as active workspaces."""
    violations: list[str] = []
    if not change.affected_components:
        return violations

    from app.modules.workspace.model import Workspace

    for comp in change.affected_components:
        stmt = select(Workspace).where(
            col(Workspace.component_key) == comp,
            col(Workspace.deleted_at).is_(None),
        )
        ws = (await session.execute(stmt)).scalars().first()
        if ws is None:
            violations.append(f"Affected component '{comp}' does not exist as an active workspace.")
    return violations


async def check_change_ready_for_approved(
    session: AsyncSession,
    change: Change,
) -> list[str]:
    """Reviewed -> approved: requirements + design must exist + G4 + G5."""
    violations: list[str] = []
    for doc_type in ("requirements", "design"):
        stmt = select(ChangeDocument).where(
            col(ChangeDocument.change_id) == change.id,
            col(ChangeDocument.doc_type) == doc_type,
            col(ChangeDocument.exists).is_(True),
        )
        doc = (await session.execute(stmt)).scalars().first()
        if doc is None:
            violations.append(f"{doc_type.capitalize()} document is missing.")
    # G4: word count
    violations.extend(await _check_docs_non_trivial(session, change))
    # G5: component existence
    violations.extend(await _check_components_exist(session, change))
    return violations


# ── G7: unresolved reject review ────────────────────────────────────────


async def _check_no_unresolved_reject(
    session: AsyncSession,
    change: Change,
) -> list[str]:
    """G7: approved -> in_progress — no unresolved reject reviews."""
    violations: list[str] = []
    stmt = (
        select(ChangeReview)
        .where(col(ChangeReview.change_id) == change.id)
        .order_by(col(ChangeReview.created_at).desc(), col(ChangeReview.id).desc())
    )
    reviews = list((await session.execute(stmt)).scalars().all())

    if not reviews:
        return violations

    last_review = reviews[0]
    if last_review.verdict == "reject":
        violations.append(
            "Change has an unresolved reject review. Submit an approve review after rework."
        )
    return violations


async def check_change_ready_for_in_progress(
    session: AsyncSession,
    change: Change,
) -> list[str]:
    """Approved -> in_progress: plan must exist + G7."""
    violations: list[str] = []
    stmt = select(ChangeDocument).where(
        col(ChangeDocument.change_id) == change.id,
        col(ChangeDocument.doc_type) == "plan",
        col(ChangeDocument.exists).is_(True),
    )
    doc = (await session.execute(stmt)).scalars().first()
    if doc is None:
        violations.append("Plan document is missing.")
    # G7: no unresolved reject
    violations.extend(await _check_no_unresolved_reject(session, change))
    return violations


async def check_change_ready_for_completed(
    session: AsyncSession,
    change: Change,
) -> list[str]:
    """In progress -> completed: no hard requirement beyond the FSM."""
    return []


async def check_change_ready_for_merged(
    session: AsyncSession,
    change: Change,
) -> list[str]:
    """Completed -> merged: no hard requirement beyond the FSM."""
    return []


# Map (current_state, target_state) -> checker function.
# Only transitions that need pre-conditions are listed.
_GUARD_RULES: dict[tuple[str, str], object] = {
    ("draft", "proposed"): check_change_ready_for_proposed,
    ("proposed", "reviewed"): check_change_ready_for_reviewed,
    ("reviewed", "approved"): check_change_ready_for_approved,
    ("approved", "in_progress"): check_change_ready_for_in_progress,
    ("in_progress", "completed"): check_change_ready_for_completed,
    ("completed", "merged"): check_change_ready_for_merged,
}


async def run_guard(
    session: AsyncSession,
    change: Change,
    target: str,
) -> list[str]:
    """Run all guard rules for the given transition. Returns violations."""
    key = (change.status, target)
    checker = _GUARD_RULES.get(key)
    if checker is None:
        return []
    return await checker(session, change)
