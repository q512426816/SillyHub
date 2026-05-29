"""Spec Guardian — pre-transition validation rules.

Checks whether a change is ready for the target state before allowing
a transition.  Each rule returns a list of violation messages (empty = pass).
"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import col

from app.modules.change.model import Change, ChangeDocument


async def check_change_ready_for_proposed(
    session: AsyncSession, change: Change,
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
    session: AsyncSession, change: Change,
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


async def check_change_ready_for_approved(
    session: AsyncSession, change: Change,
) -> list[str]:
    """Reviewed -> approved: requirements + design must exist."""
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
    return violations


async def check_change_ready_for_in_progress(
    session: AsyncSession, change: Change,
) -> list[str]:
    """Approved -> in_progress: plan must exist."""
    violations: list[str] = []
    stmt = select(ChangeDocument).where(
        col(ChangeDocument.change_id) == change.id,
        col(ChangeDocument.doc_type) == "plan",
        col(ChangeDocument.exists).is_(True),
    )
    doc = (await session.execute(stmt)).scalars().first()
    if doc is None:
        violations.append("Plan document is missing.")
    return violations


async def check_change_ready_for_completed(
    session: AsyncSession, change: Change,
) -> list[str]:
    """In progress -> completed: no hard requirement beyond the FSM."""
    return []


async def check_change_ready_for_merged(
    session: AsyncSession, change: Change,
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
    return await checker(session, change)  # type: ignore[operator]
