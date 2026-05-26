"""Tests for change parser."""

from __future__ import annotations

import shutil
from pathlib import Path

import pytest

from app.modules.change.parser import (
    STANDARD_DOC_TYPES,
    ChangeParser,
)

FIXTURES = Path(__file__).parent / "fixtures" / "changes"


@pytest.fixture
def parser() -> ChangeParser:
    return ChangeParser()


@pytest.fixture
def silly_root(tmp_path: Path) -> Path:
    """Copy change fixtures into tmp with .sillyspec wrapper."""
    sillyspec = tmp_path / ".sillyspec"
    shutil.copytree(FIXTURES, sillyspec / "changes")
    return tmp_path


class TestParseWorkspace:
    def test_active_and_archive_detected(self, parser: ChangeParser, silly_root: Path) -> None:
        result = parser.parse_workspace(silly_root)
        keys = {c.change_key for c in result.changes}
        assert "2026-05-25-demo-feature" in keys
        assert "2026-05-21-demo-archived" in keys
        assert "2026-05-25-conflict-status" in keys

    def test_location_set_correctly(self, parser: ChangeParser, silly_root: Path) -> None:
        result = parser.parse_workspace(silly_root)
        by_key = {c.change_key: c for c in result.changes}
        assert by_key["2026-05-25-demo-feature"].location == "active"
        assert by_key["2026-05-21-demo-archived"].location == "archive"
        assert by_key["2026-05-25-conflict-status"].location == "active"

    def test_master_frontmatter_parsed(self, parser: ChangeParser, silly_root: Path) -> None:
        result = parser.parse_workspace(silly_root)
        demo = next(c for c in result.changes if c.change_key == "2026-05-25-demo-feature")
        assert demo.title == "Demo Feature Implementation"
        assert demo.status == "in_progress"
        assert demo.change_type == "feature"
        assert demo.owner == "admin"
        assert demo.affected_components == ["platform-api", "platform-web"]

    def test_missing_master_still_creates_change(
        self, parser: ChangeParser, silly_root: Path
    ) -> None:
        # Add a directory without MASTER.md
        no_master_dir = silly_root / ".sillyspec" / "changes" / "change" / "no-master"
        no_master_dir.mkdir(parents=True, exist_ok=True)
        result = parser.parse_workspace(silly_root)
        no_master = next(c for c in result.changes if c.change_key == "no-master")
        assert no_master.status == "unknown"
        assert no_master.title == "no-master"
        warning_codes = [w.code for w in no_master.warnings]
        assert "MASTER_MISSING" in warning_codes

    def test_standard_docs_detected(self, parser: ChangeParser, silly_root: Path) -> None:
        result = parser.parse_workspace(silly_root)
        demo = next(c for c in result.changes if c.change_key == "2026-05-25-demo-feature")
        doc_types = {d.doc_type for d in demo.docs}
        # Should have all 7 standard types
        assert STANDARD_DOC_TYPES.issubset(doc_types)

    def test_existing_vs_missing_docs(self, parser: ChangeParser, silly_root: Path) -> None:
        result = parser.parse_workspace(silly_root)
        demo = next(c for c in result.changes if c.change_key == "2026-05-25-demo-feature")
        existing = {d.doc_type for d in demo.docs if d.exists}
        missing = {d.doc_type for d in demo.docs if not d.exists}
        assert "MASTER" in existing
        assert "proposal" in existing
        assert "requirements" in existing
        assert "design" in existing
        assert "plan" in missing
        assert "tasks" in missing
        assert "verification" in missing

    def test_prototypes_detected(self, parser: ChangeParser, silly_root: Path) -> None:
        change_dir = silly_root / ".sillyspec" / "changes" / "change" / "2026-05-25-demo-feature"
        (change_dir / "prototype-search.html").write_text("<html></html>", encoding="utf-8")
        result = parser.parse_workspace(silly_root)
        demo = next(c for c in result.changes if c.change_key == "2026-05-25-demo-feature")
        prototypes = [d for d in demo.docs if d.doc_type == "prototype"]
        assert len(prototypes) == 1
        assert prototypes[0].filename == "prototype-search.html"
        assert prototypes[0].exists is True

    def test_references_detected(self, parser: ChangeParser, silly_root: Path) -> None:
        ref_dir = (
            silly_root
            / ".sillyspec"
            / "changes"
            / "change"
            / "2026-05-25-demo-feature"
            / "references"
        )
        ref_dir.mkdir(parents=True, exist_ok=True)
        (ref_dir / "01-api-spec.md").write_text("# API Spec", encoding="utf-8")
        result = parser.parse_workspace(silly_root)
        demo = next(c for c in result.changes if c.change_key == "2026-05-25-demo-feature")
        refs = [d for d in demo.docs if d.doc_type == "reference"]
        assert len(refs) == 1
        assert refs[0].filename == "01-api-spec.md"

    def test_missing_changes_dir(self, parser: ChangeParser, tmp_path: Path) -> None:
        result = parser.parse_workspace(tmp_path)
        assert len(result.changes) == 0
        warning_codes = [w.code for w in result.warnings]
        assert "CHANGES_DIR_MISSING" in warning_codes

    def test_path_traversal_guard(self, parser: ChangeParser, silly_root: Path) -> None:
        result = parser.parse_workspace(silly_root)
        for c in result.changes:
            assert ".." not in c.path
            for d in c.docs:
                assert ".." not in d.path

    def test_change_key_from_directory_name(
        self, parser: ChangeParser, silly_root: Path
    ) -> None:
        result = parser.parse_workspace(silly_root)
        assert all(c.change_key for c in result.changes)
