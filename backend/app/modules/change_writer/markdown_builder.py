"""Markdown template builder for change documents.

Generates standard SillySpec change document content from parameters.
"""

from __future__ import annotations

from datetime import datetime


def build_master_md(
    *,
    title: str,
    change_type: str | None = None,
    affected_components: list[str] | None = None,
    status: str = "draft",
) -> str:
    lines = [
        f"# {title}",
        "",
        f"- **Status**: {status}",
    ]
    if change_type:
        lines.append(f"- **Type**: {change_type}")
    if affected_components:
        lines.append(f"- **Affected Components**: {', '.join(affected_components)}")
    lines.extend(
        [
            f"- **Created**: {datetime.utcnow().isoformat()}",
            "",
            "## Summary",
            "",
            "<!-- Describe the change summary here -->",
            "",
        ]
    )
    return "\n".join(lines)


def build_proposal_md(*, title: str) -> str:
    return "\n".join(
        [
            f"# Proposal: {title}",
            "",
            "## Background",
            "",
            "<!-- Why is this change needed? -->",
            "",
            "## Proposal",
            "",
            "<!-- What will be done? -->",
            "",
            "## Alternatives Considered",
            "",
            "<!-- What other approaches were considered? -->",
            "",
        ]
    )


def build_requirements_md(*, title: str) -> str:
    return "\n".join(
        [
            f"# Requirements: {title}",
            "",
            "## Functional Requirements",
            "",
            "<!-- List functional requirements -->",
            "",
            "## Non-Functional Requirements",
            "",
            "<!-- Performance, security, etc. -->",
            "",
            "## Acceptance Criteria",
            "",
            "<!-- How do we verify this is complete? -->",
            "",
        ]
    )


def build_design_md(*, title: str) -> str:
    return "\n".join(
        [
            f"# Design: {title}",
            "",
            "## Architecture",
            "",
            "<!-- How will this be implemented? -->",
            "",
            "## Data Model Changes",
            "",
            "<!-- Any DB/API changes -->",
            "",
            "## API Changes",
            "",
            "<!-- New/modified endpoints -->",
            "",
        ]
    )


def build_plan_md(*, title: str) -> str:
    return "\n".join(
        [
            f"# Plan: {title}",
            "",
            "## Tasks",
            "",
            "<!-- Ordered list of implementation tasks -->",
            "",
        ]
    )


DOCUMENT_BUILDERS: dict[str, callable] = {
    "proposal": build_proposal_md,
    "requirements": build_requirements_md,
    "design": build_design_md,
    "plan": build_plan_md,
}
