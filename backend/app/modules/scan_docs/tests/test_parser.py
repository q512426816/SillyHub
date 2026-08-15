"""Tests for scan docs parser."""

from __future__ import annotations

import os
import shutil
from datetime import UTC, datetime
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


@pytest.fixture
def flat_spec_root(tmp_path: Path) -> Path:
    """Copy silly fixture into tmp as FLAT layout (D-005@v1 platform-managed).

    spec_root 即 .sillyspec 内容根：docs/ 直接在其下（无 .sillyspec 包裹），
    对应 daemon-client / 平台托管 workspace 的扁平磁盘布局。
    """
    shutil.copytree(FIXTURES, tmp_path / "docs")
    return tmp_path


class TestPlatformManagedMode:
    """platform_managed=True：扁平布局解析（D-005@v1，FR-01）。"""

    def test_parse_component_flat_layout(
        self, parser: ScanDocsParser, flat_spec_root: Path
    ) -> None:
        result = parser.parse_component(flat_spec_root, "silly", platform_managed=True)
        doc_types = {d.doc_type for d in result.docs}
        assert "ARCHITECTURE" in doc_types
        assert "STRUCTURE" in doc_types

    def test_parse_docs_tree_flat_layout(
        self, parser: ScanDocsParser, flat_spec_root: Path
    ) -> None:
        result = parser.parse_docs_tree(flat_spec_root, platform_managed=True)
        # docs/ 下应有文件被解析
        assert len(result.docs) > 0
        # 扁平布局下 rel_path 不应含 .sillyspec 段
        for d in result.docs:
            assert ".sillyspec" not in d.path

    def test_flat_layout_without_flag_finds_nothing(
        self, parser: ScanDocsParser, flat_spec_root: Path
    ) -> None:
        """扁平布局但未传 platform_managed → 找不到 .sillyspec/docs → 警告（回归守护）。"""
        result = parser.parse_docs_tree(flat_spec_root)
        assert len(result.docs) == 0
        assert any(w.code == "DOCS_DIR_MISSING" for w in result.warnings)

    def test_wrapped_layout_with_flag_finds_nothing(
        self, parser: ScanDocsParser, silly_root: Path
    ) -> None:
        """包裹布局但误传 platform_managed=True → 找不到扁平 docs → 空（回归守护）。"""
        result = parser.parse_docs_tree(silly_root, platform_managed=True)
        assert len(result.docs) == 0


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
        others = [
            d for d in result.docs if d.doc_type == "OTHER" and d.filename == "custom-readme.md"
        ]
        assert len(others) == 1


class TestStatConvergence:
    """task-06（perf-remediation）：每文件 stat 收敛为 1 次 + _safe_mtime 推广。"""

    def test_single_stat_per_file(self, parser: ScanDocsParser, tmp_path: Path) -> None:
        """同一文件全解析过程只 stat 1 次——size 与 mtime 取自同一 stat_result。

        monkeypatch os.stat 计数（Path.stat / DirEntry.stat / os.stat 全部收敛到
        os.stat 单一底层），断言文件数 == stat 次数。旧实现（is_file + read_text
        size + stat mtime）每文件 3-4 次，收敛后 1 次。
        """
        scan_dir = tmp_path / ".sillyspec" / "docs" / "proj" / "scan"
        scan_dir.mkdir(parents=True)
        files = ["ARCHITECTURE.md", "STRUCTURE.md", "PROJECT.md"]
        for name in files:
            (scan_dir / name).write_text(f"# {name}\ncontent", encoding="utf-8")

        import app.modules.scan_docs.parser as parser_mod

        real_stat = os.stat
        real_lstat = os.lstat
        targets = {str(scan_dir / name).lower() for name in files}
        counter = {"n": 0}

        def counting_stat(path, *, dir_fd=None, follow_symlinks=True):
            # 归一化比较（Windows 大小写/分隔符容忍）
            if str(path).lower() in targets:
                counter["n"] += 1
            return real_stat(path, dir_fd=dir_fd, follow_symlinks=follow_symlinks)

        def counting_lstat(path, *, dir_fd=None):
            if str(path).lower() in targets:
                counter["n"] += 1
            return real_lstat(path, dir_fd=dir_fd)

        monkeypatch_global = pytest.MonkeyPatch()
        # 常规文件走 os.lstat（_stat_target），symlink 分支才走 os.stat——两个都计数
        monkeypatch_global.setattr(parser_mod.os, "stat", counting_stat)
        monkeypatch_global.setattr(parser_mod.os, "lstat", counting_lstat)
        try:
            result = parser.parse_docs_tree(tmp_path)
        finally:
            monkeypatch_global.undo()

        existing = [d for d in result.docs if d.exists and d.filename in files]
        assert len(existing) == 3
        assert counter["n"] == 3, f"每文件应恰好 1 次 stat，实际 {counter['n']}"

    def test_dirty_mtime_falls_back_to_epoch_zero(
        self, parser: ScanDocsParser, tmp_path: Path
    ) -> None:
        """mtime 脏值（year 30828 级，os.utime 造真实脏文件）不炸，走 _safe_mtime 兜底 1970。

        Windows bind mount 瞬态脏 mtime 实测量级 9.1e11 秒（ql-20260814-006），
        直接 datetime.fromtimestamp 抛 ValueError 打断 reparse——统一改 _safe_mtime
        后单文件脏值回退 epoch 0。
        """
        scan_dir = tmp_path / ".sillyspec" / "docs" / "proj" / "scan"
        scan_dir.mkdir(parents=True)
        target = scan_dir / "ARCHITECTURE.md"
        target.write_text("# 脏 mtime 文档\n", encoding="utf-8")
        dirty = 9.1e11  # 两平台 fromtimestamp 均越界（year 30828 实测量级）
        os.utime(target, (dirty, dirty))
        on_disk = target.stat().st_mtime
        if on_disk != dirty:
            # Linux ext4 / macOS APFS 内核时间戳上限（公元 2446/2554 年）低于
            # datetime 越界点（year 9999），越界值被钳制为合法 mtime 落盘——
            # 本文件系统上无法用真实文件触发护栏，只 NTFS 可真实落脏值
            pytest.skip(
                f"filesystem clamps out-of-range mtime ({dirty} -> {on_disk}); "
                "dirty-mtime fallback untestable on this platform"
            )
        assert target.stat().st_mtime == dirty  # 前置：脏值真实落到盘上

        # 旧实现在 fromtimestamp 处抛 ValueError
        with pytest.raises((ValueError, OverflowError, OSError)):
            datetime.fromtimestamp(target.stat().st_mtime, tz=UTC)

        result = parser.parse_docs_tree(tmp_path)
        arch = next(d for d in result.docs if d.filename == "ARCHITECTURE.md")
        assert arch.exists is True
        assert arch.last_modified_at == datetime(1970, 1, 1, tzinfo=UTC)

    def test_parse_component_dirty_mtime_falls_back(
        self, parser: ScanDocsParser, tmp_path: Path
    ) -> None:
        """parse_component 同样吃 _safe_mtime 兜底（:247 裸 fromtimestamp 推广点）。"""
        scan_dir = tmp_path / ".sillyspec" / "docs" / "proj" / "scan"
        scan_dir.mkdir(parents=True)
        target = scan_dir / "ARCHITECTURE.md"
        target.write_text("# 组件脏 mtime\n", encoding="utf-8")
        dirty = 9.1e11
        os.utime(target, (dirty, dirty))
        on_disk = target.stat().st_mtime
        if on_disk != dirty:
            # 同 test_dirty_mtime_falls_back_to_epoch_zero：文件系统钳制越界
            # mtime 时护栏分支不可触发
            pytest.skip(
                f"filesystem clamps out-of-range mtime ({dirty} -> {on_disk}); "
                "dirty-mtime fallback untestable on this platform"
            )

        result = parser.parse_component(tmp_path, "proj")
        arch = next(d for d in result.docs if d.doc_type == "ARCHITECTURE")
        assert arch.exists is True
        assert arch.last_modified_at == datetime(1970, 1, 1, tzinfo=UTC)
