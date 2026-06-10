"""Tests for semver parsing and minimum version checking."""

from __future__ import annotations

from sillyhub_daemon.version import (
    MIN_VERSIONS,
    check_min_version,
    format_semver,
    parse_semver,
)


# ── parse_semver ──────────────────────────────────────────────────────────


class TestParseSemver:
    def test_standard(self) -> None:
        assert parse_semver("2.1.5") == (2, 1, 5)

    def test_with_prefix(self) -> None:
        assert parse_semver("Claude Code 2.1.5") == (2, 1, 5)

    def test_with_v_prefix(self) -> None:
        assert parse_semver("v2.0.0") == (2, 0, 0)

    def test_with_suffix(self) -> None:
        assert parse_semver("0.118.0-rc.1") == (0, 118, 0)

    def test_no_match(self) -> None:
        assert parse_semver("no-version-here") is None

    def test_empty(self) -> None:
        assert parse_semver("") is None

    def test_leading_zeros(self) -> None:
        assert parse_semver("02.01.05") == (2, 1, 5)

    def test_large_numbers(self) -> None:
        assert parse_semver("999.999.999") == (999, 999, 999)

    def test_zero_version(self) -> None:
        assert parse_semver("0.0.0") == (0, 0, 0)

    def test_embedded_in_longer_string(self) -> None:
        """search() picks up the first semver match."""
        assert parse_semver("requires 1.0.0, found 2.1.5") == (1, 0, 0)


# ── format_semver ─────────────────────────────────────────────────────────


class TestFormatSemver:
    def test_basic(self) -> None:
        assert format_semver((2, 1, 5)) == "2.1.5"

    def test_zero_version(self) -> None:
        assert format_semver((0, 0, 0)) == "0.0.0"

    def test_large_numbers(self) -> None:
        assert format_semver((0, 100, 0)) == "0.100.0"


# ── MIN_VERSIONS ──────────────────────────────────────────────────────────


class TestMinVersions:
    def test_has_three_providers(self) -> None:
        assert len(MIN_VERSIONS) == 3
        assert "claude" in MIN_VERSIONS
        assert "codex" in MIN_VERSIONS
        assert "copilot" in MIN_VERSIONS


# ── check_min_version ────────────────────────────────────────────────────


class TestCheckMinVersion:
    def test_below_minimum(self) -> None:
        result = check_min_version("claude", "1.5.0")
        assert result is not None
        assert "claude" in result
        assert "1.5.0" in result
        assert "2.0.0" in result

    def test_equal_to_minimum(self) -> None:
        assert check_min_version("claude", "2.0.0") is None

    def test_above_minimum(self) -> None:
        assert check_min_version("claude", "2.1.5") is None

    def test_unknown_provider(self) -> None:
        assert check_min_version("unknown", "1.0.0") is None

    def test_codex_at_minimum(self) -> None:
        assert check_min_version("codex", "0.100.0") is None

    def test_codex_below_minimum(self) -> None:
        result = check_min_version("codex", "0.99.0")
        assert result is not None
        assert "codex" in result
        assert "0.100.0" in result

    def test_unparseable_version(self) -> None:
        assert check_min_version("claude", "no-version") is None

    def test_copilot_at_minimum(self) -> None:
        assert check_min_version("copilot", "1.0.0") is None

    def test_copilot_above_minimum(self) -> None:
        assert check_min_version("copilot", "1.5.3") is None

    def test_copilot_below_minimum(self) -> None:
        result = check_min_version("copilot", "0.9.0")
        assert result is not None
        assert "copilot" in result
