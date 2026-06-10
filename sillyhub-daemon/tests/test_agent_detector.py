"""Tests for AgentDetector — 12 agent definitions, env override, version detection."""

from __future__ import annotations

import asyncio
import os
from unittest.mock import AsyncMock, MagicMock, patch


from sillyhub_daemon.agent_detector import (
    AgentDef,
    AgentDetector,
    AgentInfo,
    DetectedAgent,
    check_min_version,
    parse_semver,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _run(coro):
    """Run an async coroutine synchronously (for test convenience)."""
    return asyncio.run(coro)


# ---------------------------------------------------------------------------
# AgentDef dataclass
# ---------------------------------------------------------------------------


class TestAgentDef:
    def test_basic_fields(self):
        d = AgentDef(
            bin="claude",
            env_path="SILLYHUB_CLAUDE_PATH",
            version_pattern=r"Claude Code (\d+\.\d+\.\d+)",
            protocol="stream_json",
        )
        assert d.bin == "claude"
        assert d.env_path == "SILLYHUB_CLAUDE_PATH"
        assert d.protocol == "stream_json"
        assert d.min_version is None

    def test_min_version(self):
        d = AgentDef(
            bin="codex",
            env_path="SILLYHUB_CODEX_PATH",
            version_pattern=r"(\d+\.\d+\.\d+)",
            protocol="json_rpc",
            min_version="0.100.0",
        )
        assert d.min_version == "0.100.0"


# ---------------------------------------------------------------------------
# DetectedAgent dataclass
# ---------------------------------------------------------------------------


class TestDetectedAgent:
    def test_defaults(self):
        a = DetectedAgent(
            name="test",
            bin_path="/usr/bin/test",
            version=None,
            protocol="stream_json",
            available=True,
        )
        assert a.version_warning is None

    def test_with_warning(self):
        a = DetectedAgent(
            name="test",
            bin_path="/usr/bin/test",
            version="0.5.0",
            protocol="stream_json",
            available=True,
            version_warning="below minimum 1.0.0",
        )
        assert a.version_warning is not None


# ---------------------------------------------------------------------------
# AGENT_DEFS — 12 entries
# ---------------------------------------------------------------------------


class TestAgentDefs:
    def test_agent_defs_contains_12_entries(self):
        assert len(AgentDetector.AGENT_DEFS) == 12

    def test_all_protocols_correct(self):
        expected_protocols = {
            "claude": "stream_json",
            "codex": "json_rpc",
            "copilot": "jsonl",
            "opencode": "ndjson",
            "openclaw": "ndjson",
            "hermes": "json_rpc",
            "gemini": "stream_json",
            "pi": "ndjson",
            "cursor": "stream_json",
            "kimi": "json_rpc",
            "kiro": "json_rpc",
            "antigravity": "text",
        }
        for key, protocol in expected_protocols.items():
            assert AgentDetector.AGENT_DEFS[key].protocol == protocol, (
                f"Expected {key}.protocol={protocol}, got {AgentDetector.AGENT_DEFS[key].protocol}"
            )

    def test_all_agent_defs_are_agentdef_instances(self):
        for key, defn in AgentDetector.AGENT_DEFS.items():
            assert isinstance(defn, AgentDef), f"{key} is not AgentDef"

    def test_claude_min_version(self):
        assert AgentDetector.AGENT_DEFS["claude"].min_version == "2.0.0"

    def test_codex_min_version(self):
        assert AgentDetector.AGENT_DEFS["codex"].min_version == "0.100.0"

    def test_copilot_min_version(self):
        assert AgentDetector.AGENT_DEFS["copilot"].min_version == "1.0.0"

    def test_agents_without_min_version(self):
        no_min = [
            "opencode",
            "openclaw",
            "hermes",
            "gemini",
            "pi",
            "cursor",
            "kimi",
            "kiro",
            "antigravity",
        ]
        for name in no_min:
            assert AgentDetector.AGENT_DEFS[name].min_version is None, (
                f"{name} should have no min_version"
            )


# ---------------------------------------------------------------------------
# _resolve_bin_path — env override + fallback
# ---------------------------------------------------------------------------


class TestResolveBinPath:
    @patch.dict(os.environ, {"SILLYHUB_CLAUDE_PATH": "/custom/claude"})
    @patch("os.path.isfile", return_value=True)
    def test_env_override(self, mock_isfile):
        detector = AgentDetector()
        defn = AgentDetector.AGENT_DEFS["claude"]
        result = detector._resolve_bin_path(defn)
        assert result == "/custom/claude"

    @patch.dict(os.environ, {"SILLYHUB_CLAUDE_PATH": "/nonexistent/claude"})
    @patch("os.path.isfile", return_value=False)
    @patch(
        "sillyhub_daemon.agent_detector.shutil.which", return_value="/usr/bin/claude"
    )
    def test_env_path_not_exist_fallback_to_which(self, mock_which, mock_isfile):
        detector = AgentDetector()
        defn = AgentDetector.AGENT_DEFS["claude"]
        result = detector._resolve_bin_path(defn)
        assert result == "/usr/bin/claude"

    @patch.dict(os.environ, {}, clear=True)
    @patch(
        "sillyhub_daemon.agent_detector.shutil.which", return_value="/usr/bin/claude"
    )
    def test_no_env_fallback_to_which(self, mock_which):
        detector = AgentDetector()
        defn = AgentDetector.AGENT_DEFS["claude"]
        result = detector._resolve_bin_path(defn)
        assert result == "/usr/bin/claude"

    @patch.dict(os.environ, {}, clear=True)
    @patch("sillyhub_daemon.agent_detector.shutil.which", return_value=None)
    def test_not_found(self, mock_which):
        detector = AgentDetector()
        defn = AgentDetector.AGENT_DEFS["claude"]
        result = detector._resolve_bin_path(defn)
        assert result is None


# ---------------------------------------------------------------------------
# _detect_version — subprocess version detection
# ---------------------------------------------------------------------------


class TestDetectVersion:
    @patch("sillyhub_daemon.agent_detector.asyncio.create_subprocess_exec")
    def test_detect_version_success(self, mock_subprocess):
        proc = MagicMock()
        proc.communicate = AsyncMock(return_value=(b"Claude Code 2.1.5\n", b""))
        mock_subprocess.return_value = proc

        detector = AgentDetector()
        defn = AgentDetector.AGENT_DEFS["claude"]
        version = _run(detector._detect_version("/usr/bin/claude", defn))
        assert version == "2.1.5"

    @patch("sillyhub_daemon.agent_detector.asyncio.create_subprocess_exec")
    def test_detect_version_generic_pattern(self, mock_subprocess):
        proc = MagicMock()
        proc.communicate = AsyncMock(return_value=(b"codex 0.1.2\n", b""))
        mock_subprocess.return_value = proc

        detector = AgentDetector()
        defn = AgentDetector.AGENT_DEFS["codex"]
        version = _run(detector._detect_version("/usr/bin/codex", defn))
        assert version == "0.1.2"

    @patch("sillyhub_daemon.agent_detector.asyncio.create_subprocess_exec")
    def test_detect_version_timeout(self, mock_subprocess):
        proc = MagicMock()
        proc.communicate = AsyncMock(side_effect=asyncio.TimeoutError())
        mock_subprocess.return_value = proc

        detector = AgentDetector()
        defn = AgentDetector.AGENT_DEFS["claude"]
        version = _run(detector._detect_version("/usr/bin/claude", defn))
        assert version is None

    @patch("sillyhub_daemon.agent_detector.asyncio.create_subprocess_exec")
    def test_detect_version_pattern_no_match(self, mock_subprocess):
        proc = MagicMock()
        proc.communicate = AsyncMock(return_value=(b"unknown output\n", b""))
        mock_subprocess.return_value = proc

        detector = AgentDetector()
        defn = AgentDetector.AGENT_DEFS["claude"]
        version = _run(detector._detect_version("/usr/bin/claude", defn))
        assert version is None

    @patch(
        "sillyhub_daemon.agent_detector.asyncio.create_subprocess_exec",
        side_effect=FileNotFoundError,
    )
    def test_detect_version_file_not_found(self, mock_subprocess):
        detector = AgentDetector()
        defn = AgentDetector.AGENT_DEFS["claude"]
        version = _run(detector._detect_version("/usr/bin/claude", defn))
        assert version is None

    @patch(
        "sillyhub_daemon.agent_detector.asyncio.create_subprocess_exec",
        side_effect=OSError("boom"),
    )
    def test_detect_version_os_error(self, mock_subprocess):
        detector = AgentDetector()
        defn = AgentDetector.AGENT_DEFS["claude"]
        version = _run(detector._detect_version("/usr/bin/claude", defn))
        assert version is None


# ---------------------------------------------------------------------------
# detect_all — returns list[DetectedAgent]
# ---------------------------------------------------------------------------


class TestDetectAll:
    @patch("sillyhub_daemon.agent_detector.shutil.which", return_value=None)
    @patch.dict(os.environ, {}, clear=True)
    def test_detect_all_marks_unavailable(self, mock_which):
        detector = AgentDetector()
        results = _run(detector.detect_all())
        assert len(results) == 12
        assert all(isinstance(r, DetectedAgent) for r in results)
        assert all(not r.available for r in results)
        assert all(r.bin_path == "" for r in results)
        assert all(r.version is None for r in results)

    @patch(
        "sillyhub_daemon.agent_detector.shutil.which", return_value="/usr/bin/claude"
    )
    @patch("sillyhub_daemon.agent_detector.asyncio.create_subprocess_exec")
    @patch.dict(os.environ, {}, clear=True)
    def test_detect_all_returns_all_agents(self, mock_subprocess, mock_which):
        proc = MagicMock()
        proc.communicate = AsyncMock(return_value=(b"Claude Code 2.1.5\n", b""))
        mock_subprocess.return_value = proc

        detector = AgentDetector()
        results = _run(detector.detect_all())
        assert len(results) == 12
        assert all(isinstance(r, DetectedAgent) for r in results)

    @patch(
        "sillyhub_daemon.agent_detector.shutil.which", return_value="/usr/bin/claude"
    )
    @patch("sillyhub_daemon.agent_detector.asyncio.create_subprocess_exec")
    @patch.dict(os.environ, {}, clear=True)
    def test_detect_all_available_agent_has_version(self, mock_subprocess, mock_which):
        proc = MagicMock()
        proc.communicate = AsyncMock(return_value=(b"Claude Code 2.1.5\n", b""))
        mock_subprocess.return_value = proc

        detector = AgentDetector()
        results = _run(detector.detect_all())
        claude = next(r for r in results if r.name == "claude")
        assert claude.available is True
        assert claude.version == "2.1.5"
        assert claude.protocol == "stream_json"


# ---------------------------------------------------------------------------
# detect_one
# ---------------------------------------------------------------------------


class TestDetectOne:
    @patch(
        "sillyhub_daemon.agent_detector.shutil.which", return_value="/usr/bin/claude"
    )
    @patch("sillyhub_daemon.agent_detector.asyncio.create_subprocess_exec")
    @patch.dict(os.environ, {}, clear=True)
    def test_detect_one_found(self, mock_subprocess, mock_which):
        proc = MagicMock()
        proc.communicate = AsyncMock(return_value=(b"Claude Code 2.1.5\n", b""))
        mock_subprocess.return_value = proc

        detector = AgentDetector()
        result = _run(detector.detect_one("claude"))
        assert result is not None
        assert result.name == "claude"
        assert result.available is True
        assert result.version == "2.1.5"

    @patch("sillyhub_daemon.agent_detector.shutil.which", return_value=None)
    @patch.dict(os.environ, {}, clear=True)
    def test_detect_one_not_found(self, mock_which):
        detector = AgentDetector()
        result = _run(detector.detect_one("claude"))
        assert result is not None
        assert result.available is False

    def test_detect_one_unknown_agent(self):
        detector = AgentDetector()
        result = _run(detector.detect_one("nonexistent"))
        assert result is None


# ---------------------------------------------------------------------------
# Version warning
# ---------------------------------------------------------------------------


class TestVersionWarning:
    @patch(
        "sillyhub_daemon.agent_detector.shutil.which", return_value="/usr/bin/claude"
    )
    @patch("sillyhub_daemon.agent_detector.asyncio.create_subprocess_exec")
    @patch.dict(os.environ, {}, clear=True)
    def test_version_warning_set_when_below_min(self, mock_subprocess, mock_which):
        proc = MagicMock()
        proc.communicate = AsyncMock(return_value=(b"Claude Code 1.0.0\n", b""))
        mock_subprocess.return_value = proc

        detector = AgentDetector()
        results = _run(detector.detect_all())
        claude = next(r for r in results if r.name == "claude")
        assert claude.version_warning is not None
        assert "2.0.0" in claude.version_warning

    @patch(
        "sillyhub_daemon.agent_detector.shutil.which", return_value="/usr/bin/claude"
    )
    @patch("sillyhub_daemon.agent_detector.asyncio.create_subprocess_exec")
    @patch.dict(os.environ, {}, clear=True)
    def test_version_warning_none_when_ok(self, mock_subprocess, mock_which):
        proc = MagicMock()
        proc.communicate = AsyncMock(return_value=(b"Claude Code 3.0.0\n", b""))
        mock_subprocess.return_value = proc

        detector = AgentDetector()
        results = _run(detector.detect_all())
        claude = next(r for r in results if r.name == "claude")
        assert claude.version_warning is None

    @patch(
        "sillyhub_daemon.agent_detector.shutil.which", return_value="/usr/bin/claude"
    )
    @patch("sillyhub_daemon.agent_detector.asyncio.create_subprocess_exec")
    @patch.dict(os.environ, {}, clear=True)
    def test_version_warning_none_when_no_min_version(
        self, mock_subprocess, mock_which
    ):
        proc = MagicMock()
        proc.communicate = AsyncMock(return_value=(b"opencode 0.1.0\n", b""))
        mock_subprocess.return_value = proc

        detector = AgentDetector()
        results = _run(detector.detect_all())
        opencode = next(r for r in results if r.name == "opencode")
        assert opencode.version_warning is None


# ---------------------------------------------------------------------------
# parse_semver
# ---------------------------------------------------------------------------


class TestParseSemver:
    def test_valid_semver(self):
        assert parse_semver("1.2.3") == (1, 2, 3)

    def test_zero_version(self):
        assert parse_semver("0.0.0") == (0, 0, 0)

    def test_large_numbers(self):
        assert parse_semver("10.100.200") == (10, 100, 200)

    def test_invalid_returns_none(self):
        assert parse_semver("not-a-version") is None

    def test_partial_returns_none(self):
        assert parse_semver("1.2") is None

    def test_empty_returns_none(self):
        assert parse_semver("") is None

    def test_none_returns_none(self):
        assert parse_semver(None) is None


# ---------------------------------------------------------------------------
# check_min_version
# ---------------------------------------------------------------------------


class TestCheckMinVersion:
    def test_below_min(self):
        assert check_min_version("claude", "1.0.0") is not None

    def test_above_min(self):
        assert check_min_version("claude", "3.0.0") is None

    def test_exact_min(self):
        assert check_min_version("claude", "2.0.0") is None

    def test_no_min_requirement(self):
        assert check_min_version("gemini", "0.1.0") is None

    def test_invalid_version_string(self):
        assert check_min_version("claude", "not-valid") is None


# ---------------------------------------------------------------------------
# Backward compatibility — AgentInfo / get_capabilities
# ---------------------------------------------------------------------------


class TestBackwardCompat:
    def test_agent_info_still_exists(self):
        info = AgentInfo(name="test", command="t")
        assert info.name == "test"
        assert info.version is None
        assert info.available is False

    def test_get_capabilities_still_works(self):
        detector = AgentDetector()
        agents = [
            AgentInfo(name="claude", command="claude", version="2.0.0", available=True),
            AgentInfo(name="codex", command="", available=False),
        ]
        caps = detector.get_capabilities(agents)
        assert caps == {"agents": ["claude"], "max_concurrent_tasks": 5}

    def test_get_capabilities_empty(self):
        detector = AgentDetector()
        caps = detector.get_capabilities([])
        assert caps == {"agents": [], "max_concurrent_tasks": 5}


# ---------------------------------------------------------------------------
# is_available (sync) — adapted to new AGENT_DEFS
# ---------------------------------------------------------------------------


class TestIsAvailable:
    @patch.dict(os.environ, {"SILLYHUB_CLAUDE_PATH": "/custom/claude"})
    @patch("os.path.isfile", return_value=True)
    def test_available_via_env(self, mock_isfile):
        detector = AgentDetector()
        assert detector.is_available("claude") is True

    @patch.dict(os.environ, {}, clear=True)
    @patch(
        "sillyhub_daemon.agent_detector.shutil.which", return_value="/usr/bin/claude"
    )
    def test_available_via_which(self, mock_which):
        detector = AgentDetector()
        assert detector.is_available("claude") is True

    @patch.dict(os.environ, {}, clear=True)
    @patch("sillyhub_daemon.agent_detector.shutil.which", return_value=None)
    def test_not_available(self, mock_which):
        detector = AgentDetector()
        assert detector.is_available("claude") is False

    def test_unknown_agent(self):
        detector = AgentDetector()
        assert detector.is_available("nonexistent") is False
