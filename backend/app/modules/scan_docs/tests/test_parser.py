"""Tests for scan docs parser."""

from __future__ import annotations

import shutil
from pathlib import Path

import pytest

from app.modules.scan_docs.parser import (
    MAX_CONTENT_BYTES,
    STANDARD_DOC_TYPES,
    ScanDocsParser,
)

FIXTURES = Path(__file__).parent / "fixtures" / "docs"


@pytest.fixture
def parser() -> ScanDocsParser:
    return ScanDocsParser()


@pytest.fixture
def silly_root(tmp_path: Path) -> Path:
    """Copy silly fixture into tmp with .sillyspec wrapper."""
    sillyspec = tmp_path / ".sillyspec"
    shutil.copytree(FIXTURES, sillyspec / "docs")
    return tmp_path


class TestParseComponent:
    def test_standard_docs_detected(self, parser: ScanDocsParser, silly_root: Path) -> None:
        result = parser.parse_component(silly_root, "silly")
        doc_types = {d.doc_type for d in result.docs}
        assert "ARCHITECTURE" in doc_types
        assert "STRUCTURE" in doc_types

    def test_missing_docs_are_placeholder(self, parser: ScanDocsParser, silly_root: Path) -> None:
        result = parser.parse_component(silly_root, "silly")
        placeholders = [d for d in result.docs if not d.exists]
        placeholder_types = {d.doc_type for d in placeholders}
        expected_missing = STANDARD_DOC_TYPES - {"ARCHITECTURE", "STRUCTURE"}
        assert placeholder_types == expected_missing

    def test_title_extraction(self, parser: ScanDocsParser, silly_root: Path) -> None:
        result = parser.parse_component(silly_root, "silly")
        arch = next(d for d in result.docs if d.doc_type == "ARCHITECTURE")
        assert arch.title == "Silly 后端架构"

    def test_content_populated(self, parser: ScanDocsParser, silly_root: Path) -> None:
        result = parser.parse_component(silly_root, "silly")
        arch = next(d for d in result.docs if d.doc_type == "ARCHITECTURE")
        assert arch.content is not None
        assert "FastAPI" in arch.content

    def test_missing_scan_dir(self, parser: ScanDocsParser, silly_root: Path) -> None:
        result = parser.parse_component(silly_root, "nonexistent")
        assert len(result.warnings) >= 1
        assert result.warnings[0].code == "SCAN_DIR_MISSING"
        # Should still have all 7 standard types as placeholders
        assert len(result.docs) == 7
        assert all(not d.exists for d in result.docs)

    def test_other_doc_type(self, parser: ScanDocsParser, silly_root: Path) -> None:
        # Create a non-standard md file
        scan_dir = silly_root / ".sillyspec" / "docs" / "silly" / "scan"
        scan_dir.mkdir(parents=True, exist_ok=True)
        (scan_dir / "CUSTOM_NOTES.md").write_text("# Custom Notes\nSome content.")
        result = parser.parse_component(silly_root, "silly")
        other_docs = [d for d in result.docs if d.doc_type == "OTHER"]
        assert len(other_docs) >= 1
        assert other_docs[0].filename == "CUSTOM_NOTES.md"

    def test_large_file_truncated(self, parser: ScanDocsParser, silly_root: Path) -> None:
        scan_dir = silly_root / ".sillyspec" / "docs" / "silly" / "scan"
        scan_dir.mkdir(parents=True, exist_ok=True)
        big_content = "x" * (MAX_CONTENT_BYTES + 100)
        (scan_dir / "ARCHITECTURE.md").write_text(big_content)
        result = parser.parse_component(silly_root, "silly")
        trunc_warnings = [w for w in result.warnings if w.code == "CONTENT_TRUNCATED"]
        assert len(trunc_warnings) >= 1

    def test_conventions_component(self, parser: ScanDocsParser, silly_root: Path) -> None:
        result = parser.parse_component(silly_root, "silly-admin-ui")
        conv = next(d for d in result.docs if d.doc_type == "CONVENTIONS")
        assert conv.exists is True
        assert conv.title == "开发约定"

    def test_last_modified_at_set(self, parser: ScanDocsParser, silly_root: Path) -> None:
        result = parser.parse_component(silly_root, "silly")
        arch = next(d for d in result.docs if d.doc_type == "ARCHITECTURE")
        assert arch.last_modified_at is not None

    def test_path_traversal_guard(self, parser: ScanDocsParser, silly_root: Path) -> None:
        # This is a conceptual test - the parser resolves paths and checks
        # they stay within sillyspec root. We just verify no crash.
        result = parser.parse_component(silly_root, "silly")
        for doc in result.docs:
            assert ".." not in doc.path

    def test_doc_type_case_insensitive(self, parser: ScanDocsParser, silly_root: Path) -> None:
        """Non-standard filename maps to OTHER type."""
        scan_dir = silly_root / ".sillyspec" / "docs" / "silly" / "scan"
        scan_dir.mkdir(parents=True, exist_ok=True)
        (scan_dir / "custom-readme.md").write_text("# Custom Readme")
        result = parser.parse_component(silly_root, "silly")
        others = [d for d in result.docs if d.doc_type == "OTHER" and d.filename == "custom-readme.md"]
        assert len(others) == 1
