"""Tests for CLI commands: start, stop, status, logs."""

from __future__ import annotations

import os
from unittest.mock import AsyncMock, patch

import pytest
from click.testing import CliRunner

from sillyhub_daemon.__main__ import cli


@pytest.fixture
def runner():
    return CliRunner()


@pytest.fixture
def tmp_daemon_dir(tmp_path, monkeypatch):
    """Redirect DEFAULT_CONFIG_DIR to a temp directory for isolation."""
    import sillyhub_daemon.__main__ as mod
    import sillyhub_daemon.config as cfg_mod

    tmp_dir = tmp_path / "daemon"
    tmp_dir.mkdir()

    monkeypatch.setattr(mod, "_PID_FILE", tmp_dir / "daemon.pid")
    monkeypatch.setattr(mod, "_LOG_FILE", tmp_dir / "daemon.log")
    monkeypatch.setattr(cfg_mod, "DEFAULT_CONFIG_DIR", tmp_dir)
    monkeypatch.setattr(cfg_mod, "DEFAULT_CONFIG_PATH", tmp_dir / "config.json")

    return tmp_dir


# ---------------------------------------------------------------------------
# status
# ---------------------------------------------------------------------------


class TestStatus:
    def test_status_no_daemon(self, runner, tmp_daemon_dir):
        result = runner.invoke(cli, ["status"])
        assert result.exit_code == 0
        assert "stopped" in result.output
        assert "Runtime ID:" in result.output

    def test_status_shows_config(self, runner, tmp_daemon_dir):
        result = runner.invoke(cli, ["status"])
        assert result.exit_code == 0
        assert "Server URL:" in result.output
        assert "http://localhost:8000" in result.output


# ---------------------------------------------------------------------------
# stop
# ---------------------------------------------------------------------------


class TestStop:
    def test_stop_no_pid_file(self, runner, tmp_daemon_dir):
        result = runner.invoke(cli, ["stop"])
        assert result.exit_code == 1
        assert "No PID file found" in result.output

    def test_stop_stale_pid(self, runner, tmp_daemon_dir):
        import sillyhub_daemon.__main__ as mod

        # Write an impossible PID that is guaranteed not alive
        mod._PID_FILE.write_text("999999999")
        result = runner.invoke(cli, ["stop"])
        assert result.exit_code == 1
        assert "not running" in result.output or "stale" in result.output.lower()

    def test_stop_alive_process(self, runner, tmp_daemon_dir):
        import sillyhub_daemon.__main__ as mod

        # Use our own PID — it is always alive
        mod._PID_FILE.write_text(str(os.getpid()))
        # Sending SIGTERM to ourselves would terminate the test runner;
        # instead, patch os.kill so it is a no-op.
        with patch("os.kill") as mock_kill:
            result = runner.invoke(cli, ["stop"])
            # os.kill is called twice: once by _is_process_alive (signal 0),
            # once by the stop command itself (SIGTERM).
            assert mock_kill.call_count == 2
            assert "SIGTERM" in result.output


# ---------------------------------------------------------------------------
# logs
# ---------------------------------------------------------------------------


class TestLogs:
    def test_logs_no_file(self, runner, tmp_daemon_dir):
        result = runner.invoke(cli, ["logs"])
        assert result.exit_code == 0
        assert "No log file found" in result.output

    def test_logs_shows_content(self, runner, tmp_daemon_dir):
        import sillyhub_daemon.__main__ as mod

        mod._LOG_FILE.write_text("line1\nline2\nline3\n")
        result = runner.invoke(cli, ["logs"])
        assert result.exit_code == 0
        assert "line1" in result.output
        assert "line3" in result.output

    def test_logs_tail_option(self, runner, tmp_daemon_dir):
        import sillyhub_daemon.__main__ as mod

        lines = [f"log line {i}" for i in range(100)]
        mod._LOG_FILE.write_text("\n".join(lines) + "\n")
        result = runner.invoke(cli, ["logs", "--tail", "5"])
        assert result.exit_code == 0
        assert "log line 95" in result.output
        assert "log line 99" in result.output
        # Should NOT contain line 90 (outside the tail window)
        assert "log line 90" not in result.output


# ---------------------------------------------------------------------------
# start (smoke test — full start is covered by test_daemon.py)
# ---------------------------------------------------------------------------


class TestStart:
    def test_start_help(self, runner):
        result = runner.invoke(cli, ["start", "--help"])
        assert result.exit_code == 0
        assert "--server" in result.output

    def test_start_writes_pid_and_cleans_up_on_keyboard_interrupt(
        self, runner, tmp_daemon_dir
    ):
        import sillyhub_daemon.__main__ as mod

        mock_daemon_instance = AsyncMock()
        mock_daemon_instance.start = AsyncMock(side_effect=KeyboardInterrupt)
        mock_daemon_instance.stop = AsyncMock()

        with (
            patch("sillyhub_daemon.daemon.Daemon", return_value=mock_daemon_instance),
            patch("sillyhub_daemon.client.HubClient"),
        ):
            runner.invoke(cli, ["start"])

            # PID file should be cleaned up after shutdown
            assert not mod._PID_FILE.exists()
