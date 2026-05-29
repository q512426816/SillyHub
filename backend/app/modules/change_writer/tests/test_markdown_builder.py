"""Tests for markdown_builder — template generation."""

from __future__ import annotations

from app.modules.change_writer.markdown_builder import (
    DOCUMENT_BUILDERS,
    build_design_md,
    build_master_md,
    build_plan_md,
    build_proposal_md,
    build_requirements_md,
)


def test_master_md_basic() -> None:
    result = build_master_md(title="Add auth")
    assert "# Add auth" in result
    assert "**Status**: draft" in result
    assert "**Created**:" in result


def test_master_md_with_all_fields() -> None:
    result = build_master_md(
        title="Refactor API",
        change_type="refactor",
        affected_components=["backend", "frontend"],
        status="proposed",
    )
    assert "**Type**: refactor" in result
    assert "backend, frontend" in result
    assert "**Status**: proposed" in result


def test_proposal_md() -> None:
    result = build_proposal_md(title="Feature X")
    assert "# Proposal: Feature X" in result
    assert "## Background" in result
    assert "## Proposal" in result
    assert "## Alternatives Considered" in result


def test_requirements_md() -> None:
    result = build_requirements_md(title="Feature Y")
    assert "# Requirements: Feature Y" in result
    assert "## Functional Requirements" in result
    assert "## Acceptance Criteria" in result


def test_design_md() -> None:
    result = build_design_md(title="Feature Z")
    assert "# Design: Feature Z" in result
    assert "## Architecture" in result


def test_plan_md() -> None:
    result = build_plan_md(title="Feature W")
    assert "# Plan: Feature W" in result
    assert "## Tasks" in result


def test_all_doc_types_have_builders() -> None:
    for dt in ("proposal", "requirements", "design", "plan"):
        assert dt in DOCUMENT_BUILDERS
