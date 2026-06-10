"""Tests for JsonlBackend — copilot JSONL dotted-event protocol backend.

Design reference: task-06 TDD steps 1-7.
"""

import json

from sillyhub_daemon.backends import AgentBackend


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_jsonl_line(event_type: str, data: dict | None = None, **extra) -> str:
    """Build a JSONL line string for copilot-style events."""
    obj: dict = {"type": event_type}
    if data is not None:
        obj["data"] = data
    obj.update(extra)
    return json.dumps(obj)


def _import_backend():
    """Lazy import to avoid failures if module doesn't exist yet during TDD."""
    from sillyhub_daemon.backends.jsonl import JsonlBackend

    return JsonlBackend


def _new_backend():
    """Create a fresh JsonlBackend instance."""
    return _import_backend()()


# ---------------------------------------------------------------------------
# TDD 1: build_args — copilot launch command
# ---------------------------------------------------------------------------


class TestJsonlBuildArgs:
    """Verify copilot startup command assembly."""

    def test_build_args_basic(self):
        backend = _new_backend()
        args = backend.build_args(
            task_prompt="hello world",
        )
        assert args[0] == "-p"
        assert args[1] == "hello world"
        assert "--output-format" in args
        idx = args.index("--output-format")
        assert args[idx + 1] == "json"
        assert "--allow-all" in args
        assert "--no-ask-user" in args

    def test_build_args_with_model(self):
        backend = _new_backend()
        args = backend.build_args(
            task_prompt="test",
            model="gpt-5",
        )
        assert "--model" in args
        idx = args.index("--model")
        assert args[idx + 1] == "gpt-5"

    def test_build_args_with_session_id(self):
        backend = _new_backend()
        args = backend.build_args(
            task_prompt="test",
            session_id="sess-123",
        )
        assert "--resume" in args
        idx = args.index("--resume")
        assert args[idx + 1] == "sess-123"

    def test_build_args_no_model_no_session(self):
        backend = _new_backend()
        args = backend.build_args(task_prompt="test")
        assert "--model" not in args
        assert "--resume" not in args


# ---------------------------------------------------------------------------
# TDD 2: parse_output — session.start
# ---------------------------------------------------------------------------


class TestJsonlParseSessionStart:
    """Verify session.start event parsing."""

    def test_parse_session_start(self):
        backend = _new_backend()
        line = _make_jsonl_line(
            "session.start",
            data={"sessionId": "abc-123", "selectedModel": "gpt-4.1"},
        )
        events = backend.parse_output_multi(line)
        assert events == []  # session.start returns no AgentEvent

        # Check internal state
        assert backend._state.session_id == "abc-123"
        assert backend._state.active_model == "gpt-4.1"

    def test_parse_session_start_no_data(self):
        backend = _new_backend()
        line = _make_jsonl_line("session.start")
        events = backend.parse_output_multi(line)
        assert events == []


# ---------------------------------------------------------------------------
# TDD 3: parse_output — assistant.message_delta
# ---------------------------------------------------------------------------


class TestJsonlParseMessageDelta:
    """Verify assistant.message_delta event parsing."""

    def test_parse_message_delta(self):
        backend = _new_backend()
        line = _make_jsonl_line(
            "assistant.message_delta",
            data={"messageId": "m1", "deltaContent": "Hello "},
        )
        events = backend.parse_output_multi(line)
        assert len(events) == 1
        assert events[0].event_type == "text"
        assert events[0].content == "Hello "

    def test_parse_message_delta_accumulates_output(self):
        backend = _new_backend()

        backend.parse_output_multi(
            _make_jsonl_line(
                "assistant.message_delta",
                data={"messageId": "m1", "deltaContent": "Hello "},
            )
        )
        backend.parse_output_multi(
            _make_jsonl_line(
                "assistant.message_delta",
                data={"messageId": "m1", "deltaContent": "World"},
            )
        )

        assert backend._state.output == "Hello World"

    def test_parse_message_delta_empty_content(self):
        backend = _new_backend()
        line = _make_jsonl_line(
            "assistant.message_delta",
            data={"messageId": "m1", "deltaContent": ""},
        )
        events = backend.parse_output_multi(line)
        assert events == []


# ---------------------------------------------------------------------------
# TDD 4: parse_output — assistant.message (full message with output reset)
# ---------------------------------------------------------------------------


class TestJsonlParseMessageFull:
    """Verify assistant.message event parsing with output reset."""

    def test_parse_message_full_resets_output(self):
        """assistant.message resets output to avoid delta double-counting."""
        backend = _new_backend()

        # Simulate deltas arriving first
        backend.parse_output_multi(
            _make_jsonl_line(
                "assistant.message_delta",
                data={"messageId": "m1", "deltaContent": "Hello World"},
            )
        )
        assert backend._state.output == "Hello World"

        # Now the full message arrives
        line = _make_jsonl_line(
            "assistant.message",
            data={
                "messageId": "m1",
                "content": "Hello World",
            },
        )
        backend.parse_output_multi(line)

        # Output should NOT be doubled — reset to authoritative content
        assert backend._state.output == "Hello World"

    def test_parse_message_full_with_tool_requests(self):
        backend = _new_backend()
        line = _make_jsonl_line(
            "assistant.message",
            data={
                "messageId": "m1",
                "content": "",
                "toolRequests": [
                    {
                        "toolCallId": "tc1",
                        "name": "Read",
                        "arguments": {"file_path": "/tmp/x.py"},
                        "type": "tool_call",
                    }
                ],
            },
        )
        events = backend.parse_output_multi(line)
        assert len(events) == 1
        assert events[0].event_type == "tool_use"
        assert events[0].tool_name == "Read"
        assert events[0].call_id == "tc1"
        assert events[0].tool_input == {"file_path": "/tmp/x.py"}

    def test_parse_message_full_with_reasoning(self):
        backend = _new_backend()
        line = _make_jsonl_line(
            "assistant.message",
            data={
                "messageId": "m1",
                "content": "answer",
                "reasoningText": "Let me think...",
            },
        )
        events = backend.parse_output_multi(line)
        # Should return thinking event (reasoning is emitted first)
        assert len(events) == 1
        assert events[0].event_type == "thinking"
        assert events[0].content == "Let me think..."


# ---------------------------------------------------------------------------
# TDD 5: parse_output — tool.execution_complete
# ---------------------------------------------------------------------------


class TestJsonlParseToolComplete:
    """Verify tool.execution_complete event parsing."""

    def test_parse_tool_complete_success(self):
        backend = _new_backend()
        line = _make_jsonl_line(
            "tool.execution_complete",
            data={
                "toolCallId": "tc1",
                "success": True,
                "result": {"content": "file contents here"},
            },
        )
        events = backend.parse_output_multi(line)
        assert len(events) == 1
        assert events[0].event_type == "tool_result"
        assert events[0].call_id == "tc1"
        assert events[0].tool_output == "file contents here"

    def test_parse_tool_complete_error(self):
        backend = _new_backend()
        line = _make_jsonl_line(
            "tool.execution_complete",
            data={
                "toolCallId": "tc2",
                "success": False,
                "error": {"message": "file not found"},
            },
        )
        events = backend.parse_output_multi(line)
        assert len(events) == 1
        assert events[0].event_type == "tool_result"
        assert events[0].call_id == "tc2"
        assert "Error: file not found" in events[0].tool_output


# ---------------------------------------------------------------------------
# TDD 6: parse_output — result (final line)
# ---------------------------------------------------------------------------


class TestJsonlParseResult:
    """Verify result event parsing."""

    def test_parse_result_success(self):
        backend = _new_backend()
        line = json.dumps(
            {
                "type": "result",
                "sessionId": "final-session-1",
                "exitCode": 0,
            }
        )
        events = backend.parse_output_multi(line)
        assert events == []  # result event returns no AgentEvent
        assert backend._state.session_id == "final-session-1"
        assert backend._state.final_status == "completed"

    def test_parse_result_failure_exit_code(self):
        backend = _new_backend()
        line = json.dumps(
            {
                "type": "result",
                "sessionId": "final-session-2",
                "exitCode": 1,
            }
        )
        backend.parse_output_multi(line)
        assert backend._state.final_status == "failed"
        assert "exited with code 1" in backend._state.final_error


# ---------------------------------------------------------------------------
# TDD: Additional edge cases
# ---------------------------------------------------------------------------


class TestJsonlEdgeCases:
    """Edge case handling."""

    def test_empty_line_skipped(self):
        backend = _new_backend()
        events = backend.parse_output_multi("")
        assert events == []

    def test_whitespace_line_skipped(self):
        backend = _new_backend()
        events = backend.parse_output_multi("   ")
        assert events == []

    def test_invalid_json_skipped(self):
        backend = _new_backend()
        events = backend.parse_output_multi("not valid json at all")
        assert events == []

    def test_unknown_event_type_skipped(self):
        backend = _new_backend()
        line = _make_jsonl_line("unknown.event.type", data={"foo": "bar"})
        events = backend.parse_output_multi(line)
        assert events == []

    def test_session_error(self):
        backend = _new_backend()
        line = _make_jsonl_line(
            "session.error",
            data={"errorType": "fatal", "message": "OOM killed"},
        )
        events = backend.parse_output_multi(line)
        assert len(events) == 1
        assert events[0].event_type == "error"
        assert events[0].content == "OOM killed"
        assert backend._state.final_status == "failed"

    def test_session_warning(self):
        backend = _new_backend()
        line = _make_jsonl_line(
            "session.warning",
            data={"warningType": "deprecation", "message": "model deprecated"},
        )
        events = backend.parse_output_multi(line)
        assert len(events) == 1
        assert events[0].event_type == "status"
        assert events[0].content == "model deprecated"
        assert events[0].level == "warn"

    def test_assistant_turn_start(self):
        backend = _new_backend()
        line = _make_jsonl_line("assistant.turn_start", data={})
        events = backend.parse_output_multi(line)
        assert len(events) == 1
        assert events[0].event_type == "status"
        assert events[0].status == "running"

    def test_reasoning_event(self):
        backend = _new_backend()
        line = _make_jsonl_line(
            "assistant.reasoning",
            data={"content": "I should check the file first"},
        )
        events = backend.parse_output_multi(line)
        assert len(events) == 1
        assert events[0].event_type == "thinking"
        assert events[0].content == "I should check the file first"

    def test_reasoning_delta_event(self):
        backend = _new_backend()
        line = _make_jsonl_line(
            "assistant.reasoning_delta",
            data={"deltaContent": "Hmm"},
        )
        events = backend.parse_output_multi(line)
        assert len(events) == 1
        assert events[0].event_type == "thinking"
        assert events[0].content == "Hmm"

    def test_provider_attribute(self):
        backend = _new_backend()
        assert backend.provider == "copilot"

    def test_is_subclass_of_agent_backend(self):
        JsonlBackend = _import_backend()
        assert issubclass(JsonlBackend, AgentBackend)

    def test_full_flow_accumulated_output(self):
        """Simulate a full copilot session flow and verify output accumulation."""
        backend = _new_backend()

        # session.start
        backend.parse_output_multi(
            _make_jsonl_line(
                "session.start",
                data={"sessionId": "sess-flow", "selectedModel": "gpt-4.1"},
            )
        )
        # delta
        backend.parse_output_multi(
            _make_jsonl_line(
                "assistant.message_delta",
                data={"deltaContent": "Hello"},
            )
        )
        # full message (reset)
        backend.parse_output_multi(
            _make_jsonl_line(
                "assistant.message",
                data={"messageId": "m1", "content": "Hello"},
            )
        )
        # result
        backend.parse_output_multi(
            json.dumps(
                {
                    "type": "result",
                    "sessionId": "sess-flow",
                    "exitCode": 0,
                }
            )
        )

        assert backend._state.output == "Hello"
        assert backend._state.session_id == "sess-flow"
        assert backend._state.final_status == "completed"
