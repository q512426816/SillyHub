"""Tests for TextBackend — antigravity plain text stdout protocol backend.

Design reference: task-06 TDD steps 14-16.
"""

from sillyhub_daemon.backends import AgentBackend


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _import_backend():
    """Lazy import."""
    from sillyhub_daemon.backends.text import TextBackend

    return TextBackend


def _new_backend():
    """Create a fresh TextBackend instance."""
    return _import_backend()()


# ---------------------------------------------------------------------------
# TDD 14: build_args — agy launch command
# ---------------------------------------------------------------------------


class TestTextBuildArgs:
    """Verify antigravity (agy) startup command assembly."""

    def test_build_args_basic(self):
        backend = _new_backend()
        args = backend.build_args(task_prompt="do something")
        assert "-p" in args
        idx = args.index("-p")
        assert args[idx + 1] == "do something"
        assert "--dangerously-skip-permissions" in args

    def test_build_args_with_model(self):
        backend = _new_backend()
        args = backend.build_args(
            task_prompt="test",
            model="Claude Opus 4.6 (Thinking)",
        )
        assert "--model" in args
        idx = args.index("--model")
        assert args[idx + 1] == "Claude Opus 4.6 (Thinking)"

    def test_build_args_with_work_dir(self):
        backend = _new_backend()
        args = backend.build_args(
            task_prompt="test",
            work_dir="/home/user/project",
        )
        assert "--add-dir" in args
        idx = args.index("--add-dir")
        assert args[idx + 1] == "/home/user/project"

    def test_build_args_with_session_id(self):
        backend = _new_backend()
        args = backend.build_args(
            task_prompt="test",
            session_id="conv-789",
        )
        assert "--conversation" in args
        idx = args.index("--conversation")
        assert args[idx + 1] == "conv-789"

    def test_build_args_no_optional_params(self):
        backend = _new_backend()
        args = backend.build_args(task_prompt="test")
        assert "--model" not in args
        assert "--add-dir" not in args
        assert "--conversation" not in args


# ---------------------------------------------------------------------------
# TDD 15: parse_output — plain text line parsing
# ---------------------------------------------------------------------------


class TestTextParseOutput:
    """Verify plain text line parsing."""

    def test_parse_output_non_empty_line(self):
        backend = _new_backend()
        event = backend.parse_line("Hello, I am an agent")
        assert event is not None
        assert event.event_type == "text"
        assert event.content == "Hello, I am an agent"

    def test_parse_output_empty_line_skipped(self):
        backend = _new_backend()
        event = backend.parse_line("")
        assert event is None

    def test_parse_output_whitespace_line_skipped(self):
        backend = _new_backend()
        event = backend.parse_line("   ")
        assert event is None

    def test_parse_output_accumulates_output(self):
        backend = _new_backend()

        backend.parse_line("Line 1")
        backend.parse_line("Line 2")
        backend.parse_line("Line 3")

        assert backend._state.output == "Line 1\nLine 2\nLine 3"

    def test_parse_output_empty_lines_not_in_output(self):
        backend = _new_backend()

        backend.parse_line("Line 1")
        backend.parse_line("")  # empty, skipped
        backend.parse_line("Line 2")

        assert backend._state.output == "Line 1\nLine 2"

    def test_parse_output_non_empty_lines_separated_by_newline(self):
        """Verify that text events between lines are joined by newline."""
        backend = _new_backend()

        event1 = backend.parse_line("First")
        event2 = backend.parse_line("Second")

        assert event1 is not None
        assert event2 is not None
        assert backend._state.output == "First\nSecond"


# ---------------------------------------------------------------------------
# Additional tests
# ---------------------------------------------------------------------------


class TestTextBackendMeta:
    """Meta properties."""

    def test_provider_attribute(self):
        backend = _new_backend()
        assert backend.provider == "antigravity"

    def test_is_subclass_of_agent_backend(self):
        TextBackend = _import_backend()
        assert issubclass(TextBackend, AgentBackend)

    def test_default_binary_name(self):
        backend = _new_backend()
        assert backend.binary_name == "agy"
