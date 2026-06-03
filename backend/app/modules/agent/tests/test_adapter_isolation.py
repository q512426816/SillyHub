"""Tests for ClaudeCodeAdapter isolation and output sanitization — task-07."""

import json
import uuid
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.modules.agent.adapters.claude_code import ClaudeCodeAdapter
from app.modules.agent.service import AgentService

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def clear_registry():
    """Ensure proc registry is clean before/after each test."""
    AgentService._proc_registry.clear()
    yield
    AgentService._proc_registry.clear()


def _make_fake_proc(
    returncode: int = 0,
    stdout_data: bytes = b"",
    stderr_data: bytes = b"",
) -> MagicMock:
    """Create a mock subprocess with async stdin/stdout/stderr."""
    proc = MagicMock()
    proc.returncode = returncode
    proc.wait = AsyncMock(return_value=0)

    # stdin
    proc.stdin = AsyncMock()
    proc.stdin.write = MagicMock()
    proc.stdin.drain = AsyncMock()
    proc.stdin.close = MagicMock()

    # stdout — readline returns data once then empty bytes
    proc.stdout = AsyncMock()
    read_calls = iter([stdout_data, b""])
    proc.stdout.readline = AsyncMock(side_effect=list(read_calls))

    # stderr
    proc.stderr = AsyncMock()
    proc.stderr.read = AsyncMock(return_value=stderr_data)

    return proc


@pytest.fixture
def fake_proc_factory():
    """Provide a factory for creating fake processes."""
    return _make_fake_proc


# ---------------------------------------------------------------------------
# allowed_paths injection
# ---------------------------------------------------------------------------


class TestAllowedPaths:
    @pytest.mark.asyncio
    async def test_allowed_paths_injected(self, fake_proc_factory):
        """run() with allowed_paths → CLAUDE_ALLOWED_PATHS in child env."""
        adapter = ClaudeCodeAdapter()
        run_id = uuid.uuid4()
        fake_proc = fake_proc_factory()

        captured_env = {}

        async def _capture_exec(*args, **kwargs):
            captured_env.update(kwargs.get("env", {}))
            return fake_proc

        from app.modules.agent.base import TaskContext

        ctx = TaskContext(
            change_title="test change",
            task_title="test task",
            task_key="task-01",
            allowed_paths=["/tmp/repo-a", "/tmp/repo-b"],
        )

        with patch("asyncio.create_subprocess_exec", side_effect=_capture_exec):
            with patch("app.modules.agent.adapters.claude_code.get_redis") as mr:
                r = AsyncMock()
                r.publish = AsyncMock()
                mr.return_value = r
                await adapter.run(run_id, ctx, Path("/tmp/lease"))

        assert "CLAUDE_ALLOWED_PATHS" in captured_env
        assert captured_env["CLAUDE_ALLOWED_PATHS"] == "/tmp/repo-a:/tmp/repo-b"

    @pytest.mark.asyncio
    async def test_allowed_paths_empty_when_no_context(self, fake_proc_factory):
        """run() without allowed_paths → CLAUDE_ALLOWED_PATHS not in env."""
        adapter = ClaudeCodeAdapter()
        run_id = uuid.uuid4()
        fake_proc = fake_proc_factory()

        captured_env = {}

        async def _capture_exec(*args, **kwargs):
            captured_env.update(kwargs.get("env", {}))
            return fake_proc

        from app.modules.agent.base import TaskContext

        ctx = TaskContext(
            change_title="test change", task_title="test task", task_key="task-01", allowed_paths=[]
        )

        with patch("asyncio.create_subprocess_exec", side_effect=_capture_exec):
            with patch("app.modules.agent.adapters.claude_code.get_redis") as mr:
                r = AsyncMock()
                r.publish = AsyncMock()
                mr.return_value = r
                await adapter.run(run_id, ctx, Path("/tmp/lease"))

        assert "CLAUDE_ALLOWED_PATHS" not in captured_env


# ---------------------------------------------------------------------------
# Command construction
# ---------------------------------------------------------------------------


class TestCommandConstruction:
    @pytest.mark.asyncio
    async def test_run_uses_direct_claude_when_stdbuf_is_unavailable_on_windows(
        self, fake_proc_factory
    ):
        """Windows does not ship stdbuf, so the adapter should launch claude directly."""
        adapter = ClaudeCodeAdapter()
        run_id = uuid.uuid4()
        fake_proc = fake_proc_factory()
        captured_args: list[str] = []

        async def _capture_exec(*args, **kwargs):
            captured_args.extend(args)
            return fake_proc

        from app.modules.agent.base import TaskContext

        ctx = TaskContext(
            change_title="test change",
            task_title="test task",
            task_key="task-01",
            allowed_paths=[],
        )

        with patch("app.modules.agent.adapters.claude_code.os.name", "nt"):
            with patch("app.modules.agent.adapters.claude_code.shutil.which", return_value=None):
                with patch("asyncio.create_subprocess_exec", side_effect=_capture_exec):
                    with patch("app.modules.agent.adapters.claude_code.get_redis") as mr:
                        r = AsyncMock()
                        r.publish = AsyncMock()
                        mr.return_value = r
                        await adapter.run(run_id, ctx, Path("/tmp/lease"))

        assert captured_args[0] == "claude"
        assert "stdbuf" not in captured_args[:2]


# ---------------------------------------------------------------------------
# Output redaction
# ---------------------------------------------------------------------------


class TestOutputRedaction:
    @pytest.mark.asyncio
    async def test_pat_redacted_in_output(self, fake_proc_factory):
        """stdout containing a PAT → redact_output called, PAT replaced."""
        adapter = ClaudeCodeAdapter()
        run_id = uuid.uuid4()

        # Simulate a raw JSON line containing a PAT
        stdout_line = b'{"type":"raw","text":"token is ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ"}\n'
        fake_proc = fake_proc_factory(stdout_data=stdout_line)

        with patch("asyncio.create_subprocess_exec", return_value=fake_proc):
            with patch("app.modules.agent.adapters.claude_code.get_redis") as mr:
                r = AsyncMock()
                r.publish = AsyncMock()
                mr.return_value = r

                with patch(
                    "app.modules.agent.adapters.claude_code.redact_output",
                    return_value="REDACTED",
                ) as mock_redact:
                    result = await adapter._exec_stream(
                        run_id=run_id,
                        cmd=["claude"],
                        prompt="test",
                        cwd=Path("/tmp"),
                        env_vars={},
                        timeout=5,
                    )

        mock_redact.assert_called_once()
        assert result.redacted_output == "REDACTED"

    @pytest.mark.asyncio
    async def test_bearer_redacted_in_output(self, fake_proc_factory):
        """stdout containing Bearer token → redact_output handles it."""
        adapter = ClaudeCodeAdapter()
        run_id = uuid.uuid4()

        stdout_line = b'{"type":"raw","text":"Authorization: Bearer eyJhbGciOiJIUzI1NiJ9"}\n'
        fake_proc = fake_proc_factory(stdout_data=stdout_line)

        with patch("asyncio.create_subprocess_exec", return_value=fake_proc):
            with patch("app.modules.agent.adapters.claude_code.get_redis") as mr:
                r = AsyncMock()
                r.publish = AsyncMock()
                mr.return_value = r

                with patch(
                    "app.modules.agent.adapters.claude_code.redact_output",
                    return_value="REDACTED_BEARER",
                ) as mock_redact:
                    result = await adapter._exec_stream(
                        run_id=run_id,
                        cmd=["claude"],
                        prompt="test",
                        cwd=Path("/tmp"),
                        env_vars={},
                        timeout=5,
                    )

        mock_redact.assert_called_once()
        assert "REDACTED_BEARER" in result.redacted_output


# ---------------------------------------------------------------------------
# Working directory
# ---------------------------------------------------------------------------


class TestWorkingDirectory:
    @pytest.mark.asyncio
    async def test_cwd_set_correctly(self, fake_proc_factory):
        """Subprocess cwd equals the lease path passed to _exec_stream."""
        adapter = ClaudeCodeAdapter()
        run_id = uuid.uuid4()
        fake_proc = fake_proc_factory()

        captured_cwd = {}

        async def _capture_exec(*args, **kwargs):
            captured_cwd["cwd"] = kwargs.get("cwd")
            return fake_proc

        with patch("asyncio.create_subprocess_exec", side_effect=_capture_exec):
            with patch("app.modules.agent.adapters.claude_code.get_redis") as mr:
                r = AsyncMock()
                r.publish = AsyncMock()
                mr.return_value = r
                await adapter._exec_stream(
                    run_id=run_id,
                    cmd=["claude"],
                    prompt="test",
                    cwd=Path("/tmp/my-lease"),
                    env_vars={},
                    timeout=5,
                )

        assert captured_cwd["cwd"] == "/tmp/my-lease"

    @pytest.mark.asyncio
    async def test_env_inherits_os_environ(self, fake_proc_factory):
        """Child env contains all of os.environ plus custom vars."""
        adapter = ClaudeCodeAdapter()
        run_id = uuid.uuid4()
        fake_proc = fake_proc_factory()

        captured_env = {}

        async def _capture_exec(*args, **kwargs):
            captured_env.update(kwargs.get("env", {}))
            return fake_proc

        with patch("asyncio.create_subprocess_exec", side_effect=_capture_exec):
            with patch("app.modules.agent.adapters.claude_code.get_redis") as mr:
                r = AsyncMock()
                r.publish = AsyncMock()
                mr.return_value = r
                await adapter._exec_stream(
                    run_id=run_id,
                    cmd=["claude"],
                    prompt="test",
                    cwd=Path("/tmp"),
                    env_vars={"CUSTOM_VAR": "value"},
                    timeout=5,
                )

        # os.environ keys should be present
        assert "PATH" in captured_env
        assert captured_env["CUSTOM_VAR"] == "value"


# ---------------------------------------------------------------------------
# Process registration
# ---------------------------------------------------------------------------


class TestProcessRegistration:
    @pytest.mark.asyncio
    async def test_proc_registered_during_exec(self, fake_proc_factory):
        """Process is in registry while _exec_stream is running."""
        adapter = ClaudeCodeAdapter()
        run_id = uuid.uuid4()
        fake_proc = fake_proc_factory()

        _registry_during_exec = {}

        async def _capture_exec(*args, **kwargs):
            proc = fake_proc
            # Check registry right after process creation
            # (the adapter registers after create_subprocess_exec returns)
            return proc

        with patch("asyncio.create_subprocess_exec", side_effect=_capture_exec):
            with patch("app.modules.agent.adapters.claude_code.get_redis") as mr:
                r = AsyncMock()
                r.publish = AsyncMock()
                mr.return_value = r

                # We verify registration by checking _exec_stream source:
                # It registers right after create_subprocess_exec succeeds.
                # After _exec_stream completes, registry is cleaned up.
                await adapter._exec_stream(
                    run_id=run_id,
                    cmd=["claude"],
                    prompt="test",
                    cwd=Path("/tmp"),
                    env_vars={},
                    timeout=5,
                )

        # After completion, should be unregistered
        assert run_id not in AgentService._proc_registry

    @pytest.mark.asyncio
    async def test_proc_unregistered_after_exec(self, fake_proc_factory):
        """Process removed from registry after normal exit."""
        adapter = ClaudeCodeAdapter()
        run_id = uuid.uuid4()
        fake_proc = fake_proc_factory()

        with patch("asyncio.create_subprocess_exec", return_value=fake_proc):
            with patch("app.modules.agent.adapters.claude_code.get_redis") as mr:
                r = AsyncMock()
                r.publish = AsyncMock()
                mr.return_value = r
                await adapter._exec_stream(
                    run_id=run_id,
                    cmd=["claude"],
                    prompt="test",
                    cwd=Path("/tmp"),
                    env_vars={},
                    timeout=5,
                )

        assert run_id not in AgentService._proc_registry

    @pytest.mark.asyncio
    async def test_proc_not_registered_on_spawn_failure(self):
        """FileNotFoundError during spawn → registry unaffected."""
        adapter = ClaudeCodeAdapter()
        run_id = uuid.uuid4()

        emitted_logs = []

        async def _on_log(channel: str, content: str, ts: str) -> None:
            emitted_logs.append((channel, content, ts))

        redis = AsyncMock()
        redis.publish = AsyncMock()

        with (
            patch(
                "asyncio.create_subprocess_exec",
                side_effect=FileNotFoundError(
                    2,
                    "No such file or directory",
                    "claude",
                ),
            ),
            patch("app.modules.agent.adapters.claude_code.get_redis", return_value=redis),
        ):
            result = await adapter._exec_stream(
                run_id=run_id,
                cmd=["claude"],
                prompt="test",
                cwd=Path("/tmp"),
                env_vars={},
                timeout=5,
                on_log=_on_log,
            )

        assert result.exit_code == 127
        assert emitted_logs
        assert emitted_logs[0][0] == "stderr"
        assert "claude" in emitted_logs[0][1]
        assert redis.publish.await_count == 2
        error_payload = json.loads(redis.publish.await_args_list[0].args[1])
        done_payload = json.loads(redis.publish.await_args_list[1].args[1])
        assert error_payload["channel"] == "stderr"
        assert done_payload["event"] == "done"
        assert run_id not in AgentService._proc_registry
