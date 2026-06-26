"""Tests for app.core.spec_paths.SpecPathResolver — platform_managed mode（D-005@v1）。

覆盖：
- 默认 mode（platform_managed=False）：路径含 ``.sillyspec`` 包裹（repo-native/server-local 回归）
- platform_managed=True：路径扁平（省略 ``.sillyspec`` 段）
- for_spec_workspace 工厂：按 strategy 自动选 mode
- 派生路径（scan_dir/modules_dir/db_path/gate_status_path）随 mode 联动

author: qinyi
created_at: 2026-06-26 11:36:00
"""

from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

from app.core.spec_paths import SpecPathResolver


class TestDefaultMode:
    """platform_managed=False（默认）：``<root>/.sillyspec/...`` 包裹语义，向后兼容。"""

    def test_changes_root_includes_sillyspec(self) -> None:
        r = SpecPathResolver("/data/ws")
        assert r.changes_root() == Path("/data/ws/.sillyspec/changes")

    def test_runtime_dir_includes_sillyspec(self) -> None:
        r = SpecPathResolver("/data/ws")
        assert r.runtime_dir() == Path("/data/ws/.sillyspec/.runtime")

    def test_docs_dir_includes_sillyspec(self) -> None:
        r = SpecPathResolver("/data/ws")
        assert r.docs_dir("myproj") == Path("/data/ws/.sillyspec/docs/myproj")

    def test_scan_dir_derives_from_docs_dir(self) -> None:
        r = SpecPathResolver("/data/ws")
        assert r.scan_dir("myproj") == Path("/data/ws/.sillyspec/docs/myproj/scan")

    def test_db_path_derives_from_runtime_dir(self) -> None:
        r = SpecPathResolver("/data/ws")
        assert r.db_path() == Path("/data/ws/.sillyspec/.runtime/sillyspec.db")

    def test_default_flag_is_false(self) -> None:
        assert SpecPathResolver("/data/ws").platform_managed is False


class TestPlatformManagedMode:
    """platform_managed=True：``<root>/...`` 扁平（spec_root 即 .sillyspec 内容根）。"""

    def test_changes_root_omits_sillyspec(self) -> None:
        r = SpecPathResolver("/data/ws", platform_managed=True)
        assert r.changes_root() == Path("/data/ws/changes")

    def test_runtime_dir_omits_sillyspec(self) -> None:
        r = SpecPathResolver("/data/ws", platform_managed=True)
        assert r.runtime_dir() == Path("/data/ws/.runtime")

    def test_docs_dir_omits_sillyspec(self) -> None:
        r = SpecPathResolver("/data/ws", platform_managed=True)
        assert r.docs_dir("myproj") == Path("/data/ws/docs/myproj")

    def test_scan_dir_omits_sillyspec(self) -> None:
        r = SpecPathResolver("/data/ws", platform_managed=True)
        assert r.scan_dir("myproj") == Path("/data/ws/docs/myproj/scan")

    def test_modules_dir_omits_sillyspec(self) -> None:
        r = SpecPathResolver("/data/ws", platform_managed=True)
        assert r.modules_dir("myproj") == Path("/data/ws/docs/myproj/modules")

    def test_db_path_omits_sillyspec(self) -> None:
        r = SpecPathResolver("/data/ws", platform_managed=True)
        assert r.db_path() == Path("/data/ws/.runtime/sillyspec.db")

    def test_gate_status_path_omits_sillyspec(self) -> None:
        r = SpecPathResolver("/data/ws", platform_managed=True)
        assert r.gate_status_path() == Path("/data/ws/.runtime/gate-status.json")

    def test_archive_dir_omits_sillyspec(self) -> None:
        r = SpecPathResolver("/data/ws", platform_managed=True)
        assert r.archive_dir() == Path("/data/ws/changes/archive")
        assert r.archive_dir("foo") == Path("/data/ws/changes/archive/foo")


class TestForSpecWorkspace:
    """for_spec_workspace 工厂按 strategy 选 mode（鸭子类型，不依赖 ORM）。"""

    def test_platform_managed_strategy_selects_flat_mode(self) -> None:
        spec_ws = SimpleNamespace(spec_root="/data/spec-wspaces/abc", strategy="platform-managed")
        r = SpecPathResolver.for_spec_workspace(spec_ws)
        assert r.platform_managed is True
        assert r.scan_dir("myproj") == Path("/data/spec-wspaces/abc/docs/myproj/scan")

    def test_repo_native_strategy_selects_wrapped_mode(self) -> None:
        spec_ws = SimpleNamespace(spec_root="/repo", strategy="repo-native")
        r = SpecPathResolver.for_spec_workspace(spec_ws)
        assert r.platform_managed is False
        assert r.scan_dir("myproj") == Path("/repo/.sillyspec/docs/myproj/scan")

    def test_unknown_strategy_defaults_to_wrapped(self) -> None:
        spec_ws = SimpleNamespace(spec_root="/repo", strategy="server-local")
        r = SpecPathResolver.for_spec_workspace(spec_ws)
        assert r.platform_managed is False

    def test_missing_strategy_defaults_to_wrapped(self) -> None:
        spec_ws = SimpleNamespace(spec_root="/repo")
        r = SpecPathResolver.for_spec_workspace(spec_ws)
        assert r.platform_managed is False
