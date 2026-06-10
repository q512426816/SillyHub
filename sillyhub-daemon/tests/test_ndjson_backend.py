"""Tests for NdjsonBackend — opencode/openclaw/pi NDJSON protocol backend.

Design reference: task-06 TDD steps 8-13.
"""

import json

from sillyhub_daemon.backends import AgentBackend


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_ndjson_line(event_type: str, **fields) -> str:
    """Build an NDJSON line string for opencode-style events."""
    obj: dict = {"type": event_type}
    obj.update(fields)
    return json.dumps(obj)


def _import_backend():
    """Lazy import."""
    from sillyhub_daemon.backends.ndjson import NdjsonBackend

    return NdjsonBackend


def _new_backend(provider: str = "opencode"):
    """Create a fresh NdjsonBackend instance."""
    return _import_backend()(provider=provider)


# ---------------------------------------------------------------------------
# TDD 8: build_args — opencode launch command
# ---------------------------------------------------------------------------


class TestNdjsonBuildArgs:
    """Verify opencode/openclaw/pi startup command assembly."""

    def test_build_args_opencode_basic(self):
        backend = _new_backend("opencode")
        args = backend.build_args(task_prompt="fix the bug")
        assert "run" in args
        assert "--format" in args
        idx = args.index("--format")
        assert args[idx + 1] == "json"
        assert "--dangerously-skip-permissions" in args
        # prompt should be the last argument
        assert args[-1] == "fix the bug"

    def test_build_args_with_dir(self):
        backend = _new_backend("opencode")
        args = backend.build_args(
            task_prompt="test",
            work_dir="/home/user/project",
        )
        assert "--dir" in args
        idx = args.index("--dir")
        assert args[idx + 1] == "/home/user/project"

    def test_build_args_with_model(self):
        backend = _new_backend("opencode")
        args = backend.build_args(
            task_prompt="test",
            model="claude-4-sonnet",
        )
        assert "--model" in args
        idx = args.index("--model")
        assert args[idx + 1] == "claude-4-sonnet"

    def test_build_args_with_session_id(self):
        backend = _new_backend("opencode")
        args = backend.build_args(
            task_prompt="test",
            session_id="sess-456",
        )
        assert "--session" in args
        idx = args.index("--session")
        assert args[idx + 1] == "sess-456"

    def test_build_args_provider_openclaw(self):
        backend = _new_backend("openclaw")
        args = backend.build_args(task_prompt="test")
        # openclaw uses the same pattern
        assert "run" in args
        assert "--format" in args

    def test_build_args_provider_pi(self):
        backend = _new_backend("pi")
        args = backend.build_args(task_prompt="test")
        assert "run" in args
        assert "--format" in args


# ---------------------------------------------------------------------------
# TDD 9: parse_output — text event
# ---------------------------------------------------------------------------


class TestNdjsonParseTextEvent:
    """Verify text event parsing."""

    def test_parse_text_event(self):
        backend = _new_backend()
        line = _make_ndjson_line(
            "text",
            part={"text": "Hello from opencode"},
            sessionID="s1",
        )
        events = backend.parse_output_multi(line)
        assert len(events) == 1
        assert events[0].event_type == "text"
        assert events[0].content == "Hello from opencode"

    def test_parse_text_event_empty_text(self):
        backend = _new_backend()
        line = _make_ndjson_line(
            "text",
            part={"text": ""},
        )
        events = backend.parse_output_multi(line)
        assert events == []

    def test_parse_text_event_accumulates_output(self):
        backend = _new_backend()

        backend.parse_output_multi(
            _make_ndjson_line(
                "text",
                part={"text": "Line 1"},
            )
        )
        backend.parse_output_multi(
            _make_ndjson_line(
                "text",
                part={"text": "Line 2"},
            )
        )

        assert backend._state.output == "Line 1Line 2"


# ---------------------------------------------------------------------------
# TDD 10: parse_output — tool_use event
# ---------------------------------------------------------------------------


class TestNdjsonParseToolUseEvent:
    """Verify tool_use event parsing with combined call+result."""

    def test_parse_tool_use_call_only(self):
        backend = _new_backend()
        line = _make_ndjson_line(
            "tool_use",
            part={
                "tool": "Bash",
                "callID": "call-1",
                "state": {
                    "status": "running",
                    "input": {"command": "ls -la"},
                },
            },
        )
        events = backend.parse_output_multi(line)
        assert len(events) == 1
        assert events[0].event_type == "tool_use"
        assert events[0].tool_name == "Bash"
        assert events[0].call_id == "call-1"
        assert events[0].tool_input == {"command": "ls -la"}

    def test_parse_tool_use_completed_emits_result(self):
        """When state.status == 'completed', emit both tool_use and tool_result."""
        backend = _new_backend()
        line = _make_ndjson_line(
            "tool_use",
            part={
                "tool": "Read",
                "callID": "call-2",
                "state": {
                    "status": "completed",
                    "input": {"file_path": "/tmp/x.py"},
                    "output": "file contents here",
                },
            },
        )

        events = backend.parse_output_multi(line)
        assert len(events) == 2

        # First event: tool_use
        assert events[0].event_type == "tool_use"
        assert events[0].tool_name == "Read"
        assert events[0].call_id == "call-2"

        # Second event: tool_result
        assert events[1].event_type == "tool_result"
        assert events[1].call_id == "call-2"
        assert events[1].tool_output == "file contents here"


# ---------------------------------------------------------------------------
# TDD 11: parse_output — error event
# ---------------------------------------------------------------------------


class TestNdjsonParseErrorEvent:
    """Verify error event parsing."""

    def test_parse_error_event(self):
        backend = _new_backend()
        line = _make_ndjson_line(
            "error",
            error={"name": "ModelError", "data": {"message": "invalid model"}},
        )
        events = backend.parse_output_multi(line)
        assert len(events) == 1
        assert events[0].event_type == "error"
        assert events[0].content == "invalid model"
        assert backend._state.final_status == "failed"

    def test_parse_error_event_with_name_only(self):
        backend = _new_backend()
        line = _make_ndjson_line(
            "error",
            error={"name": "FatalError"},
        )
        events = backend.parse_output_multi(line)
        assert len(events) == 1
        assert events[0].event_type == "error"
        assert events[0].content == "FatalError"


# ---------------------------------------------------------------------------
# TDD 12: parse_output — step_start and step_finish
# ---------------------------------------------------------------------------


class TestNdjsonParseStepEvents:
    """Verify step_start and step_finish event parsing."""

    def test_parse_step_start(self):
        backend = _new_backend()
        line = _make_ndjson_line("step_start", part={})
        events = backend.parse_output_multi(line)
        assert len(events) == 1
        assert events[0].event_type == "status"
        assert events[0].status == "running"

    def test_parse_step_finish_accumulates_tokens(self):
        backend = _new_backend()
        line = _make_ndjson_line(
            "step_finish",
            part={
                "tokens": {
                    "input": 100,
                    "output": 50,
                    "cache": {"read": 20, "write": 10},
                },
            },
        )
        events = backend.parse_output_multi(line)
        assert events == []  # step_finish returns no AgentEvent

        assert backend._state.usage["input_tokens"] == 100
        assert backend._state.usage["output_tokens"] == 50
        assert backend._state.usage["cache_read_tokens"] == 20
        assert backend._state.usage["cache_write_tokens"] == 10

    def test_parse_step_finish_accumulates_across_multiple_steps(self):
        backend = _new_backend()

        backend.parse_output_multi(
            _make_ndjson_line(
                "step_finish",
                part={"tokens": {"input": 100, "output": 50}},
            )
        )
        backend.parse_output_multi(
            _make_ndjson_line(
                "step_finish",
                part={"tokens": {"input": 200, "output": 100}},
            )
        )

        assert backend._state.usage["input_tokens"] == 300
        assert backend._state.usage["output_tokens"] == 150

    def test_session_id_extraction(self):
        backend = _new_backend()
        line = _make_ndjson_line(
            "text",
            part={"text": "hi"},
            sessionID="sess-ndjson-1",
        )
        backend.parse_output_multi(line)
        assert backend._state.session_id == "sess-ndjson-1"


# ---------------------------------------------------------------------------
# Edge cases
# ---------------------------------------------------------------------------


class TestNdjsonEdgeCases:
    """Edge case handling."""

    def test_empty_line_skipped(self):
        backend = _new_backend()
        events = backend.parse_output_multi("")
        assert events == []

    def test_invalid_json_skipped(self):
        backend = _new_backend()
        events = backend.parse_output_multi("not json")
        assert events == []

    def test_unknown_event_type_skipped(self):
        backend = _new_backend()
        line = _make_ndjson_line("unknown_event", part={})
        events = backend.parse_output_multi(line)
        assert events == []

    def test_provider_attribute_opencode(self):
        backend = _new_backend("opencode")
        assert backend.provider == "opencode"

    def test_provider_attribute_openclaw(self):
        backend = _new_backend("openclaw")
        assert backend.provider == "openclaw"

    def test_provider_attribute_pi(self):
        backend = _new_backend("pi")
        assert backend.provider == "pi"

    def test_is_subclass_of_agent_backend(self):
        NdjsonBackend = _import_backend()
        assert issubclass(NdjsonBackend, AgentBackend)

    def test_tool_use_with_dict_output(self):
        """Tool output can be a dict — should be JSON-serialized."""
        backend = _new_backend()
        line = _make_ndjson_line(
            "tool_use",
            part={
                "tool": "Grep",
                "callID": "call-3",
                "state": {
                    "status": "completed",
                    "input": {},
                    "output": {"matches": ["line1", "line2"]},
                },
            },
        )
        events = backend.parse_output_multi(line)
        assert len(events) == 2
        assert events[1].event_type == "tool_result"
        # Dict output should be JSON-serialized
        parsed = json.loads(events[1].tool_output)
        assert parsed == {"matches": ["line1", "line2"]}
