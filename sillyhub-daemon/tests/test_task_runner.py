"""Tests for TaskRunner: execute_task, progress streaming, diff collection."""

from __future__ import annotations

import asyncio
import subprocess
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from sillyhub_daemon.credential import CredentialManager
from sillyhub_daemon.task_runner import TaskResult, TaskRunner


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def client():
    """Mock HubClient that records calls."""
    mock = AsyncMock()
    mock.submit_messages = AsyncMock(return_value={"status": "ok"})
    return mock


@pytest.fixture
def workspace_base(tmp_path):
    return tmp_path / "workspaces"


@pytest.fixture
def workspace_manager(workspace_base):
    from sillyhub_daemon.workspace import WorkspaceManager

    return WorkspaceManager(base_dir=workspace_base)


@pytest.fixture
def cred_path(tmp_path):
    return tmp_path / "credentials.json"


@pytest.fixture
def credential_manager(cred_path):
    return CredentialManager(credentials_path=cred_path)


@pytest.fixture
def runner(client, workspace_manager, credential_manager):
    return TaskRunner(
        client=client,
        workspace_manager=workspace_manager,
        credential_manager=credential_manager,
    )


def _git(args: list[str], *, cwd: Path) -> str:
    """Run a git command synchronously for test setup."""
    result = subprocess.run(
        ["git"] + args,
        cwd=str(cwd),
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise RuntimeError(f"git {args} failed: {result.stderr}")
    return result.stdout


@pytest.fixture
def git_repo(tmp_path):
    """Create a minimal git repo and return its path."""
    repo_dir = tmp_path / "origin"
    repo_dir.mkdir()
    _git(["init"], cwd=repo_dir)
    _git(["config", "user.email", "test@test.com"], cwd=repo_dir)
    _git(["config", "user.name", "Test"], cwd=repo_dir)
    _git(["checkout", "-b", "main"], cwd=repo_dir)
    (repo_dir / "hello.txt").write_text("hello world")
    _git(["add", "hello.txt"], cwd=repo_dir)
    _git(["commit", "-m", "initial"], cwd=repo_dir)
    return repo_dir


def _make_fake_proc(
    stdout_lines: list[bytes] | None = None,
    stderr: bytes = b"",
    exit_code: int = 0,
) -> AsyncMock:
    """Create a fake subprocess.Process mock with preloaded output."""
    fake_proc = AsyncMock(spec=asyncio.subprocess.Process)
    remaining = list(stdout_lines or [])

    async def _readline():
        if remaining:
            return remaining.pop(0)
        return b""

    fake_proc.stdout = MagicMock()
    fake_proc.stdout.readline = _readline
    fake_proc.stderr = AsyncMock()
    fake_proc.stderr.read = AsyncMock(return_value=stderr)
    fake_proc.wait = AsyncMock(return_value=exit_code)
    return fake_proc


# ---------------------------------------------------------------------------
# TaskResult dataclass
# ---------------------------------------------------------------------------


class TestTaskResult:
    def test_defaults(self):
        r = TaskResult(success=True)
        assert r.exit_code == -1
        assert r.patch == ""
        assert r.files_changed == 0
        assert r.insertions == 0
        assert r.deletions == 0
        assert r.output == ""
        assert r.error == ""
        assert r.duration_ms == 0
        assert r.metadata == {}

    def test_custom_values(self):
        r = TaskResult(
            success=False,
            exit_code=1,
            error="boom",
            duration_ms=123,
            metadata={"key": "val"},
        )
        assert r.success is False
        assert r.exit_code == 1
        assert r.error == "boom"
        assert r.duration_ms == 123
        assert r.metadata == {"key": "val"}


# ---------------------------------------------------------------------------
# TaskRunner.__init__
# ---------------------------------------------------------------------------


class TestInit:
    def test_stores_dependencies(
        self, runner, client, workspace_manager, credential_manager
    ):
        assert runner._client is client
        assert runner._workspace is workspace_manager
        assert runner._credentials is credential_manager

    def test_empty_running_tasks(self, runner):
        assert runner._running_tasks == {}
        assert runner.active_task_count == 0


# ---------------------------------------------------------------------------
# execute_task — _launch_agent mocked
# ---------------------------------------------------------------------------


class TestExecuteTask:
    @pytest.mark.asyncio
    async def test_successful_task(self, runner, client):
        """When subprocess exits 0, result.success is True."""
        payload = {
            "workspace_name": "test-ws",
            "claude_md": "# Instructions\nDo stuff.",
            "prompt": "hello",
            "tool_config": {},
            "agent_run_id": "run-123",
        }

        fake_proc = _make_fake_proc(
            stdout_lines=[b"line 1\n", b"line 2\n"],
            stderr=b"stderr output",
            exit_code=0,
        )

        launch_calls: list[tuple] = []

        async def _fake_launch(cmd, *, cwd, env):
            launch_calls.append((cmd, cwd, env))
            return fake_proc

        with patch.object(runner, "_launch_agent", side_effect=_fake_launch):
            result = await runner.execute_task(
                lease_id="lease-1",
                claim_token="token-abc",
                payload=payload,
            )

        # Verify the command includes --print and the prompt.
        cmd = launch_calls[0][0]
        assert cmd[0] == "claude"
        assert "--print" in cmd
        assert "hello" in cmd

        assert result.success is True
        assert result.exit_code == 0
        assert "line 1" in result.output
        assert "line 2" in result.output
        assert result.error == "stderr output"
        assert result.duration_ms >= 0

    @pytest.mark.asyncio
    async def test_failed_task(self, runner, client):
        """When subprocess exits non-zero, result.success is False."""
        payload = {"workspace_name": "fail-ws", "prompt": "bad prompt"}

        fake_proc = _make_fake_proc(
            stderr=b"error msg",
            exit_code=1,
        )

        async def _fake_launch(cmd, *, cwd, env):
            return fake_proc

        with patch.object(runner, "_launch_agent", side_effect=_fake_launch):
            result = await runner.execute_task(
                lease_id="lease-2",
                claim_token="tok",
                payload=payload,
            )

        assert result.success is False
        assert result.exit_code == 1
        assert "error msg" in result.error

    @pytest.mark.asyncio
    async def test_exception_during_execution(self, runner, client):
        """If workspace preparation raises, a failure result is returned."""
        payload = {"workspace_name": "boom"}

        with patch.object(
            runner._workspace,
            "prepare_workspace",
            side_effect=RuntimeError("workspace blew up"),
        ):
            result = await runner.execute_task(
                lease_id="lease-3",
                claim_token="tok",
                payload=payload,
            )

        assert result.success is False
        assert "workspace blew up" in result.error
        assert result.duration_ms >= 0

    @pytest.mark.asyncio
    async def test_no_prompt_uses_bare_command(self, runner, client):
        """When payload has no prompt, cmd is just ["claude"]."""
        payload = {"workspace_name": "bare"}

        fake_proc = _make_fake_proc(exit_code=0)
        launch_calls: list[tuple] = []

        async def _fake_launch(cmd, *, cwd, env):
            launch_calls.append((cmd, cwd, env))
            return fake_proc

        with patch.object(runner, "_launch_agent", side_effect=_fake_launch):
            await runner.execute_task(
                lease_id="lease-4",
                claim_token="tok",
                payload=payload,
            )

        cmd = launch_calls[0][0]
        assert cmd == ["claude"]

    @pytest.mark.asyncio
    async def test_claude_md_written(self, runner, client, workspace_base):
        """CLAUDE.md from payload is written to .claude/CLAUDE.md in workspace."""
        payload = {
            "workspace_name": "claude-md-test",
            "claude_md": "# Project\nImportant instructions.",
        }

        fake_proc = _make_fake_proc(exit_code=0)

        async def _fake_launch(cmd, *, cwd, env):
            return fake_proc

        with patch.object(runner, "_launch_agent", side_effect=_fake_launch):
            result = await runner.execute_task(
                lease_id="lease-5",
                claim_token="tok",
                payload=payload,
            )

        assert result.success is True

        ws_dir = workspace_base / "claude-md-test"
        claude_path = ws_dir / ".claude" / "CLAUDE.md"
        assert claude_path.exists()
        assert (
            claude_path.read_text(encoding="utf-8")
            == "# Project\nImportant instructions."
        )

    @pytest.mark.asyncio
    async def test_no_claude_md_skips_write(self, runner, client):
        """When payload has no claude_md, no file is created."""
        payload = {"workspace_name": "no-md"}

        fake_proc = _make_fake_proc(exit_code=0)

        async def _fake_launch(cmd, *, cwd, env):
            return fake_proc

        with patch.object(runner, "_launch_agent", side_effect=_fake_launch):
            await runner.execute_task(
                lease_id="lease-6",
                claim_token="tok",
                payload=payload,
            )

        ws_dir = runner._workspace.get_workspace_path("no-md")
        assert not (ws_dir / ".claude" / "CLAUDE.md").exists()

    @pytest.mark.asyncio
    async def test_credentials_rendered_into_env(
        self, runner, client, credential_manager
    ):
        """Credential placeholders are resolved and passed to subprocess."""
        credential_manager.set("USER_MY_API_KEY", "sk-secret-123")

        payload = {
            "workspace_name": "cred-test",
            "tool_config": {"api_key": "{{USER_MY_API_KEY}}"},
        }

        fake_proc = _make_fake_proc(exit_code=0)
        launch_calls: list[tuple] = []

        async def _fake_launch(cmd, *, cwd, env):
            launch_calls.append((cmd, cwd, env))
            return fake_proc

        with patch.object(runner, "_launch_agent", side_effect=_fake_launch):
            await runner.execute_task(
                lease_id="lease-7",
                claim_token="tok",
                payload=payload,
            )

        passed_env = launch_calls[0][2]
        assert passed_env.get("API_KEY") == "sk-secret-123"

    @pytest.mark.asyncio
    async def test_output_truncation(self, runner, client):
        """Very long output is truncated to _MAX_OUTPUT characters."""
        payload = {"workspace_name": "trunc"}

        long_line = b"x" * 2000 + b"\n"
        fake_proc = _make_fake_proc(
            stdout_lines=[long_line] * 10,  # ~20,090 chars
            exit_code=0,
        )

        async def _fake_launch(cmd, *, cwd, env):
            return fake_proc

        with patch.object(runner, "_launch_agent", side_effect=_fake_launch):
            result = await runner.execute_task(
                lease_id="lease-8",
                claim_token="tok",
                payload=payload,
            )

        assert result.success is True
        assert len(result.output) == runner._MAX_OUTPUT


# ---------------------------------------------------------------------------
# Progress streaming
# ---------------------------------------------------------------------------


class TestProgressStreaming:
    @pytest.mark.asyncio
    async def test_submit_messages_called_periodically(self, runner, client):
        """submit_messages is called every _PROGRESS_INTERVAL lines."""
        payload = {"workspace_name": "progress-test"}

        # 25 lines so we expect calls at line 10 and 20.
        lines = [f"line {i}\n".encode() for i in range(25)]
        fake_proc = _make_fake_proc(stdout_lines=lines, exit_code=0)

        async def _fake_launch(cmd, *, cwd, env):
            return fake_proc

        with patch.object(runner, "_launch_agent", side_effect=_fake_launch):
            result = await runner.execute_task(
                lease_id="lease-progress",
                claim_token="tok",
                payload=payload,
            )

        assert result.success is True
        # 25 lines / 10 interval = 2 calls expected.
        assert client.submit_messages.call_count == 2

    @pytest.mark.asyncio
    async def test_submit_messages_failure_does_not_crash(self, runner, client):
        """If submit_messages raises, the task continues without error."""
        client.submit_messages.side_effect = ConnectionError("network down")

        payload = {"workspace_name": "fail-progress"}

        # 12 lines -> one progress report at line 10.
        lines = [f"line {i}\n".encode() for i in range(12)]
        fake_proc = _make_fake_proc(stdout_lines=lines, exit_code=0)

        async def _fake_launch(cmd, *, cwd, env):
            return fake_proc

        with patch.object(runner, "_launch_agent", side_effect=_fake_launch):
            result = await runner.execute_task(
                lease_id="lease-prog-fail",
                claim_token="tok",
                payload=payload,
            )

        assert result.success is True

    @pytest.mark.asyncio
    async def test_no_progress_when_few_lines(self, runner, client):
        """Fewer than _PROGRESS_INTERVAL lines means no progress calls."""
        payload = {"workspace_name": "few-lines"}

        # Only 5 lines — below the 10-line threshold.
        lines = [b"short\n"] * 5
        fake_proc = _make_fake_proc(stdout_lines=lines, exit_code=0)

        async def _fake_launch(cmd, *, cwd, env):
            return fake_proc

        with patch.object(runner, "_launch_agent", side_effect=_fake_launch):
            result = await runner.execute_task(
                lease_id="lease-few",
                claim_token="tok",
                payload=payload,
            )

        assert result.success is True
        assert client.submit_messages.call_count == 0


# ---------------------------------------------------------------------------
# Task tracking
# ---------------------------------------------------------------------------


class TestTaskTracking:
    def test_track_and_untrack(self, runner):
        mock_task = MagicMock(spec=asyncio.Task)
        runner.track("t1", mock_task)
        assert runner.active_task_count == 1
        assert runner._running_tasks["t1"] is mock_task

        runner.untrack("t1")
        assert runner.active_task_count == 0

    def test_untrack_nonexistent_is_noop(self, runner):
        runner.untrack("nonexistent")  # should not raise

    @pytest.mark.asyncio
    async def test_cancel_task(self, runner):
        mock_task = MagicMock(spec=asyncio.Task)
        runner.track("t1", mock_task)

        cancelled = await runner.cancel_task("t1")
        assert cancelled is True
        mock_task.cancel.assert_called_once()
        assert runner.active_task_count == 0

    @pytest.mark.asyncio
    async def test_cancel_nonexistent_returns_false(self, runner):
        cancelled = await runner.cancel_task("nonexistent")
        assert cancelled is False


# ---------------------------------------------------------------------------
# Diff collection (integration with real WorkspaceManager)
# ---------------------------------------------------------------------------


class TestDiffCollection:
    @pytest.mark.asyncio
    async def test_diff_collected_after_execution(
        self, runner, client, git_repo, workspace_base
    ):
        """After execution, diff is collected from the workspace."""
        # Clone the repo so there is a real workspace.
        ws_name = "diff-integration"
        ws_dir = await runner._workspace.prepare_workspace(
            ws_name,
            repo_url=str(git_repo),
            branch="main",
        )

        # Modify a file.
        (ws_dir / "hello.txt").write_text("modified content")

        payload = {
            "workspace_name": ws_name,
            "repo_url": str(git_repo),
            "branch": "main",
        }

        fake_proc = _make_fake_proc(exit_code=0)

        async def _fake_launch(cmd, *, cwd, env):
            return fake_proc

        with patch.object(runner, "_launch_agent", side_effect=_fake_launch):
            result = await runner.execute_task(
                lease_id="lease-diff",
                claim_token="tok",
                payload=payload,
            )

        assert result.success is True
        assert result.patch != ""
        assert "hello.txt" in result.patch
        assert result.files_changed >= 1

    @pytest.mark.asyncio
    async def test_no_changes_gives_empty_diff(self, runner, client, git_repo):
        """Clean workspace produces empty diff in the result."""
        payload = {
            "workspace_name": "no-diff",
            "repo_url": str(git_repo),
            "branch": "main",
        }

        fake_proc = _make_fake_proc(exit_code=0)

        async def _fake_launch(cmd, *, cwd, env):
            return fake_proc

        with patch.object(runner, "_launch_agent", side_effect=_fake_launch):
            result = await runner.execute_task(
                lease_id="lease-no-diff",
                claim_token="tok",
                payload=payload,
            )

        assert result.success is True
        assert result.patch == ""
        assert result.files_changed == 0


# ---------------------------------------------------------------------------
# _truncate helper
# ---------------------------------------------------------------------------


class TestTruncate:
    def test_short_text_unchanged(self):
        assert TaskRunner._truncate("hello", 10) == "hello"

    def test_exact_length_unchanged(self):
        assert TaskRunner._truncate("12345", 5) == "12345"

    def test_long_text_truncated(self):
        text = "a" * 100
        assert TaskRunner._truncate(text, 10) == "a" * 10

    def test_empty_text(self):
        assert TaskRunner._truncate("", 5) == ""
