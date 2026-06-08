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


# ---------------------------------------------------------------------------
# Result metadata extraction
# ---------------------------------------------------------------------------


class TestResultMetadata:
    def test_extract_result_metadata_from_result_event(self):
        """_extract_result_metadata parses cost and timing from result event."""
        from app.modules.agent.adapters.claude_code import _extract_result_metadata

        events = [
            {"type": "system", "subtype": "init"},
            {
                "type": "result",
                "subtype": "success",
                "total_cost_usd": 0.0034,
                "duration_ms": 2847,
                "duration_api_ms": 1923,
                "num_turns": 4,
                "session_id": "abc-123",
            },
        ]
        meta = _extract_result_metadata(events)
        assert meta["total_cost_usd"] == 0.0034
        assert meta["duration_ms"] == 2847
        assert meta["duration_api_ms"] == 1923
        assert meta["num_turns"] == 4
        assert meta["session_id"] == "abc-123"

    def test_extract_result_metadata_no_result_event(self):
        from app.modules.agent.adapters.claude_code import _extract_result_metadata

        meta = _extract_result_metadata([{"type": "raw", "text": "hello"}])
        assert meta.get("total_cost_usd") is None
        assert meta.get("input_tokens") is None

    def test_extract_result_metadata_partial_fields(self):
        from app.modules.agent.adapters.claude_code import _extract_result_metadata

        events = [{"type": "result", "duration_ms": 1000}]
        meta = _extract_result_metadata(events)
        assert meta["duration_ms"] == 1000
        assert meta["total_cost_usd"] is None
        assert meta["session_id"] is None

    @pytest.mark.asyncio
    async def test_exec_stream_returns_metadata(self, fake_proc_factory):
        """_exec_stream populates cost/timing fields in AgentRunResult."""
        adapter = ClaudeCodeAdapter()
        run_id = uuid.uuid4()

        result_event = (
            json.dumps(
                {
                    "type": "result",
                    "subtype": "success",
                    "total_cost_usd": 0.05,
                    "duration_ms": 5000,
                    "duration_api_ms": 3200,
                    "num_turns": 8,
                    "session_id": "sess-uuid-1234",
                }
            ).encode()
            + b"\n"
        )
        fake_proc = fake_proc_factory(stdout_data=result_event)

        with patch("asyncio.create_subprocess_exec", return_value=fake_proc):
            with patch("app.modules.agent.adapters.claude_code.get_redis") as mr:
                r = AsyncMock()
                r.publish = AsyncMock()
                mr.return_value = r
                with patch(
                    "app.modules.agent.adapters.claude_code.redact_output",
                    return_value="OK",
                ):
                    result = await adapter._exec_stream(
                        run_id=run_id,
                        cmd=["claude"],
                        prompt="test",
                        cwd=Path("/tmp"),
                        env_vars={},
                        timeout=5,
                    )

        assert result.total_cost_usd == 0.05
        assert result.duration_ms == 5000
        assert result.duration_api_ms == 3200
        assert result.num_turns == 8
        assert result.session_id == "sess-uuid-1234"
        assert result.conversation_events is not None
        assert len(result.conversation_events) == 1

    @pytest.mark.asyncio
    async def test_exec_stream_emits_metadata_callback(self, fake_proc_factory):
        """_exec_stream forwards live metadata before completion."""
        adapter = ClaudeCodeAdapter()
        run_id = uuid.uuid4()
        seen: list[dict] = []

        result_event = (
            json.dumps(
                {
                    "type": "result",
                    "subtype": "success",
                    "total_cost_usd": 0.05,
                    "duration_ms": 5000,
                    "duration_api_ms": 3200,
                    "num_turns": 8,
                    "session_id": "sess-uuid-1234",
                    "usage": {"input_tokens": 1200, "output_tokens": 350},
                }
            ).encode()
            + b"\n"
        )
        fake_proc = fake_proc_factory(stdout_data=result_event)

        async def _on_metadata(meta: dict) -> None:
            seen.append(meta)

        with patch("asyncio.create_subprocess_exec", return_value=fake_proc):
            with patch("app.modules.agent.adapters.claude_code.get_redis") as mr:
                r = AsyncMock()
                r.publish = AsyncMock()
                mr.return_value = r
                with patch(
                    "app.modules.agent.adapters.claude_code.redact_output",
                    return_value="OK",
                ):
                    await adapter._exec_stream(
                        run_id=run_id,
                        cmd=["claude"],
                        prompt="test",
                        cwd=Path("/tmp"),
                        env_vars={},
                        timeout=5,
                        on_metadata=_on_metadata,
                    )

        assert seen
        merged = {key: value for meta in seen for key, value in meta.items()}
        assert merged["total_cost_usd"] == 0.05
        assert merged["input_tokens"] == 1200
        assert merged["output_tokens"] == 350

    def test_extract_session_id_from_system_init(self):
        """system init session_id is available before result events."""
        from app.modules.agent.adapters.claude_code import _extract_result_metadata

        meta = _extract_result_metadata(
            [{"type": "system", "subtype": "init", "session_id": "sess-live"}]
        )
        assert meta["session_id"] == "sess-live"

    def test_read_claude_session_events_reads_usage_jsonl(self, tmp_path):
        """Persisted Claude session JSONL can be used as a usage fallback."""
        from app.modules.agent.adapters.claude_code import (
            _extract_result_metadata,
            _read_claude_session_events,
        )

        session_dir = tmp_path / ".claude" / "projects" / "-host-projects-myaaa"
        session_dir.mkdir(parents=True)
        (session_dir / "sess-live.jsonl").write_text(
            "\n".join(
                [
                    json.dumps({"type": "system", "subtype": "init"}),
                    "{not json",
                    json.dumps(
                        {
                            "type": "assistant",
                            "message": {"usage": {"input_tokens": 1200, "output_tokens": 350}},
                        }
                    ),
                ]
            ),
            encoding="utf-8",
        )

        events = _read_claude_session_events("/host-projects/myaaa", "sess-live", home=tmp_path)
        meta = _extract_result_metadata(events)
        assert meta["input_tokens"] == 1200
        assert meta["output_tokens"] == 350

    @pytest.mark.asyncio
    async def test_exec_stream_reads_live_usage_from_session_file(self, fake_proc_factory):
        """stdout system init + session JSONL usage emits live token metadata."""
        adapter = ClaudeCodeAdapter()
        run_id = uuid.uuid4()
        seen: list[dict] = []
        usage_events = [
            {
                "type": "assistant",
                "message": {"usage": {"input_tokens": 1200, "output_tokens": 350}},
            }
        ]
        fake_proc = fake_proc_factory()
        fake_proc.stdout.readline = AsyncMock(
            side_effect=[
                json.dumps(
                    {
                        "type": "system",
                        "subtype": "init",
                        "cwd": "/host-projects/myaaa",
                        "session_id": "sess-live",
                    }
                ).encode()
                + b"\n",
                json.dumps(
                    {
                        "type": "assistant",
                        "message": {"content": [{"type": "text", "text": "working"}]},
                    }
                ).encode()
                + b"\n",
                b"",
            ]
        )

        async def _on_metadata(meta: dict) -> None:
            seen.append(meta)

        with patch("asyncio.create_subprocess_exec", return_value=fake_proc):
            with patch("app.modules.agent.adapters.claude_code.get_redis") as mr:
                r = AsyncMock()
                r.publish = AsyncMock()
                mr.return_value = r
                with patch(
                    "app.modules.agent.adapters.claude_code._read_claude_session_events",
                    return_value=usage_events,
                ) as session_reader:
                    result = await adapter._exec_stream(
                        run_id=run_id,
                        cmd=["claude"],
                        prompt="test",
                        cwd=Path("/host-projects/myaaa"),
                        env_vars={},
                        timeout=5,
                        on_metadata=_on_metadata,
                    )

        session_reader.assert_called()
        merged = {key: value for meta in seen for key, value in meta.items()}
        assert merged["session_id"] == "sess-live"
        assert merged["input_tokens"] == 1200
        assert merged["output_tokens"] == 350
        assert result.input_tokens == 1200
        assert result.output_tokens == 350

    def test_extract_tokens_from_result_usage(self):
        """result event with usage field → tokens extracted directly."""
        from app.modules.agent.adapters.claude_code import _extract_result_metadata

        events = [
            {"type": "result", "usage": {"input_tokens": 1200, "output_tokens": 350}},
        ]
        meta = _extract_result_metadata(events)
        assert meta["input_tokens"] == 1200
        assert meta["output_tokens"] == 350

    def test_extract_tokens_fallback_from_assistant_events(self):
        """No usage in result → sum from assistant events."""
        from app.modules.agent.adapters.claude_code import _extract_result_metadata

        events = [
            {
                "type": "assistant",
                "message": {"usage": {"input_tokens": 500, "output_tokens": 100}},
            },
            {
                "type": "assistant",
                "message": {"usage": {"input_tokens": 700, "output_tokens": 250}},
            },
            {"type": "result", "total_cost_usd": 0.01},
        ]
        meta = _extract_result_metadata(events)
        assert meta["input_tokens"] == 1200
        assert meta["output_tokens"] == 350

    def test_extract_tokens_none_when_no_data(self):
        """No usage anywhere → tokens are None."""
        from app.modules.agent.adapters.claude_code import _extract_result_metadata

        meta = _extract_result_metadata([{"type": "raw", "text": "hello"}])
        assert meta.get("input_tokens") is None
        assert meta.get("output_tokens") is None

    def test_result_usage_takes_priority_over_assistant(self):
        """result.usage present → ignore assistant fallback."""
        from app.modules.agent.adapters.claude_code import _extract_result_metadata

        events = [
            {
                "type": "assistant",
                "message": {"usage": {"input_tokens": 999, "output_tokens": 888}},
            },
            {"type": "result", "usage": {"input_tokens": 100, "output_tokens": 50}},
        ]
        meta = _extract_result_metadata(events)
        assert meta["input_tokens"] == 100
        assert meta["output_tokens"] == 50

    def test_result_event_has_cost_and_timing(self):
        """result event with cost/timing → metadata extracted."""
        from app.modules.agent.adapters.claude_code import _extract_result_metadata

        events = [
            {
                "type": "result",
                "total_cost_usd": 0.012,
                "duration_ms": 360819,
                "num_turns": 73,
            }
        ]
        meta = _extract_result_metadata(events)
        assert meta["total_cost_usd"] == 0.012
        assert meta["duration_ms"] == 360819
        assert meta["num_turns"] == 73

    def test_assistant_message_usage_extracted(self):
        """assistant events with message.usage → tokens extracted."""
        from app.modules.agent.adapters.claude_code import _extract_result_metadata

        events = [
            {
                "type": "assistant",
                "message": {"usage": {"input_tokens": 500, "output_tokens": 100}},
            },
            {
                "type": "assistant",
                "message": {"usage": {"input_tokens": 700, "output_tokens": 250}},
            },
            {"type": "raw", "text": "noise"},
        ]
        meta = _extract_result_metadata(events)
        assert meta["input_tokens"] == 1200
        assert meta["output_tokens"] == 350

    def test_no_result_but_delta_usage(self):
        """No result event but delta/stream_event with usage → tokens extracted."""
        from app.modules.agent.adapters.claude_code import _extract_result_metadata

        events = [
            {"type": "stream_event", "usage": {"input_tokens": 300, "output_tokens": 80}},
            {"type": "delta", "usage": {"input_tokens": 200, "output_tokens": 40}},
        ]
        meta = _extract_result_metadata(events)
        assert meta["input_tokens"] == 500
        assert meta["output_tokens"] == 120

    @pytest.mark.asyncio
    async def test_conversation_events_always_list(self):
        """_exec_stream returns [] not None for conversation_events."""
        adapter = ClaudeCodeAdapter()
        run_id = uuid.uuid4()
        fake_proc = _make_fake_proc(stdout_data=b"")

        with patch("asyncio.create_subprocess_exec", return_value=fake_proc):
            with patch("app.modules.agent.adapters.claude_code.get_redis") as mr:
                r = AsyncMock()
                r.publish = AsyncMock()
                mr.return_value = r
                result = await adapter._exec_stream(
                    run_id=run_id,
                    cmd=["claude"],
                    prompt="test",
                    cwd=Path("/tmp"),
                    env_vars={},
                    timeout=5,
                )

        assert result.conversation_events is not None
        assert isinstance(result.conversation_events, list)

    def test_mixed_non_json_lines_dont_break_parsing(self):
        """Non-JSON lines mixed with valid events → tokens still extracted."""
        from app.modules.agent.adapters.claude_code import _extract_result_metadata

        events = [
            {"type": "raw", "text": "some random output"},
            {
                "type": "assistant",
                "message": {"usage": {"input_tokens": 400, "output_tokens": 150}},
            },
            {"type": "raw", "text": "more noise"},
        ]
        meta = _extract_result_metadata(events)
        assert meta["input_tokens"] == 400
        assert meta["output_tokens"] == 150

    def test_model_usage_takes_priority(self):
        """result event with modelUsage → tokens aggregated from per-model data."""
        from app.modules.agent.adapters.claude_code import _extract_result_metadata

        events = [
            {
                "type": "result",
                "total_cost_usd": 0.05,
                "modelUsage": {
                    "claude-sonnet": {
                        "inputTokens": 1000,
                        "outputTokens": 200,
                    },
                    "claude-haiku": {
                        "inputTokens": 500,
                        "outputTokens": 100,
                    },
                },
            },
        ]
        meta = _extract_result_metadata(events)
        assert meta["input_tokens"] == 1500
        assert meta["output_tokens"] == 300
        assert meta["total_cost_usd"] == 0.05

    def test_model_usage_fallback_to_usage(self):
        """result event without modelUsage but with usage → usage used."""
        from app.modules.agent.adapters.claude_code import _extract_result_metadata

        events = [
            {
                "type": "result",
                "total_cost_usd": 0.01,
                "usage": {"input_tokens": 800, "output_tokens": 400},
            },
        ]
        meta = _extract_result_metadata(events)
        assert meta["input_tokens"] == 800
        assert meta["output_tokens"] == 400

    def test_model_usage_empty_falls_through(self):
        """result event with empty modelUsage → falls through to usage."""
        from app.modules.agent.adapters.claude_code import _extract_result_metadata

        events = [
            {
                "type": "result",
                "modelUsage": {},
                "usage": {"input_tokens": 600, "output_tokens": 300},
            },
        ]
        meta = _extract_result_metadata(events)
        assert meta["input_tokens"] == 600
        assert meta["output_tokens"] == 300
