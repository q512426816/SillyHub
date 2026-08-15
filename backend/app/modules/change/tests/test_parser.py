"""Tests for change parser."""

from __future__ import annotations

import shutil
from pathlib import Path

import pytest

import app.modules.change.parser as parser_mod
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

    def test_last_modified_at_is_max_mtime_across_dir(
        self, parser: ChangeParser, tmp_path: Path
    ) -> None:
        """ql-20260813-008 / ql-20260814-002：变更级 mtime = 目录所有非隐藏文件 mtime 最大值。

        含子目录文件（tasks/*.md）与非标准文件（decisions.md）——这两类不进 parsed.docs，
        但必须计入 last_modified_at（rglob→os.scandir 改造后语义不变）。用 os.utime 钉死
        各文件 mtime，断言取到最大的那个（非标准、子目录里的）。
        """
        import os
        from datetime import UTC, datetime

        change_dir = tmp_path / "changes" / "mtime-demo"
        (change_dir / "tasks").mkdir(parents=True)
        # 标准文件（旧）
        (change_dir / "proposal.md").write_text("# Demo", encoding="utf-8")
        os.utime(change_dir / "proposal.md", (1_700_000_000, 1_700_000_000))
        # 子目录非标准文件（最新——必须被算进 max）
        (change_dir / "tasks" / "task-01.md").write_text("- [ ] t1", encoding="utf-8")
        os.utime(change_dir / "tasks" / "task-01.md", (1_800_000_000, 1_800_000_000))
        # 根级非标准文件（中间）
        (change_dir / "decisions.md").write_text("# Dec", encoding="utf-8")
        os.utime(change_dir / "decisions.md", (1_750_000_000, 1_750_000_000))

        result = parser.parse_workspace(tmp_path, platform_managed=True)
        change = next(c for c in result.changes if c.change_key == "mtime-demo")
        assert change.last_modified_at == datetime.fromtimestamp(1_800_000_000, tz=UTC)

    def test_last_modified_at_skips_hidden_and_empty_dir(
        self, parser: ChangeParser, tmp_path: Path
    ) -> None:
        """ql-20260813-008 / ql-20260814-002：隐藏文件跳过 + 空目录守卫。

        目录仅含 .开头隐藏文件 + 一个空子目录（无文件）→ last_modified_at is None
        （os.scandir 改造后与 rglob 版空 default/ 行为一致，None 守卫防 max() 空 seq 报错）。
        """
        change_dir = tmp_path / "changes" / "empty-demo"
        (change_dir / "default").mkdir(parents=True)  # 空子目录
        (change_dir / ".runtime").mkdir()  # 隐藏目录，跳过
        (change_dir / ".gitkeep").write_text("", encoding="utf-8")  # 隐藏文件，跳过

        result = parser.parse_workspace(tmp_path, platform_managed=True)
        change = next(c for c in result.changes if c.change_key == "empty-demo")
        assert change.last_modified_at is None


def _make_map(root: Path, modules_yaml: str) -> Path:
    """在 root/.sillyspec/docs/proj/modules/ 下写 _module-map.yaml，返回 root。"""
    map_file = root / ".sillyspec" / "docs" / "proj" / "modules" / "_module-map.yaml"
    map_file.parent.mkdir(parents=True, exist_ok=True)
    map_file.write_text(modules_yaml, encoding="utf-8")
    return root


class TestLoadModuleMapCache:
    """task-07（perf-remediation）：_load_module_map (path, mtime) 复合键模块级缓存。"""

    @pytest.fixture(autouse=True)
    def _clear_cache(self):
        """每用例清空模块级缓存，测试间不串。"""
        parser_mod._MODULE_MAP_CACHE.clear()
        yield
        parser_mod._MODULE_MAP_CACHE.clear()

    def test_same_mtime_reuses_cache(self, tmp_path: Path, monkeypatch) -> None:
        """同一 (path, mtime) 重复调用只读盘一次（read 计数 == 1）。"""
        root = _make_map(
            tmp_path,
            "modules:\n  agent:\n    paths:\n      - backend/app/modules/agent/**\n",
        )
        real_read = Path.read_text
        counter = {"n": 0}

        def counting_read(self, *a, **kw):
            if self.name == "_module-map.yaml":
                counter["n"] += 1
            return real_read(self, *a, **kw)

        monkeypatch.setattr(Path, "read_text", counting_read)

        first = ChangeParser._load_module_map(root)
        assert counter["n"] == 1
        assert first == {"agent": ["backend/app/modules/agent/"]}

        second = ChangeParser._load_module_map(root)
        assert counter["n"] == 1, "同 mtime 应命中缓存不重读"
        assert second == first

    def test_mtime_change_invalidates_cache(self, tmp_path: Path, monkeypatch) -> None:
        """map 文件内容变更（mtime 变）→ 缓存键失效，读到新内容。"""
        import os

        map_file = tmp_path / ".sillyspec" / "docs" / "proj" / "modules" / "_module-map.yaml"
        map_file.parent.mkdir(parents=True)
        map_file.write_text(
            "modules:\n  agent:\n    paths:\n      - backend/app/modules/agent/**\n",
            encoding="utf-8",
        )
        # 钉死旧 mtime，保证后续覆盖写产生不同的 mtime（Windows mtime 粒度）
        os.utime(map_file, (1_700_000_000, 1_700_000_000))

        before = ChangeParser._load_module_map(tmp_path)
        assert "agent" in before and "scan_docs" not in before

        # 内容变更 + mtime 前进
        map_file.write_text(
            "modules:\n  scan_docs:\n    paths:\n      - backend/app/modules/scan_docs/**\n",
            encoding="utf-8",
        )
        os.utime(map_file, (1_700_000_100, 1_700_000_100))

        after = ChangeParser._load_module_map(tmp_path)
        assert "scan_docs" in after and "agent" not in after, "mtime 变后应读到新内容"

    def test_cross_workspace_no_cache_pollution(self, tmp_path: Path) -> None:
        """两个 workspace 同名 map 文件各自独立缓存条目（复合键含 resolved path）。"""
        import os

        ws1 = _make_map(tmp_path / "ws1", "modules:\n  agent:\n    paths:\n      - a/**\n")
        ws2 = _make_map(tmp_path / "ws2", "modules:\n  scan_docs:\n    paths:\n      - b/**\n")
        # 同 mtime 也绝不能串（仅按 mtime 做键的缺陷就是这里）
        for ws in (ws1, ws2):
            map_file = ws / ".sillyspec" / "docs" / "proj" / "modules" / "_module-map.yaml"
            os.utime(map_file, (1_700_000_000, 1_700_000_000))

        r1 = ChangeParser._load_module_map(ws1)
        r2 = ChangeParser._load_module_map(ws2)
        assert r1 == {"agent": ["a/"]}
        assert r2 == {"scan_docs": ["b/"]}
        # 两个条目并存（各 hit 各的）
        assert ChangeParser._load_module_map(ws1) == {"agent": ["a/"]}
        assert ChangeParser._load_module_map(ws2) == {"scan_docs": ["b/"]}

    def test_cached_value_immutable_contract(self, tmp_path: Path) -> None:
        """缓存值不可变约定：调用方拿到结果原地改，不污染后续缓存命中。"""
        root = _make_map(tmp_path, "modules:\n  agent:\n    paths:\n      - a/**\n")
        first = ChangeParser._load_module_map(root)
        first["agent"].append("polluted/")  # 模拟调用方误 mutate
        again = ChangeParser._load_module_map(root)
        assert again == {"agent": ["a/"]}, "缓存命中不应吐回被调用方污染的列表"


class TestLoadModuleMapPlatformManaged:
    """task-07 附带修复：platform_managed 扁平布局（root/docs）路径探测命中。"""

    @pytest.fixture(autouse=True)
    def _clear_cache(self):
        parser_mod._MODULE_MAP_CACHE.clear()
        yield
        parser_mod._MODULE_MAP_CACHE.clear()

    def test_flat_layout_map_found(self, tmp_path: Path) -> None:
        """map 在 root/docs（扁平布局）下也能被找到——修复前恒 {} 的预存缺陷。"""
        map_file = tmp_path / "docs" / "proj" / "modules" / "_module-map.yaml"
        map_file.parent.mkdir(parents=True)
        map_file.write_text(
            "modules:\n  agent:\n    paths:\n      - backend/app/modules/agent/**\n",
            encoding="utf-8",
        )
        result = ChangeParser._load_module_map(tmp_path)
        assert result == {"agent": ["backend/app/modules/agent/"]}

    def test_wrapped_layout_takes_priority(self, tmp_path: Path) -> None:
        """两处都有时优先 root/.sillyspec/docs（包裹布局优先，扁平兜底）。"""
        wrapped = _make_map(tmp_path, "modules:\n  wrapped:\n    paths:\n      - w/**\n")
        flat_map = tmp_path / "docs" / "proj-flat" / "modules" / "_module-map.yaml"
        flat_map.parent.mkdir(parents=True)
        flat_map.write_text("modules:\n  flat:\n    paths:\n      - f/**\n", encoding="utf-8")
        assert wrapped == tmp_path
        result = ChangeParser._load_module_map(tmp_path)
        assert "wrapped" in result and "flat" not in result
