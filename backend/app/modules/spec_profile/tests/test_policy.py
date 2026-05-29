"""Tests for StagePolicy and DocumentPolicy — spec conflict detection (stub phase)."""

from __future__ import annotations

from app.modules.spec_profile.policy import ConflictDetail, DocumentPolicy, StagePolicy


async def test_stage_policy_returns_empty_conflicts() -> None:
    """StagePolicy.check_stage_conflict is a stub and returns an empty list."""
    policy = StagePolicy()
    platform_stages = [
        {"name": "proposal", "gates": ["require_proposal_doc"]},
        {"name": "design", "gates": ["require_design_doc"]},
    ]
    spec_stages = [
        {"name": "proposal", "gates": ["require_proposal_doc"]},
    ]
    conflicts = await policy.check_stage_conflict(platform_stages, spec_stages)
    assert conflicts == []


async def test_stage_policy_returns_empty_for_empty_inputs() -> None:
    """StagePolicy handles empty stage lists without error."""
    policy = StagePolicy()
    conflicts = await policy.check_stage_conflict([], [])
    assert conflicts == []


async def test_document_policy_returns_empty_conflicts() -> None:
    """DocumentPolicy.check_document_conflict is a stub and returns an empty list."""
    policy = DocumentPolicy()
    platform_docs = [
        {"name": "proposal", "schema": {"type": "object"}},
        {"name": "design", "schema": {"type": "object"}},
    ]
    spec_docs = [
        {"name": "proposal", "schema": {"type": "object"}},
    ]
    conflicts = await policy.check_document_conflict(platform_docs, spec_docs)
    assert conflicts == []


async def test_document_policy_returns_empty_for_empty_inputs() -> None:
    """DocumentPolicy handles empty document lists without error."""
    policy = DocumentPolicy()
    conflicts = await policy.check_document_conflict([], [])
    assert conflicts == []


def test_conflict_detail_dataclass() -> None:
    """ConflictDetail can be constructed with expected fields."""
    detail = ConflictDetail(
        conflict_type="gate",
        stage="proposal",
        message="Missing gate",
        platform_requirement={"gate": "require_proposal_doc"},
        spec_requirement={},
    )
    assert detail.conflict_type == "gate"
    assert detail.stage == "proposal"
    assert detail.message == "Missing gate"
    assert detail.platform_requirement == {"gate": "require_proposal_doc"}
    assert detail.spec_requirement == {}
