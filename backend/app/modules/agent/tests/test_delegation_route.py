"""Tests for delegation.route() — single/team/auto 三档路由（D-002@v1, Wave 3）。

Covers the Wave 3 auto-routing decision (2026-06-28-team-mainline-integration):
explicit ``constraints['mode']`` wins; otherwise auto picks by objective length
+ keyword heuristics (four-factor quantification deferred to plan per D-002).
"""

from __future__ import annotations

from app.modules.agent.delegation import route


class TestRouteExplicit:
    def test_explicit_single(self) -> None:
        assert route("任意内容", {"mode": "single"}) == "single"

    def test_explicit_team(self) -> None:
        assert route("任意内容", {"mode": "team"}) == "team"

    def test_explicit_unknown_mode_falls_through_auto(self) -> None:
        """未知 mode 值（如 auto 本身）→ 走 auto 启发式。"""
        assert route("修个 typo", {"mode": "auto"}) == "single"


class TestRouteAuto:
    def test_short_simple_objective_is_single(self) -> None:
        assert route("修复 README 的一个 typo") == "single"

    def test_long_objective_is_team(self) -> None:
        assert route("x" * 201) == "team"

    def test_keyword_scan_triggers_team(self) -> None:
        assert route("扫描项目结构") == "team"

    def test_keyword_arch_triggers_team(self) -> None:
        assert route("分析整体架构设计") == "team"

    def test_keyword_bootstrap_triggers_team(self) -> None:
        assert route("bootstrap this workspace") == "team"

    def test_no_constraint_short_is_single(self) -> None:
        assert route("改个按钮文案") == "single"

    def test_no_constraint_none(self) -> None:
        assert route("改个按钮文案", None) == "single"
