"""Tests for TaskRunner provider-based dispatch (task-08).

Blueprint: .sillyspec/changes/2026-06-09-daemon-agent-detection/tasks/task-08.md

Validates that TaskRunner.execute_task delegates to the correct AgentBackend
via the get_backend() factory, passes correct parameters, forwards events,
and handles edge cases (unsupported provider, missing fields, etc.).
"""

from __future__ import annotations

import pathlib
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from sillyhub_daemon.task_runner import TaskRunner
from sillyhub_daemon.backends import (
    AgentBackend,
    AgentEvent,
    TaskResult as BackendTaskResult,
)


# ---------------------------------------------------------------------------
# Helpers / fixtures
# ---------------------------------------------------------------------------


def _make_runner() -> TaskRunner:
    """Create a TaskRunner with mocked dependencies."""
    client = AsyncMock()
    client.submit_messages = AsyncMock(return_value={})
    workspace = AsyncMock()
    workspace.prepare_workspace = AsyncMock(return_value=pathlib.Path("/tmp/workspace"))
    workspace.collect_diff = AsyncMock(
        return_value={
            "patch": "diff --git a/file.txt b/file.txt",
            "files_changed": 1,
            "insertions": 5,
            "deletions": 2,
        }
    )
    credential = MagicMock()
    credential.build_env = MagicMock(return_value={"API_KEY": "test"})
    return TaskRunner(client, workspace, credential)


def _base_payload(**overrides) -> dict:
    """Return a minimal valid payload, with optional overrides."""
    base = {
        "workspace_name": "default",
        "repo_url": "https://github.com/example/repo.git",
        "branch": "main",
        "claude_md": "# test",
        "prompt": "list files",
        "tool_config": {},
        "agent_run_id": "run-123",
    }
    base.update(overrides)
    return base


def _mock_backend_class(result: BackendTaskResult | None = None) -> type[AgentBackend]:
    """Create a mock AgentBackend **class** whose instances return *result*.

    Returns the class (type), not an instance — matching get_backend() contract.
    The instantiated backend stores the last execute call in ``_execute_mock``.
    """
    if result is None:
        result = BackendTaskResult(
            status="completed",
            output="done",
            duration_ms=100,
        )

    class MockBackend(AgentBackend):
        provider = "mock"

        def __init__(self):
            self._execute_mock = AsyncMock(return_value=result)

        async def execute(self, cmd_path, task_prompt, work_dir, env=None, **kwargs):
            return await self._execute_mock(
                cmd_path, task_prompt, work_dir, env, **kwargs
            )

        async def parse_output(self, line):
            return None

    return MockBackend


def _mock_backend(result: BackendTaskResult | None = None):
    """Create a mock backend class and a tracked instance.

    Returns (MockBackend_class, last_created_instance) so tests can
    assert on the instance after execute_task runs.

    Usage::

        cls, _ = _mock_backend()
        mock_get_backend.return_value = cls
        ...
        # instance was created inside execute_task via cls()
    """
    MockCls = _mock_backend_class(result)
    return MockCls


# ---------------------------------------------------------------------------
# TDD Step 1: _test_execute_task_uses_claude_backend
# ---------------------------------------------------------------------------


class TestExecuteTaskUsesClaudeBackend:
    """A-02: provider='claude' should delegate to StreamJsonBackend."""

    @pytest.mark.asyncio
    @patch("sillyhub_daemon.task_runner.get_backend")
    async def test_uses_claude_backend(self, mock_get_backend):
        runner = _make_runner()
        mock_cls = _mock_backend_class()
        mock_get_backend.return_value = mock_cls

        payload = _base_payload(provider="claude")
        result = await runner.execute_task("lease-1", "token-1", payload)

        mock_get_backend.assert_called_once_with("claude")
        assert result.success is True


# ---------------------------------------------------------------------------
# TDD Step 2: _test_execute_task_uses_codex_backend
# ---------------------------------------------------------------------------


class TestExecuteTaskUsesCodexBackend:
    """A-03: provider='codex' should delegate to JsonRpcBackend."""

    @pytest.mark.asyncio
    @patch("sillyhub_daemon.task_runner.get_backend")
    async def test_uses_codex_backend(self, mock_get_backend):
        runner = _make_runner()
        mock_cls = _mock_backend_class()
        mock_get_backend.return_value = mock_cls

        payload = _base_payload(provider="codex")
        result = await runner.execute_task("lease-2", "token-2", payload)

        mock_get_backend.assert_called_once_with("codex")
        assert result.success is True


# ---------------------------------------------------------------------------
# TDD Step 3: _test_execute_task_uses_copilot_backend
# ---------------------------------------------------------------------------


class TestExecuteTaskUsesCopilotBackend:
    """A-04: provider='copilot' should delegate to JsonlBackend."""

    @pytest.mark.asyncio
    @patch("sillyhub_daemon.task_runner.get_backend")
    async def test_uses_copilot_backend(self, mock_get_backend):
        runner = _make_runner()
        mock_cls = _mock_backend_class()
        mock_get_backend.return_value = mock_cls

        payload = _base_payload(provider="copilot")
        result = await runner.execute_task("lease-3", "token-3", payload)

        mock_get_backend.assert_called_once_with("copilot")
        assert result.success is True


# ---------------------------------------------------------------------------
# TDD Step 4: _test_execute_task_uses_text_backend
# ---------------------------------------------------------------------------


class TestExecuteTaskUsesAntigravityBackend:
    """A-05: provider='antigravity' should delegate to TextBackend."""

    @pytest.mark.asyncio
    @patch("sillyhub_daemon.task_runner.get_backend")
    async def test_uses_text_backend(self, mock_get_backend):
        runner = _make_runner()
        mock_cls = _mock_backend_class()
        mock_get_backend.return_value = mock_cls

        payload = _base_payload(provider="antigravity")
        result = await runner.execute_task("lease-4", "token-4", payload)

        mock_get_backend.assert_called_once_with("antigravity")
        assert result.success is True


# ---------------------------------------------------------------------------
# TDD Step 5: _test_execute_task_default_provider_is_claude
# ---------------------------------------------------------------------------


class TestDefaultProviderIsClaude:
    """A-06: payload without 'provider' defaults to 'claude'."""

    @pytest.mark.asyncio
    @patch("sillyhub_daemon.task_runner.get_backend")
    async def test_default_provider_is_claude(self, mock_get_backend):
        runner = _make_runner()
        mock_cls = _mock_backend_class()
        mock_get_backend.return_value = mock_cls

        # No 'provider' key in payload
        payload = _base_payload()
        payload.pop("provider", None)
        result = await runner.execute_task("lease-5", "token-5", payload)

        mock_get_backend.assert_called_once_with("claude")
        assert result.success is True


# ---------------------------------------------------------------------------
# TDD Step 6: _test_execute_task_unsupported_provider
# ---------------------------------------------------------------------------


class TestUnsupportedProvider:
    """A-07: unsupported provider returns TaskResult(success=False)."""

    @pytest.mark.asyncio
    @patch("sillyhub_daemon.task_runner.get_backend")
    async def test_unsupported_provider(self, mock_get_backend):
        runner = _make_runner()
        mock_get_backend.side_effect = ValueError("Unknown provider: unknown")

        payload = _base_payload(provider="unknown")
        result = await runner.execute_task("lease-6", "token-6", payload)

        assert result.success is False
        assert "unsupported provider: unknown" in result.error


# ---------------------------------------------------------------------------
# TDD Step 7: _test_execute_task_passes_correct_params
# ---------------------------------------------------------------------------


class TestPassesCorrectParams:
    """A-08: backend.execute receives correct cmd_path, task_prompt, work_dir, env."""

    @pytest.mark.asyncio
    @patch("sillyhub_daemon.task_runner.get_backend")
    async def test_passes_correct_params(self, mock_get_backend):
        runner = _make_runner()

        # Use a MagicMock that tracks calls when instantiated
        execute_mock = AsyncMock(
            return_value=BackendTaskResult(
                status="completed",
                output="done",
                duration_ms=100,
            )
        )
        mock_cls = MagicMock()
        mock_instance = MagicMock()
        mock_instance.execute = execute_mock
        mock_cls.return_value = mock_instance
        mock_get_backend.return_value = mock_cls

        payload = _base_payload(
            provider="claude",
            cmd_path="/usr/local/bin/claude",
            prompt="do something",
            timeout=120,
            model="claude-sonnet-4-20250514",
            session_id="sess-abc",
        )
        result = await runner.execute_task("lease-7", "token-7", payload)

        assert result.success is True
        # Verify backend was instantiated
        mock_cls.assert_called_once()
        execute_mock.assert_called_once()
        call_args = execute_mock.call_args

        # Keyword args passed to execute
        kwargs = call_args.kwargs
        assert kwargs["cmd_path"] == "/usr/local/bin/claude"
        assert kwargs["task_prompt"] == "do something"
        assert kwargs["work_dir"] == str(pathlib.Path("/tmp/workspace"))
        assert "API_KEY" in kwargs["env"]
        assert kwargs["timeout"] == 120
        assert kwargs["model"] == "claude-sonnet-4-20250514"
        assert kwargs["session_id"] == "sess-abc"
        assert kwargs["on_event"] is not None


# ---------------------------------------------------------------------------
# TDD Step 8: _test_execute_task_event_forwarding
# ---------------------------------------------------------------------------


class TestEventForwarding:
    """A-09: agent events forwarded to server via submit_messages."""

    @pytest.mark.asyncio
    @patch("sillyhub_daemon.task_runner.get_backend")
    async def test_event_forwarding(self, mock_get_backend):
        runner = _make_runner()
        captured_on_event = None

        backend_result = BackendTaskResult(
            status="completed",
            output="hello world",
            duration_ms=200,
        )

        class CapturingBackend(AgentBackend):
            provider = "capture"

            async def execute(
                self, cmd_path, task_prompt, work_dir, env=None, **kwargs
            ):
                nonlocal captured_on_event
                captured_on_event = kwargs.get("on_event")
                if captured_on_event:
                    event = AgentEvent(event_type="text", content="agent says hi")
                    await captured_on_event(event)
                return backend_result

            async def parse_output(self, line):
                return None

        # Return the class, not an instance
        mock_get_backend.return_value = CapturingBackend

        payload = _base_payload(provider="claude", agent_run_id="run-evt")
        result = await runner.execute_task("lease-8", "token-8", payload)

        assert result.success is True
        assert captured_on_event is not None
        # submit_messages should have been called to forward the event
        runner._client.submit_messages.assert_called_once()
        call_args = runner._client.submit_messages.call_args
        assert call_args.kwargs["lease_id"] == "lease-8"
        assert call_args.kwargs["agent_run_id"] == "run-evt"
        messages = call_args.kwargs["messages"]
        assert len(messages) == 1
        assert messages[0]["content"] == "agent says hi"


# ---------------------------------------------------------------------------
# TDD Step 9: _test_execute_task_event_forward_failure_doesnt_break
# ---------------------------------------------------------------------------


class TestEventForwardFailureDoesntBreak:
    """A-10: event forwarding failure doesn't break task execution."""

    @pytest.mark.asyncio
    @patch("sillyhub_daemon.task_runner.get_backend")
    async def test_event_forward_failure(self, mock_get_backend):
        runner = _make_runner()
        # Make submit_messages raise an exception
        runner._client.submit_messages.side_effect = ConnectionError("network down")

        backend_result = BackendTaskResult(
            status="completed",
            output="still completed",
            duration_ms=300,
        )

        class EmitBackend(AgentBackend):
            provider = "emit"

            async def execute(
                self, cmd_path, task_prompt, work_dir, env=None, **kwargs
            ):
                on_event = kwargs.get("on_event")
                if on_event:
                    event = AgentEvent(
                        event_type="text", content="will fail to forward"
                    )
                    await on_event(event)
                return backend_result

            async def parse_output(self, line):
                return None

        # Return the class, not an instance
        mock_get_backend.return_value = EmitBackend

        payload = _base_payload(provider="claude")
        result = await runner.execute_task("lease-9", "token-9", payload)

        # Task should still succeed despite event forwarding failure
        assert result.success is True


# ---------------------------------------------------------------------------
# TDD Step 10: _test_execute_task_diff_collected
# ---------------------------------------------------------------------------


class TestDiffCollected:
    """A-11: diff is collected and attached to TaskResult after execution."""

    @pytest.mark.asyncio
    @patch("sillyhub_daemon.task_runner.get_backend")
    async def test_diff_collected(self, mock_get_backend):
        runner = _make_runner()
        mock_cls = _mock_backend_class()
        mock_get_backend.return_value = mock_cls

        payload = _base_payload(provider="claude")
        result = await runner.execute_task("lease-10", "token-10", payload)

        assert result.success is True
        runner._workspace.collect_diff.assert_called_once()
        assert result.patch == "diff --git a/file.txt b/file.txt"
        assert result.files_changed == 1
        assert result.insertions == 5
        assert result.deletions == 2


# ---------------------------------------------------------------------------
# TDD Step 11: _test_execute_task_backward_compatible
# ---------------------------------------------------------------------------


class TestBackwardCompatible:
    """A-12: old-format payload (no provider/cmd_path) still works."""

    @pytest.mark.asyncio
    @patch("sillyhub_daemon.task_runner.get_backend")
    async def test_backward_compatible(self, mock_get_backend):
        runner = _make_runner()
        mock_cls = _mock_backend_class()
        mock_get_backend.return_value = mock_cls

        # Old payload — no provider, no cmd_path
        payload = _base_payload()
        payload.pop("provider", None)
        payload.pop("cmd_path", None)
        payload.pop("timeout", None)
        payload.pop("model", None)
        payload.pop("session_id", None)

        result = await runner.execute_task("lease-11", "token-11", payload)

        # Should default to claude
        mock_get_backend.assert_called_once_with("claude")
        assert result.success is True


# ---------------------------------------------------------------------------
# A-13: _launch_agent and _stream_output removed
# ---------------------------------------------------------------------------


class TestOldMethodsRemoved:
    """A-13: _launch_agent and _stream_output methods should not exist."""

    def test_launch_agent_removed(self):
        runner = _make_runner()
        assert not hasattr(runner, "_launch_agent") or not callable(
            getattr(runner, "_launch_agent", None)
        )

    def test_stream_output_removed(self):
        runner = _make_runner()
        assert not hasattr(runner, "_stream_output") or not callable(
            getattr(runner, "_stream_output", None)
        )
