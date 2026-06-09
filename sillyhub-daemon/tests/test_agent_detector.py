"""Tests for AgentDetector."""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch


from sillyhub_daemon.agent_detector import AgentDetector, AgentInfo


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _run(coro):
    """Run an async coroutine synchronously (for test convenience)."""
    return asyncio.run(coro)


# ---------------------------------------------------------------------------
# AgentInfo dataclass
# ---------------------------------------------------------------------------


class TestAgentInfo:
    def test_defaults(self):
        info = AgentInfo(name="test", command="t")
        assert info.name == "test"
        assert info.command == "t"
        assert info.version is None
        assert info.available is False

    def test_available_with_version(self):
        info = AgentInfo(name="x", command="x", version="1.2.3", available=True)
        assert info.available is True
        assert info.version == "1.2.3"


# ---------------------------------------------------------------------------
# AgentDetector – detect_all
# ---------------------------------------------------------------------------


class TestDetectAll:
    @patch("sillyhub_daemon.agent_detector.shutil.which", return_value=None)
    def test_no_agents_installed(self, mock_which):
        detector = AgentDetector()
        results = _run(detector.detect_all())
        assert len(results) == 2
        assert all(not r.available for r in results)

    @patch(
        "sillyhub_daemon.agent_detector.shutil.which", return_value="/usr/bin/claude"
    )
    @patch("sillyhub_daemon.agent_detector.asyncio.create_subprocess_exec")
    def test_agent_found_with_version(self, mock_subprocess, mock_which):
        # Simulate `claude --version` output
        proc = MagicMock()
        proc.communicate = AsyncMock(return_value=(b"Claude Code 1.0.5\n", b""))
        mock_subprocess.return_value = proc

        detector = AgentDetector()
        results = _run(detector.detect_all())

        claude_info = next(r for r in results if r.name == "claude-code")
        assert claude_info.available is True
        assert claude_info.version == "1.0.5"
        assert claude_info.command == "claude"

    @patch(
        "sillyhub_daemon.agent_detector.shutil.which", return_value="/usr/bin/claude"
    )
    @patch("sillyhub_daemon.agent_detector.asyncio.create_subprocess_exec")
    def test_agent_found_version_unparseable(self, mock_subprocess, mock_which):
        proc = MagicMock()
        proc.communicate = AsyncMock(return_value=(b"unknown output\n", b""))
        mock_subprocess.return_value = proc

        detector = AgentDetector()
        results = _run(detector.detect_all())

        claude_info = next(r for r in results if r.name == "claude-code")
        assert claude_info.available is True
        assert claude_info.version is None


# ---------------------------------------------------------------------------
# AgentDetector – _get_version error handling
# ---------------------------------------------------------------------------


class TestGetVersionErrors:
    @patch(
        "sillyhub_daemon.agent_detector.shutil.which", return_value="/usr/bin/claude"
    )
    @patch(
        "sillyhub_daemon.agent_detector.asyncio.create_subprocess_exec",
        side_effect=FileNotFoundError,
    )
    def test_file_not_found(self, mock_subprocess, mock_which):
        detector = AgentDetector()
        results = _run(detector.detect_all())
        claude_info = next(r for r in results if r.name == "claude-code")
        assert claude_info.version is None
        assert claude_info.available is True  # which() succeeded

    @patch(
        "sillyhub_daemon.agent_detector.shutil.which", return_value="/usr/bin/claude"
    )
    @patch(
        "sillyhub_daemon.agent_detector.asyncio.create_subprocess_exec",
        side_effect=asyncio.TimeoutError,
    )
    def test_timeout(self, mock_subprocess, mock_which):
        detector = AgentDetector()
        results = _run(detector.detect_all())
        claude_info = next(r for r in results if r.name == "claude-code")
        assert claude_info.version is None

    @patch(
        "sillyhub_daemon.agent_detector.shutil.which", return_value="/usr/bin/claude"
    )
    @patch(
        "sillyhub_daemon.agent_detector.asyncio.create_subprocess_exec",
        side_effect=OSError("boom"),
    )
    def test_os_error(self, mock_subprocess, mock_which):
        detector = AgentDetector()
        results = _run(detector.detect_all())
        claude_info = next(r for r in results if r.name == "claude-code")
        assert claude_info.version is None


# ---------------------------------------------------------------------------
# AgentDetector – is_available (sync)
# ---------------------------------------------------------------------------


class TestIsAvailable:
    @patch(
        "sillyhub_daemon.agent_detector.shutil.which", return_value="/usr/bin/claude"
    )
    def test_available(self, mock_which):
        detector = AgentDetector()
        assert detector.is_available("claude-code") is True

    @patch("sillyhub_daemon.agent_detector.shutil.which", return_value=None)
    def test_not_available(self, mock_which):
        detector = AgentDetector()
        assert detector.is_available("claude-code") is False

    def test_unknown_agent(self):
        detector = AgentDetector()
        assert detector.is_available("nonexistent") is False


# ---------------------------------------------------------------------------
# AgentDetector – get_capabilities
# ---------------------------------------------------------------------------


class TestGetCapabilities:
    def test_empty(self):
        detector = AgentDetector()
        caps = detector.get_capabilities([])
        assert caps == {"agents": [], "max_concurrent_tasks": 5}

    def test_with_agents(self):
        detector = AgentDetector()
        agents = [
            AgentInfo(
                name="claude-code", command="claude", version="1.0.0", available=True
            ),
            AgentInfo(name="sillyspec", command="", available=False),
        ]
        caps = detector.get_capabilities(agents)
        assert caps == {"agents": ["claude-code"], "max_concurrent_tasks": 5}
