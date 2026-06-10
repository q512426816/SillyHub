"""Agent backend abstraction and factory.

Defines the AgentBackend ABC, structured event/result dataclasses,
protocol-provider mapping, and a lazy-import factory for obtaining
the correct backend class per provider.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field


# ---------------------------------------------------------------------------
# Structured data types
# ---------------------------------------------------------------------------


@dataclass
class AgentEvent:
    """A single structured event emitted by an agent during execution."""

    event_type: str  # "text", "tool_use", "tool_result", "thinking", "status", "error"
    content: str = ""
    tool_name: str = ""
    call_id: str = ""
    tool_input: dict | None = None
    tool_output: str = ""
    status: str = ""
    level: str = ""  # for log/error events
    session_id: str = ""  # for system/result events


@dataclass
class TaskResult:
    """The final result of an agent task execution."""

    status: str  # "completed", "failed", "timeout", "aborted"
    output: str  # accumulated text output
    error: str = ""  # error message if failed
    duration_ms: int = 0
    session_id: str = ""
    events: list[AgentEvent] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Abstract base class
# ---------------------------------------------------------------------------


class AgentBackend(ABC):
    """Abstract interface for an agent CLI backend.

    Each concrete backend knows how to:
    - ``execute``: spawn the agent CLI and return a :class:`TaskResult`.
    - ``parse_output``: turn a raw stdout line into a structured :class:`AgentEvent`.
    """

    provider: str  # subclass must set

    @abstractmethod
    async def execute(
        self,
        cmd_path: str,
        task_prompt: str,
        work_dir: str,
        env: dict | None = None,
    ) -> TaskResult:
        """Execute agent CLI and return structured result."""

    @abstractmethod
    async def parse_output(self, line: str) -> AgentEvent | None:
        """Parse a single output line into a structured event."""


# ---------------------------------------------------------------------------
# Protocol → Provider mapping
# ---------------------------------------------------------------------------

PROTOCOL_PROVIDERS: dict[str, list[str]] = {
    "stream_json": ["claude", "gemini", "cursor"],
    "json_rpc": ["codex", "hermes", "kimi", "kiro"],
    "jsonl": ["copilot"],
    "ndjson": ["opencode", "openclaw", "pi"],
    "text": ["antigravity"],
}


# ---------------------------------------------------------------------------
# Helper: reverse lookup
# ---------------------------------------------------------------------------


def get_protocol(provider: str) -> str:
    """Return the protocol name for a known *provider*.

    Raises :class:`ValueError` if *provider* is not in :data:`PROTOCOL_PROVIDERS`.
    """
    for protocol, providers in PROTOCOL_PROVIDERS.items():
        if provider in providers:
            return protocol
    raise ValueError(f"Unknown provider: {provider}")


# ---------------------------------------------------------------------------
# Factory (lazy-import to avoid circular deps)
# ---------------------------------------------------------------------------


def get_backend(provider: str) -> type[AgentBackend]:
    """Return the :class:`AgentBackend` subclass for *provider*.

    Returns the **class** (type), not an instance.
    Uses lazy imports so that backend sub-modules are only loaded when needed.

    Raises:
        ValueError: if *provider* is not a known provider name.
        ImportError: if the backend sub-module has not been implemented yet.
    """
    protocol = get_protocol(provider)  # raises ValueError if unknown

    # Lazy import map: protocol → (module path, class name)
    _PROTOCOL_MODULES: dict[str, tuple[str, str]] = {
        "stream_json": (".stream_json", "StreamJsonBackend"),
        "json_rpc": (".json_rpc", "JsonRpcBackend"),
        "jsonl": (".jsonl", "JsonlBackend"),
        "ndjson": (".ndjson", "NdjsonBackend"),
        "text": (".text", "TextBackend"),
    }

    if protocol not in _PROTOCOL_MODULES:
        raise ImportError(f"Backend module for {protocol} not implemented yet")

    module_path, class_name = _PROTOCOL_MODULES[protocol]

    try:
        # Lazy import inside function body to avoid circular dependencies
        import importlib

        module = importlib.import_module(module_path, package=__name__)
        backend_cls = getattr(module, class_name)
    except (ImportError, AttributeError) as exc:
        raise ImportError(f"Backend module for {protocol} not implemented yet") from exc

    return backend_cls
