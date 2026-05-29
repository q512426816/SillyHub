"""StagePolicy and DocumentPolicy -- spec conflict detection.

author: qinyi
created_at: 2026-05-27

These policy classes compare platform-level requirements against the active
SillySpec profile and produce conflict records. The current implementation
returns empty conflict lists (placeholder); real detection logic will be added
when the provider and service layers are fully wired up.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from app.core.logging import get_logger

log = get_logger(__name__)


@dataclass
class ConflictDetail:
    """Structured representation of a single conflict."""

    conflict_type: str  # gate / schema / path / validation
    stage: str
    message: str
    platform_requirement: dict[str, Any] = field(default_factory=dict)
    spec_requirement: dict[str, Any] = field(default_factory=dict)


class StagePolicy:
    """Detect conflicts between platform stage requirements and the spec profile.

    Platform stages (e.g. ``proposal``, ``design``, ``tasks``, ``plan``,
    ``execute``, ``verify``) must be compatible with the stages defined in the
    active spec profile. A conflict arises when:
    - A required platform stage is absent from the profile.
    - Stage gates or ordering differ in incompatible ways.
    """

    async def check_stage_conflict(
        self,
        platform_stages: list[dict[str, Any]],
        spec_stages: list[dict[str, Any]],
    ) -> list[ConflictDetail]:
        """Compare platform stage definitions against spec stage definitions.

        Returns a (possibly empty) list of conflicts.

        **Current status**: placeholder -- always returns an empty list.
        Real conflict detection will be implemented in a follow-up task.
        """
        log.info(
            "policy.check_stage_conflict",
            platform_count=len(platform_stages),
            spec_count=len(spec_stages),
        )
        conflicts: list[ConflictDetail] = []
        # TODO: implement stage conflict detection
        # - check for missing stages
        # - check gate compatibility
        # - check ordering constraints
        return conflicts


class DocumentPolicy:
    """Detect conflicts between platform document requirements and the spec profile.

    Platform documents (e.g. ``proposal.md``, ``design.md``, ``tasks.md``,
    ``plan.md``) must be compatible with the documents defined in the active
    spec profile. A conflict arises when:
    - A required document schema is absent from the profile.
    - Document path conventions are incompatible.
    - Validation rules differ.
    """

    async def check_document_conflict(
        self,
        platform_documents: list[dict[str, Any]],
        spec_documents: list[dict[str, Any]],
    ) -> list[ConflictDetail]:
        """Compare platform document definitions against spec document definitions.

        Returns a (possibly empty) list of conflicts.

        **Current status**: placeholder -- always returns an empty list.
        Real conflict detection will be implemented in a follow-up task.
        """
        log.info(
            "policy.check_document_conflict",
            platform_count=len(platform_documents),
            spec_count=len(spec_documents),
        )
        conflicts: list[ConflictDetail] = []
        # TODO: implement document conflict detection
        # - check for missing document schemas
        # - check path conventions
        # - check validation rules
        return conflicts
