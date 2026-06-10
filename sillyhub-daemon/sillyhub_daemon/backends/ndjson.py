"""NdjsonBackend — opencode/openclaw/pi NDJSON streaming protocol backend.

Design reference: task-06, opencode.go.
Protocol: ``run --format json`` subcommand emits newline-delimited JSON events.
Each line is ``{"type": "text"|"tool_use"|"error"|"step_start"|"step_finish", ...}``.
"""

from __future__ import annotations

import asyncio
import json
import logging
import shutil
from dataclasses import dataclass, field
from typing import Any

from sillyhub_daemon.backends import AgentBackend, AgentEvent, TaskResult

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Internal state accumulator (mirrors eventResult in opencode.go)
# ---------------------------------------------------------------------------


@dataclass
class _NdjsonState:
    """Mutable state accumulated while processing the NDJSON event stream."""

    output: str = ""
    session_id: str = ""
    final_status: str = "completed"
    final_error: str = ""
    usage: dict[str, int] = field(
        default_factory=lambda: {
            "input_tokens": 0,
            "output_tokens": 0,
            "cache_read_tokens": 0,
            "cache_write_tokens": 0,
        }
    )


# ---------------------------------------------------------------------------
# Backend implementation
# ---------------------------------------------------------------------------


class NdjsonBackend(AgentBackend):
    """NDJSON streaming protocol backend for opencode/openclaw/pi."""

    provider: str  # set per instance: "opencode" | "openclaw" | "pi"

    # Binary name per provider
    _BINARY_MAP: dict[str, str] = {
        "opencode": "opencode",
        "openclaw": "openclaw",
        "pi": "pi",
    }

    def __init__(self, provider: str = "opencode") -> None:
        if provider not in self._BINARY_MAP:
            raise ValueError(f"Unknown NdjsonBackend provider: {provider}")
        self.provider = provider
        self._state = _NdjsonState()

    def _reset_state(self) -> None:
        """Reset internal state for a fresh execution."""
        self._state = _NdjsonState()

    # ── Argument builder ──────────────────────────────────────────────────

    def build_args(
        self,
        task_prompt: str,
        *,
        work_dir: str = "",
        model: str = "",
        session_id: str = "",
    ) -> list[str]:
        """Assemble argv for a one-shot invocation.

        Reference: ``buildOpenCodeArgs`` pattern in opencode.go.

        .. code-block:: bash

            opencode run --format json --dangerously-skip-permissions
                         [--dir <cwd>] [--model <m>] [--session <id>]
                         <prompt>
        """
        args: list[str] = [
            "run",
            "--format",
            "json",
            "--dangerously-skip-permissions",
        ]
        if work_dir:
            args.extend(["--dir", work_dir])
        if model:
            args.extend(["--model", model])
        if session_id:
            args.extend(["--session", session_id])
        # Prompt is the last positional argument
        args.append(task_prompt)
        return args

    # ── Event parsing ────────────────────────────────────────────────────

    async def parse_output(self, line: str) -> AgentEvent | None:
        """Parse a single NDJSON line into a structured event.

        Returns the *primary* event. Use ``parse_output_multi`` for event
        types that produce multiple logical events (e.g. completed tool_use).
        """
        events = self.parse_output_multi(line)
        return events[0] if events else None

    def parse_output_multi(self, line: str) -> list[AgentEvent]:
        """Parse a single NDJSON line, potentially returning multiple events."""
        line = line.strip()
        if not line:
            return []

        try:
            evt = json.loads(line)
        except (json.JSONDecodeError, ValueError):
            logger.warning("ndjson: failed to parse line: %s", line[:200])
            return []

        evt_type = evt.get("type", "")
        part = evt.get("part", {})

        # Extract sessionID from any event that carries it
        if evt.get("sessionID"):
            self._state.session_id = evt["sessionID"]

        return self._handle_event(evt_type, part, evt)

    def _handle_event(
        self,
        evt_type: str,
        part: dict[str, Any],
        raw: dict[str, Any],
    ) -> list[AgentEvent]:
        """Dispatch event by type, update state, return events.

        Reference: ``processEvents`` in opencode.go.
        """
        events: list[AgentEvent] = []

        if evt_type == "text":
            ev = self._handle_text_event(part)
            if ev:
                events.append(ev)

        elif evt_type == "tool_use":
            events.extend(self._handle_tool_use_event(part))

        elif evt_type == "error":
            ev = self._handle_error_event(raw.get("error", {}))
            if ev:
                events.append(ev)

        elif evt_type == "step_start":
            events.append(AgentEvent(event_type="status", status="running"))

        elif evt_type == "step_finish":
            self._handle_step_finish(part)

        return events

    # ── Individual event handlers ─────────────────────────────────────────

    def _handle_text_event(self, part: dict[str, Any]) -> AgentEvent | None:
        """Reference: handleTextEvent in opencode.go."""
        text = part.get("text", "")
        if not text:
            return None
        self._state.output += text
        return AgentEvent(event_type="text", content=text)

    def _handle_tool_use_event(self, part: dict[str, Any]) -> list[AgentEvent]:
        """Handle tool_use event; emit both call and result if completed.

        Reference: handleToolUseEvent in opencode.go.
        """
        events: list[AgentEvent] = []

        state = part.get("state", {})
        tool_name = part.get("tool", "")
        call_id = part.get("callID", "")

        # Extract input from state.input
        tool_input: dict | None = None
        raw_input = state.get("input") if state else None
        if raw_input is not None:
            if isinstance(raw_input, str):
                try:
                    tool_input = json.loads(raw_input)
                except (json.JSONDecodeError, ValueError):
                    tool_input = {"raw": raw_input}
            elif isinstance(raw_input, dict):
                tool_input = raw_input

        # Emit tool_use event
        events.append(
            AgentEvent(
                event_type="tool_use",
                tool_name=tool_name,
                call_id=call_id,
                tool_input=tool_input,
            )
        )

        # If completed, also emit tool_result
        if state and state.get("status") == "completed":
            output = state.get("output")
            output_str = self._extract_tool_output(output)
            events.append(
                AgentEvent(
                    event_type="tool_result",
                    tool_name=tool_name,
                    call_id=call_id,
                    tool_output=output_str,
                )
            )

        return events

    def _handle_error_event(self, error: dict[str, Any]) -> AgentEvent | None:
        """Reference: handleErrorEvent in opencode.go."""
        err_data = error.get("data", {})
        err_msg = ""
        if err_data and err_data.get("message"):
            err_msg = err_data["message"]
        elif error.get("name"):
            err_msg = error["name"]

        if not err_msg:
            err_msg = "unknown error"

        self._state.final_status = "failed"
        self._state.final_error = err_msg
        return AgentEvent(event_type="error", content=err_msg)

    def _handle_step_finish(self, part: dict[str, Any]) -> None:
        """Accumulate token usage from step_finish events.

        Reference: processEvents in opencode.go.
        """
        tokens = part.get("tokens")
        if not tokens:
            return

        self._state.usage["input_tokens"] += tokens.get("input", 0)
        self._state.usage["output_tokens"] += tokens.get("output", 0)

        cache = tokens.get("cache")
        if cache:
            self._state.usage["cache_read_tokens"] += cache.get("read", 0)
            self._state.usage["cache_write_tokens"] += cache.get("write", 0)

    @staticmethod
    def _extract_tool_output(output: Any) -> str:
        """Convert tool state output to string.

        Reference: extractToolOutput in opencode.go.
        """
        if output is None:
            return ""
        if isinstance(output, str):
            return output
        return json.dumps(output)

    # ── Execute ───────────────────────────────────────────────────────────

    async def execute(
        self,
        cmd_path: str,
        task_prompt: str,
        work_dir: str,
        env: dict | None = None,
        *,
        timeout: float = 0,
        model: str = "",
        session_id: str = "",
    ) -> TaskResult:
        """Execute agent CLI and return structured result."""
        import time as _time

        self._reset_state()

        binary = cmd_path or self._BINARY_MAP.get(self.provider, self.provider)
        if not shutil.which(binary):
            return TaskResult(
                status="failed",
                output="",
                error=f"{binary} executable not found",
            )

        args = self.build_args(
            task_prompt,
            work_dir=work_dir,
            model=model,
            session_id=session_id,
        )

        start = _time.monotonic()
        collected_events: list[AgentEvent] = []

        try:
            proc = await asyncio.create_subprocess_exec(
                binary,
                *args,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=work_dir or None,
                env=env or None,
            )

            assert proc.stdout is not None
            while True:
                raw_line = await proc.stdout.readline()
                if not raw_line:
                    break
                text_line = raw_line.decode(errors="replace")
                line_events = self.parse_output_multi(text_line)
                collected_events.extend(line_events)

            await proc.wait()

        except asyncio.TimeoutError:
            self._state.final_status = "timeout"
            self._state.final_error = f"{self.provider} timed out after {timeout}s"
        except asyncio.CancelledError:
            self._state.final_status = "aborted"
            self._state.final_error = "execution cancelled"
        except Exception as exc:
            self._state.final_status = "failed"
            self._state.final_error = str(exc)

        duration_ms = int((_time.monotonic() - start) * 1000)

        return TaskResult(
            status=self._state.final_status,
            output=self._state.output,
            error=self._state.final_error,
            duration_ms=duration_ms,
            session_id=self._state.session_id,
            events=collected_events,
        )
