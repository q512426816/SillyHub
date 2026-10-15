#!/usr/bin/env python3
"""scripts/check-assertion-surfaces.py 单元测试（2026-10-11-assertion-surface-guard）。

覆盖 changed_diff_lines 解析与 evaluate 规则匹配纯函数；规则触发面用假
staged/diff 数据驱动，不碰真 index。放 backend/tests（仓库根 scripts/ 无
pyproject 祖先，flow done 动态子集按最近 pyproject 推断 runner 会把根目录
pytest 批并进 backend cwd 致路径解析失败——实证后迁入）。

跑法::

    cd backend && uv run pytest tests/test_check_assertion_surfaces.py -q
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

# 被测脚本文件名带连字符，非合法模块名，importlib 按路径加载。
# 脚本在仓库根 scripts/：本文件 parents[0]=backend/tests、[1]=backend、[2]=根。
_SCRIPTS_DIR = Path(__file__).resolve().parents[2] / "scripts"
_spec = importlib.util.spec_from_file_location(
    "check_assertion_surfaces", _SCRIPTS_DIR / "check-assertion-surfaces.py"
)
assert _spec is not None and _spec.loader is not None
cas = importlib.util.module_from_spec(_spec)
sys.modules["check_assertion_surfaces"] = cas
_spec.loader.exec_module(cas)


def rule_by_no(no: str) -> "cas.SurfaceRule":
    return next(r for r in cas.RULES if r.no == no)


class TestChangedDiffLines:
    def test_extracts_add_and_remove_lines(self) -> None:
        diff = "\n".join(
            [
                "diff --git a/f b/f",
                "index 111..222 100644",
                "--- a/f",
                "+++ b/f",
                "@@ -1,2 +1,2 @@",
                "-old line",
                "+new line",
                " context",
            ]
        )
        assert cas.changed_diff_lines(diff) == ["old line", "new line"]

    def test_skips_header_and_no_newline_markers(self) -> None:
        diff = "\n".join(
            [
                "+++ b/f",
                "--- a/f",
                "+real add",
                "\\ No newline at end of file",
            ]
        )
        assert cas.changed_diff_lines(diff) == ["real add"]


class TestEvaluate:
    def _fetch_no_diff(self, _glob: str) -> str:
        return ""

    def test_file_mode_triggered_without_test_is_violation(self) -> None:
        rule = rule_by_no("①")
        violations = cas.evaluate(
            [rule],
            ["backend/migrations/versions/20261012000000_new_thing.py"],
            self._fetch_no_diff,
        )
        assert violations == [rule]

    def test_file_mode_triggered_with_test_staged_passes(self) -> None:
        rule = rule_by_no("①")
        violations = cas.evaluate(
            [rule],
            [
                "backend/migrations/versions/20261012000000_new_thing.py",
                "backend/tests/test_align_platform_change_events_migration.py",
            ],
            self._fetch_no_diff,
        )
        assert violations == []

    def test_diff_mode_content_hit_without_test_is_violation(self) -> None:
        rule = rule_by_no("⑧")
        violations = cas.evaluate(
            [rule],
            ["sillyhub-daemon/src/protocol.ts"],
            lambda _g: "+  BRAND_NEW_MSG: 'daemon:brand_new',\n",
        )
        assert violations == [rule]

    def test_diff_mode_comment_only_change_passes(self) -> None:
        """注释行提到 daemon: 不触发（常量形态锚 ^[A-Z_]+: 'daemon:）。"""
        rule = rule_by_no("⑧")
        violations = cas.evaluate(
            [rule],
            ["sillyhub-daemon/src/protocol.ts"],
            lambda _g: "+// 值形如 `daemon:<action>`，前缀不可漏。\n",
        )
        assert violations == []

    def test_diff_mode_unrelated_file_change_passes(self) -> None:
        """同文件非断言面行改动（如 import）不触发。"""
        rule = rule_by_no("⑧")
        violations = cas.evaluate(
            [rule],
            ["sillyhub-daemon/src/protocol.ts"],
            lambda _g: "+import { something } from './x.js';\n",
        )
        assert violations == []

    def test_tabs_entry_line_triggers_rule3(self) -> None:
        rule = rule_by_no("③")
        violations = cas.evaluate(
            [rule],
            ["frontend/src/components/workspace-tabs.tsx"],
            lambda _g: '+  { key: "new-tab", label: "新页签", path: "/new-tab" },\n',
        )
        assert violations == [rule]

    def test_menukey_line_triggers_rule7(self) -> None:
        rule = rule_by_no("⑦")
        violations = cas.evaluate(
            [rule],
            ["frontend/src/lib/menu-permissions.ts"],
            lambda _g: '+    menuKey: "newMenu",\n',
        )
        assert violations == [rule]

    def test_rule7_requires_all_three_pins(self) -> None:
        """⑦ 数量锚三件套（2026-10-15-fix-ci-red：只带序钉漏数量钉 → main 三连红）。"""
        rule = rule_by_no("⑦")
        menukey_diff = '+    menuKey: "newMenu",\n'
        # 只带 admin/menus 序钉（历史事故形态）→ 仍拦
        staged_partial = [
            "frontend/src/lib/menu-permissions.ts",
            "frontend/src/app/(dashboard)/admin/menus/__tests__/page.test.tsx",
        ]
        assert cas.evaluate([rule], staged_partial, lambda _g: menukey_diff) == [rule]
        # 三钉齐 → 过
        staged_all = ["frontend/src/lib/menu-permissions.ts", *rule.requires]
        assert cas.evaluate([rule], staged_all, lambda _g: menukey_diff) == []

    def test_openapi_change_without_both_generated_files_is_violation(self) -> None:
        """⑨ openapi 契约源 → 双 api-types 同提交（daemon 漏生成三连红实证）。"""
        rule = rule_by_no("⑨")
        # 只带前端生成物（deploy-release-notes 事故形态）→ 拦
        staged_partial = [
            "backend/openapi.json",
            "frontend/src/lib/api-types.ts",
        ]
        assert cas.evaluate([rule], staged_partial, self._fetch_no_diff) == [rule]
        # 双生成物齐 → 过
        staged_all = ["backend/openapi.json", *rule.requires]
        assert cas.evaluate([rule], staged_all, self._fetch_no_diff) == []

    def test_heartbeat_marker_triggers_rule2_and_requires_all_four(self) -> None:
        rule = rule_by_no("②")
        staged = [
            "sillyhub-daemon/src/daemon.ts",
            "sillyhub-daemon/tests/daemon-heartbeat-pending.test.ts",
        ]
        violations = cas.evaluate(
            [rule],
            staged,
            lambda _g: (
                "-function _sendHeartbeatOnce(a, b) {\n+function _sendHeartbeatOnce(a, b, c) {\n"
            ),
        )
        assert violations == [rule]
        # 补齐全部四钉后通过
        staged_all = [
            "sillyhub-daemon/src/daemon.ts",
            *rule.requires,
        ]
        assert cas.evaluate([rule], staged_all, lambda _g: "+x _sendHeartbeatOnce y") == []

    def test_unrelated_staged_files_pass_all_rules(self) -> None:
        assert (
            cas.evaluate(
                cas.RULES,
                [".sillyspec/changes/x/tasks.md", "README.md"],
                self._fetch_no_diff,
            )
            == []
        )

    def test_source_file_alone_as_staged_test_does_not_trigger(self) -> None:
        """只改钉子测试文件本身（无契约源）不触发任何规则。"""
        rule = rule_by_no("①")
        assert (
            cas.evaluate(
                [rule],
                ["backend/tests/test_align_platform_change_events_migration.py"],
                self._fetch_no_diff,
            )
            == []
        )
