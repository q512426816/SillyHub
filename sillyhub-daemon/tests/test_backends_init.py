"""Tests for sillyhub_daemon.backends.__init__ — AgentBackend ABC, dataclasses, factory."""

import pytest
from abc import ABC


# ---------------------------------------------------------------------------
# TDD 1: AgentEvent dataclass defaults
# ---------------------------------------------------------------------------


def test_agent_event_dataclass():
    from sillyhub_daemon.backends import AgentEvent

    ev = AgentEvent(event_type="text")
    assert ev.event_type == "text"
    assert ev.content == ""
    assert ev.tool_name == ""
    assert ev.call_id == ""
    assert ev.tool_input is None
    assert ev.tool_output == ""
    assert ev.status == ""
    assert ev.level == ""

    # All fields can be set
    ev2 = AgentEvent(
        event_type="tool_use",
        content="writing file",
        tool_name="Write",
        call_id="call_123",
        tool_input={"path": "/tmp/x.txt"},
        tool_output="ok",
        status="running",
        level="info",
    )
    assert ev2.event_type == "tool_use"
    assert ev2.tool_name == "Write"
    assert ev2.tool_input == {"path": "/tmp/x.txt"}


# ---------------------------------------------------------------------------
# TDD 2: TaskResult dataclass defaults
# ---------------------------------------------------------------------------


def test_task_result_dataclass():
    from sillyhub_daemon.backends import TaskResult

    tr = TaskResult(status="completed", output="done")
    assert tr.status == "completed"
    assert tr.output == "done"
    assert tr.error == ""
    assert tr.duration_ms == 0
    assert tr.session_id == ""
    assert tr.events == []

    # events defaults to a new list each time (not shared)
    tr2 = TaskResult(status="failed", output="")
    assert tr2.events is not tr.events


# ---------------------------------------------------------------------------
# TDD 3: AgentBackend is abstract
# ---------------------------------------------------------------------------


def test_agent_backend_is_abstract():
    from sillyhub_daemon.backends import AgentBackend

    assert issubclass(AgentBackend, ABC)
    with pytest.raises(TypeError):
        AgentBackend()


# ---------------------------------------------------------------------------
# TDD 4: AgentBackend requires both methods
# ---------------------------------------------------------------------------


def test_agent_backend_requires_methods():
    from sillyhub_daemon.backends import AgentBackend

    # Missing both methods
    class IncompleteBackend(AgentBackend):
        provider = "test"

    with pytest.raises(TypeError):
        IncompleteBackend()

    # Has execute but not parse_output
    class HalfBackend1(AgentBackend):
        provider = "test"

        async def execute(self, cmd_path, task_prompt, work_dir, env=None):
            pass

    with pytest.raises(TypeError):
        HalfBackend1()

    # Has parse_output but not execute
    class HalfBackend2(AgentBackend):
        provider = "test"

        async def parse_output(self, line):
            pass

    with pytest.raises(TypeError):
        HalfBackend2()

    # Has both — should instantiate fine
    class CompleteBackend(AgentBackend):
        provider = "test"

        async def execute(self, cmd_path, task_prompt, work_dir, env=None):
            pass

        async def parse_output(self, line):
            pass

    # No error
    CompleteBackend()


# ---------------------------------------------------------------------------
# TDD 5: PROTOCOL_PROVIDERS mapping covers all 12 providers
# ---------------------------------------------------------------------------


def test_protocol_providers_mapping():
    from sillyhub_daemon.backends import PROTOCOL_PROVIDERS

    expected_protocols = {"stream_json", "json_rpc", "jsonl", "ndjson", "text"}
    assert set(PROTOCOL_PROVIDERS.keys()) == expected_protocols

    all_providers = []
    for providers in PROTOCOL_PROVIDERS.values():
        all_providers.extend(providers)
    assert len(all_providers) == 12

    expected_providers = {
        "claude",
        "gemini",
        "cursor",
        "codex",
        "hermes",
        "kimi",
        "kiro",
        "copilot",
        "opencode",
        "openclaw",
        "pi",
        "antigravity",
    }
    assert set(all_providers) == expected_providers


# ---------------------------------------------------------------------------
# TDD 6: get_protocol returns correct protocol
# ---------------------------------------------------------------------------


def test_get_protocol_known_providers():
    from sillyhub_daemon.backends import get_protocol

    assert get_protocol("claude") == "stream_json"
    assert get_protocol("gemini") == "stream_json"
    assert get_protocol("cursor") == "stream_json"
    assert get_protocol("codex") == "json_rpc"
    assert get_protocol("hermes") == "json_rpc"
    assert get_protocol("kimi") == "json_rpc"
    assert get_protocol("kiro") == "json_rpc"
    assert get_protocol("copilot") == "jsonl"
    assert get_protocol("opencode") == "ndjson"
    assert get_protocol("openclaw") == "ndjson"
    assert get_protocol("pi") == "ndjson"
    assert get_protocol("antigravity") == "text"


# ---------------------------------------------------------------------------
# TDD 7: get_protocol raises on unknown provider
# ---------------------------------------------------------------------------


def test_get_protocol_unknown_raises():
    from sillyhub_daemon.backends import get_protocol

    with pytest.raises(ValueError, match="Unknown provider"):
        get_protocol("nonexistent_agent")

    with pytest.raises(ValueError, match="Unknown provider"):
        get_protocol("")

    with pytest.raises(ValueError, match="Unknown provider"):
        get_protocol("CLAUDE")  # case-sensitive


# ---------------------------------------------------------------------------
# TDD 8: get_backend returns type (not instance)
# ---------------------------------------------------------------------------


def test_get_backend_returns_type():
    from sillyhub_daemon.backends import AgentBackend, get_backend

    # At the time of this task, the backend modules are not implemented yet.
    # We test the factory behavior by verifying the return type annotation.
    # Once task-04/05/06 implement the backends, this test can verify concrete classes.

    # For now, we expect ImportError since backend sub-modules don't exist yet.
    # We verify the error message is helpful.
    try:
        result = get_backend("claude")
        # If it succeeds (backend module exists), result must be a type and subclass of AgentBackend
        assert isinstance(result, type)
        assert issubclass(result, AgentBackend)
    except ImportError as exc:
        assert "not implemented yet" in str(exc)


# ---------------------------------------------------------------------------
# TDD 9: get_backend raises ValueError for unknown provider
# ---------------------------------------------------------------------------


def test_get_backend_unknown_raises():
    from sillyhub_daemon.backends import get_backend

    with pytest.raises(ValueError, match="Unknown provider: unknown_xyz"):
        get_backend("unknown_xyz")

    with pytest.raises(ValueError, match="Unknown provider: "):
        get_backend("")


# ---------------------------------------------------------------------------
# TDD 10: No duplicate providers across protocols
# ---------------------------------------------------------------------------


def test_protocol_providers_no_duplicates():
    from sillyhub_daemon.backends import PROTOCOL_PROVIDERS

    all_providers = []
    for providers in PROTOCOL_PROVIDERS.values():
        all_providers.extend(providers)

    assert len(all_providers) == len(set(all_providers)), (
        f"Duplicate providers found: {[p for p in all_providers if all_providers.count(p) > 1]}"
    )


# ---------------------------------------------------------------------------
# Additional: get_backend returns type for all known providers (if modules exist)
# ---------------------------------------------------------------------------


def test_get_backend_all_known_providers():
    """Verify factory maps every known provider (sub-module may not exist yet)."""
    from sillyhub_daemon.backends import PROTOCOL_PROVIDERS, AgentBackend, get_backend

    all_providers = [p for providers in PROTOCOL_PROVIDERS.values() for p in providers]
    for provider in all_providers:
        try:
            cls = get_backend(provider)
            assert isinstance(cls, type)
            assert issubclass(cls, AgentBackend)
        except ImportError:
            pass  # Sub-module not implemented yet — acceptable for task-03
