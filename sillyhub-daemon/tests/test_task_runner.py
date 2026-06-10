"""Tests for TaskRunner: execute_task, progress streaming, diff collection.

Updated for the provider-dispatch architecture (task-08):
- _launch_agent and _stream_output have been removed.
- execute_task delegates to AgentBackend via get_backend() factory.
- Tests now mock get_backend instead of _launch_agent.
"""

from __future__ import annotations

import asyncio
import subprocess
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from sillyhub_daemon.backends import (
    AgentBackend,
    AgentEvent,
    TaskResult as BackendTaskResult,
)
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


def _make_mock_backend_class(
    result: BackendTaskResult | None = None,
) -> type[AgentBackend]:
    """Create a mock AgentBackend class for testing.

    Returns the **class** (type), matching the get_backend() contract.
    """
    if result is None:
        result = BackendTaskResult(
            status="completed",
            output="line 1\nline 2\n",
            duration_ms=50,
        )

    class FakeBackend(AgentBackend):
        provider = "fake"

        async def execute(self, cmd_path, task_prompt, work_dir, env=None, **kwargs):
            return result

        async def parse_output(self, line):
            return None

    return FakeBackend


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
# execute_task — get_backend mocked
# ---------------------------------------------------------------------------


class TestExecuteTask:
    @pytest.mark.asyncio
    async def test_successful_task(self, runner, client):
        """When backend returns completed, result.success is True."""
        payload = {
            "workspace_name": "test-ws",
            "claude_md": "# Instructions\nDo stuff.",
            "prompt": "hello",
            "tool_config": {},
            "agent_run_id": "run-123",
        }

        backend_cls = _make_mock_backend_class(
            BackendTaskResult(
                status="completed",
                output="line 1\nline 2\n",
                error="",
                duration_ms=100,
            )
        )

        with patch("sillyhub_daemon.task_runner.get_backend", return_value=backend_cls):
            result = await runner.execute_task(
                lease_id="lease-1",
                claim_token="token-abc",
                payload=payload,
            )

        assert result.success is True
        assert result.exit_code == 0
        assert "line 1" in result.output
        assert "line 2" in result.output
        assert result.duration_ms >= 0

    @pytest.mark.asyncio
    async def test_failed_task(self, runner, client):
        """When backend returns failed, result.success is False."""
        payload = {"workspace_name": "fail-ws", "prompt": "bad prompt"}

        backend_cls = _make_mock_backend_class(
            BackendTaskResult(
                status="failed",
                output="",
                error="error msg",
                duration_ms=50,
            )
        )

        with patch("sillyhub_daemon.task_runner.get_backend", return_value=backend_cls):
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
    async def test_no_prompt_uses_default_provider(self, runner, client):
        """When payload has no prompt, task still executes via backend."""
        payload = {"workspace_name": "bare"}

        backend_cls = _make_mock_backend_class()

        with patch(
            "sillyhub_daemon.task_runner.get_backend", return_value=backend_cls
        ) as mock_gb:
            result = await runner.execute_task(
                lease_id="lease-4",
                claim_token="tok",
                payload=payload,
            )

        # Defaults to "claude" when no provider specified
        mock_gb.assert_called_once_with("claude")
        assert result.success is True

    @pytest.mark.asyncio
    async def test_claude_md_written(self, runner, client, workspace_base):
        """CLAUDE.md from payload is written to .claude/CLAUDE.md in workspace."""
        payload = {
            "workspace_name": "claude-md-test",
            "claude_md": "# Project\nImportant instructions.",
        }

        backend_cls = _make_mock_backend_class()

        with patch("sillyhub_daemon.task_runner.get_backend", return_value=backend_cls):
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

        backend_cls = _make_mock_backend_class()

        with patch("sillyhub_daemon.task_runner.get_backend", return_value=backend_cls):
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
        """Credential placeholders are resolved and passed to backend."""
        credential_manager.set("USER_MY_API_KEY", "sk-secret-123")

        payload = {
            "workspace_name": "cred-test",
            "tool_config": {"api_key": "{{USER_MY_API_KEY}}"},
        }

        execute_calls: list[dict] = []

        class CaptureBackend(AgentBackend):
            provider = "capture"

            async def execute(
                self, cmd_path, task_prompt, work_dir, env=None, **kwargs
            ):
                execute_calls.append({"env": env, **kwargs})
                return BackendTaskResult(status="completed", output="", duration_ms=10)

            async def parse_output(self, line):
                return None

        with patch(
            "sillyhub_daemon.task_runner.get_backend", return_value=CaptureBackend
        ):
            await runner.execute_task(
                lease_id="lease-7",
                claim_token="tok",
                payload=payload,
            )

        passed_env = execute_calls[0]["env"]
        assert passed_env.get("API_KEY") == "sk-secret-123"

    @pytest.mark.asyncio
    async def test_output_truncation(self, runner, client):
        """Very long output is truncated to _MAX_OUTPUT characters."""
        payload = {"workspace_name": "trunc"}

        long_output = "x" * 20_000
        backend_cls = _make_mock_backend_class(
            BackendTaskResult(
                status="completed",
                output=long_output,
                duration_ms=10,
            )
        )

        with patch("sillyhub_daemon.task_runner.get_backend", return_value=backend_cls):
            result = await runner.execute_task(
                lease_id="lease-8",
                claim_token="tok",
                payload=payload,
            )

        assert result.success is True
        assert len(result.output) == runner._MAX_OUTPUT


# ---------------------------------------------------------------------------
# Progress streaming (now via on_event callback)
# ---------------------------------------------------------------------------


class TestProgressStreaming:
    @pytest.mark.asyncio
    async def test_submit_messages_called_on_event(self, runner, client):
        """submit_messages is called when backend emits events via on_event."""
        payload = {"workspace_name": "progress-test"}

        class EmitBackend(AgentBackend):
            provider = "emit"

            async def execute(
                self, cmd_path, task_prompt, work_dir, env=None, **kwargs
            ):
                on_event = kwargs.get("on_event")
                if on_event:
                    for i in range(3):
                        await on_event(
                            AgentEvent(event_type="text", content=f"event {i}")
                        )
                return BackendTaskResult(status="completed", output="", duration_ms=50)

            async def parse_output(self, line):
                return None

        with patch("sillyhub_daemon.task_runner.get_backend", return_value=EmitBackend):
            result = await runner.execute_task(
                lease_id="lease-progress",
                claim_token="tok",
                payload=payload,
            )

        assert result.success is True
        assert client.submit_messages.call_count == 3

    @pytest.mark.asyncio
    async def test_submit_messages_failure_does_not_crash(self, runner, client):
        """If submit_messages raises, the task continues without error."""
        client.submit_messages.side_effect = ConnectionError("network down")

        payload = {"workspace_name": "fail-progress"}

        class EmitBackend(AgentBackend):
            provider = "emit"

            async def execute(
                self, cmd_path, task_prompt, work_dir, env=None, **kwargs
            ):
                on_event = kwargs.get("on_event")
                if on_event:
                    await on_event(AgentEvent(event_type="text", content="will fail"))
                return BackendTaskResult(status="completed", output="", duration_ms=50)

            async def parse_output(self, line):
                return None

        with patch("sillyhub_daemon.task_runner.get_backend", return_value=EmitBackend):
            result = await runner.execute_task(
                lease_id="lease-prog-fail",
                claim_token="tok",
                payload=payload,
            )

        assert result.success is True

    @pytest.mark.asyncio
    async def test_no_progress_when_no_events(self, runner, client):
        """Backend that emits no events means no submit_messages calls."""
        payload = {"workspace_name": "few-lines"}

        backend_cls = _make_mock_backend_class()

        with patch("sillyhub_daemon.task_runner.get_backend", return_value=backend_cls):
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

        backend_cls = _make_mock_backend_class()

        with patch("sillyhub_daemon.task_runner.get_backend", return_value=backend_cls):
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

        backend_cls = _make_mock_backend_class()

        with patch("sillyhub_daemon.task_runner.get_backend", return_value=backend_cls):
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
