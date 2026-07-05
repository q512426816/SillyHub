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

    def test_metadata_not_read_from_frontmatter(
        self, parser: ChangeParser, silly_root: Path
    ) -> None:
        # Parser no longer reads MASTER frontmatter. Title comes from proposal.md's
        # first heading; change_type/owner/affected_components are DB-owned and
        # left empty by the parser (file-lifecycle.md).
        result = parser.parse_workspace(silly_root)
        demo = next(c for c in result.changes if c.change_key == "2026-05-25-demo-feature")
        assert demo.title == "Proposal"  # from proposal.md "# Proposal"
        assert demo.status == "draft"
        assert demo.change_type == "feature"  # inferred by _infer_change_type
        assert demo.owner is None
        assert demo.affected_components == []

    def test_missing_master_still_creates_change(
        self, parser: ChangeParser, silly_root: Path
    ) -> None:
        # MASTER.md is optional (file-lifecycle.md §9): a change without it must
        # still parse, default to status "draft", and emit no MASTER_MISSING warning.
        no_master_dir = silly_root / ".sillyspec" / "changes" / "no-master"
        no_master_dir.mkdir(parents=True, exist_ok=True)
        result = parser.parse_workspace(silly_root)
        no_master = next(c for c in result.changes if c.change_key == "no-master")
        assert no_master.status == "draft"
        assert no_master.title == "no-master"
        warning_codes = [w.code for w in no_master.warnings]
        assert "MASTER_MISSING" not in warning_codes

    def test_title_extracted_from_proposal(self, parser: ChangeParser, silly_root: Path) -> None:
        # Title comes from the first '# ' heading in proposal.md, not frontmatter.
        change_dir = silly_root / ".sillyspec" / "changes" / "title-from-proposal"
        change_dir.mkdir(parents=True, exist_ok=True)
        (change_dir / "proposal.md").write_text(
            "author: qinyi\n\n# 用户登录超时修复\n\n## 动机\n...",
            encoding="utf-8",
        )
        result = parser.parse_workspace(silly_root)
        change = next(c for c in result.changes if c.change_key == "title-from-proposal")
        assert change.title == "用户登录超时修复"

    def test_module_impact_is_standard_doc(self, parser: ChangeParser, silly_root: Path) -> None:
        change_dir = silly_root / ".sillyspec" / "changes" / "with-impact"
        change_dir.mkdir(parents=True, exist_ok=True)
        (change_dir / "module-impact.md").write_text("# 模块影响分析", encoding="utf-8")
        result = parser.parse_workspace(silly_root)
        change = next(c for c in result.changes if c.change_key == "with-impact")
        impact = next(d for d in change.docs if d.doc_type == "module_impact")
        assert impact.exists is True
        assert impact.filename == "module-impact.md"

    def test_standard_docs_detected(self, parser: ChangeParser, silly_root: Path) -> None:
        result = parser.parse_workspace(silly_root)
        demo = next(c for c in result.changes if c.change_key == "2026-05-25-demo-feature")
        doc_types = {d.doc_type for d in demo.docs}
        # Should have all standard types
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
        assert "verify_result" in missing

    def test_prototypes_detected(self, parser: ChangeParser, silly_root: Path) -> None:
        change_dir = silly_root / ".sillyspec" / "changes" / "2026-05-25-demo-feature"
        (change_dir / "prototype-search.html").write_text("<html></html>", encoding="utf-8")
        result = parser.parse_workspace(silly_root)
        demo = next(c for c in result.changes if c.change_key == "2026-05-25-demo-feature")
        prototypes = [d for d in demo.docs if d.doc_type == "prototype"]
        assert len(prototypes) == 1
        assert prototypes[0].filename == "prototype-search.html"
        assert prototypes[0].exists is True

    def test_references_detected(self, parser: ChangeParser, silly_root: Path) -> None:
        ref_dir = silly_root / ".sillyspec" / "changes" / "2026-05-25-demo-feature" / "references"
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

    def test_path_traversal_guard(self, parser: ChangeParser, silly_root: Path) -> None:
        result = parser.parse_workspace(silly_root)
        for c in result.changes:
            assert ".." not in c.path
            for d in c.docs:
                assert ".." not in d.path

    def test_change_key_from_directory_name(self, parser: ChangeParser, silly_root: Path) -> None:
        result = parser.parse_workspace(silly_root)
        assert all(c.change_key for c in result.changes)

    def test_legacy_change_dir_with_warning(self, parser: ChangeParser, silly_root: Path) -> None:
        """Legacy changes/change/<key>/ directories are still scanned with warning."""
        legacy_dir = silly_root / ".sillyspec" / "changes" / "change" / "legacy-change"
        legacy_dir.mkdir(parents=True, exist_ok=True)
        (legacy_dir / "MASTER.md").write_text(
            "---\ntitle: Legacy Change\nstatus: draft\n---\n# Legacy",
            encoding="utf-8",
        )
        result = parser.parse_workspace(silly_root)
        legacy = next(c for c in result.changes if c.change_key == "legacy-change")
        assert legacy.location == "active"
        warning_codes = [w.code for w in result.warnings]
        assert "LEGACY_CHANGE_DIR" in warning_codes

    def test_archive_excluded_from_active_scan(
        self, parser: ChangeParser, silly_root: Path
    ) -> None:
        """The 'archive' directory itself should not appear as an active change."""
        result = parser.parse_workspace(silly_root)
        keys = {c.change_key for c in result.changes}
        assert "archive" not in keys

    def test_platform_managed_flat_path_no_sillyspec_prefix(
        self, parser: ChangeParser, tmp_path: Path
    ) -> None:
        """ql-20260706-004：扁平布局（platform_managed=True）change.path 不带 .sillyspec 前缀。

        daemon-client 平台镜像 spec_root 下 changes/docs 直接在根（无 .sillyspec 包裹），
        change.path 必须以 changes/ 开头，否则 _resolve_change_dir(spec_root/path) 拼
        出不存在路径、文件树全空（用户反馈"变更文件结构树不显示"根因）。
        """
        flat_root = tmp_path / "flat"
        shutil.copytree(FIXTURES, flat_root / "changes")
        result = parser.parse_workspace(flat_root, platform_managed=True)
        assert result.changes, "应解析到变更"
        for c in result.changes:
            assert not c.path.startswith(".sillyspec"), (
                f"扁平布局 path 不应带 .sillyspec 前缀: {c.path}"
            )
            assert c.path.startswith("changes/"), f"扁平布局 path 应以 changes/ 开头: {c.path}"

    def test_wrapped_path_keeps_sillyspec_prefix(
        self, parser: ChangeParser, silly_root: Path
    ) -> None:
        """ql-20260706-004：包裹布局（默认 platform_managed=False）保留 .sillyspec 前缀。

        对照用例——repo-native/server-local 的 <root>/.sillyspec/changes/ 包裹结构
        下 change.path 仍带 .sillyspec/ 前缀（确保 rel_wrap 改动不破坏包裹场景）。
        """
        result = parser.parse_workspace(silly_root)
        assert result.changes
        for c in result.changes:
            if c.path:
                assert c.path.startswith(".sillyspec/changes/"), (
                    f"包裹布局 path 应带 .sillyspec/changes/ 前缀: {c.path}"
                )
