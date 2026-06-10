"""JsonlBackend — copilot JSONL dotted-event protocol backend.

Design reference: task-06, copilot.go.
Protocol: copilot CLI with ``--output-format json`` emits newline-delimited JSON.
Each line is ``{"type": "dotted.event.name", "data": {...}, ...}``.
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
# Internal state accumulator (mirrors copilotEventState in copilot.go)
# ---------------------------------------------------------------------------


@dataclass
class _JsonlState:
    """Mutable state accumulated while processing the JSONL event stream."""

    output: str = ""
    session_id: str = ""
    active_model: str = ""
    final_status: str = "completed"
    final_error: str = ""
    usage: dict[str, Any] = field(default_factory=dict)


# ---------------------------------------------------------------------------
# Backend implementation
# ---------------------------------------------------------------------------


class JsonlBackend(AgentBackend):
    """JSONL dotted-event protocol backend for copilot."""

    provider: str = "copilot"

    def __init__(self) -> None:
        self._state = _JsonlState()

    def _reset_state(self, seed_model: str = "") -> None:
        """Reset internal state for a fresh execution."""
        self._state = _JsonlState(active_model=seed_model or "copilot")

    # ── Argument builder ──────────────────────────────────────────────────

    def build_args(
        self,
        task_prompt: str,
        *,
        model: str = "",
        session_id: str = "",
    ) -> list[str]:
        """Assemble argv for a one-shot copilot invocation.

        Reference: ``buildCopilotArgs`` in copilot.go.

        .. code-block:: bash

            copilot -p "<prompt>" --output-format json --allow-all --no-ask-user
                    [--model <m>] [--resume <session-id>]
        """
        args: list[str] = [
            "-p",
            task_prompt,
            "--output-format",
            "json",
            "--allow-all",
            "--no-ask-user",
        ]
        if model:
            args.extend(["--model", model])
        if session_id:
            args.extend(["--resume", session_id])
        return args

    # ── Event parsing ────────────────────────────────────────────────────

    async def parse_output(self, line: str) -> AgentEvent | None:
        """Parse a single JSONL line into a structured event.

        Returns the *primary* event for the line. For event types that
        internally produce multiple logical events (e.g. ``assistant.message``
        with both reasoning and tool requests), only the first event is
        returned. Use ``parse_output_multi`` for full event extraction.
        """
        events = self.parse_output_multi(line)
        return events[0] if events else None

    def parse_output_multi(self, line: str) -> list[AgentEvent]:
        """Parse a single JSONL line, potentially returning multiple events.

        Used internally and by tests that need to inspect all events from
        a single line (e.g. ``assistant.message`` with reasoning + tool use).
        """
        line = line.strip()
        if not line:
            return []

        try:
            evt = json.loads(line)
        except (json.JSONDecodeError, ValueError):
            logger.warning("jsonl: failed to parse line: %s", line[:200])
            return []

        evt_type = evt.get("type", "")
        data = evt.get("data", {})

        return self._handle_event(evt_type, data, evt)

    def _handle_event(
        self,
        evt_type: str,
        data: dict[str, Any],
        raw: dict[str, Any],
    ) -> list[AgentEvent]:
        """Dispatch event by type, update state, return events.

        Reference: ``handleCopilotEvent`` in copilot.go.
        """
        events: list[AgentEvent] = []

        if evt_type == "session.start":
            self._handle_session_start(data)

        elif evt_type == "assistant.message_delta":
            ev = self._handle_message_delta(data)
            if ev:
                events.append(ev)

        elif evt_type == "assistant.message":
            events.extend(self._handle_message(data))

        elif evt_type in ("assistant.reasoning", "assistant.reasoning_delta"):
            ev = self._handle_reasoning(data)
            if ev:
                events.append(ev)

        elif evt_type == "tool.execution_complete":
            ev = self._handle_tool_complete(data)
            if ev:
                events.append(ev)

        elif evt_type == "assistant.turn_start":
            events.append(AgentEvent(event_type="status", status="running"))

        elif evt_type == "session.error":
            ev = self._handle_session_error(data)
            if ev:
                events.append(ev)

        elif evt_type == "session.warning":
            ev = self._handle_session_warning(data)
            if ev:
                events.append(ev)

        elif evt_type == "result":
            self._handle_result(raw)

        return events

    # ── Individual event handlers ─────────────────────────────────────────

    def _handle_session_start(self, data: dict[str, Any]) -> None:
        if data.get("selectedModel"):
            self._state.active_model = data["selectedModel"]
        if data.get("sessionId"):
            self._state.session_id = data["sessionId"]

    def _handle_message_delta(self, data: dict[str, Any]) -> AgentEvent | None:
        delta = data.get("deltaContent", "")
        if not delta:
            return None
        self._state.output += delta
        return AgentEvent(event_type="text", content=delta)

    def _handle_message(self, data: dict[str, Any]) -> list[AgentEvent]:
        """Handle assistant.message: reset output, emit reasoning/tool_use."""
        events: list[AgentEvent] = []

        content = data.get("content", "")
        if content:
            # Reset output to avoid delta double-counting.
            # Reference: copilot.go handleCopilotEvent assistant.message
            current = self._state.output
            if current.endswith(content):
                self._state.output = current[: -len(content)]
            # Add separator between turns if there's prior content
            if self._state.output and not self._state.output.endswith("\n\n"):
                self._state.output += "\n\n"
            self._state.output += content

        # Reasoning
        reasoning = data.get("reasoningText", "")
        if reasoning:
            events.append(AgentEvent(event_type="thinking", content=reasoning))

        # Tool requests
        tool_requests = data.get("toolRequests", [])
        for tr in tool_requests:
            tool_input: dict | None = None
            args = tr.get("arguments")
            if args:
                if isinstance(args, str):
                    try:
                        tool_input = json.loads(args)
                    except (json.JSONDecodeError, ValueError):
                        tool_input = {"raw": args}
                elif isinstance(args, dict):
                    tool_input = args
            events.append(
                AgentEvent(
                    event_type="tool_use",
                    tool_name=tr.get("name", ""),
                    call_id=tr.get("toolCallId", ""),
                    tool_input=tool_input,
                )
            )

        return events

    def _handle_reasoning(self, data: dict[str, Any]) -> AgentEvent | None:
        text = data.get("content", "") or data.get("deltaContent", "")
        if not text:
            return None
        return AgentEvent(event_type="thinking", content=text)

    def _handle_tool_complete(self, data: dict[str, Any]) -> AgentEvent | None:
        call_id = data.get("toolCallId", "")
        success = data.get("success", True)

        if success:
            result_obj = data.get("result")
            result_content = ""
            if result_obj and isinstance(result_obj, dict):
                result_content = result_obj.get("content", "")
        else:
            error_obj = data.get("error")
            if error_obj and isinstance(error_obj, dict):
                result_content = "Error: " + error_obj.get("message", "unknown")
            elif data.get("result") and isinstance(data["result"], dict):
                result_content = data["result"].get("content", "")
            else:
                result_content = "Error: unknown"

        return AgentEvent(
            event_type="tool_result",
            call_id=call_id,
            tool_output=result_content,
        )

    def _handle_session_error(self, data: dict[str, Any]) -> AgentEvent:
        msg = data.get("message", "unknown error")
        self._state.final_status = "failed"
        self._state.final_error = msg
        return AgentEvent(event_type="error", content=msg)

    def _handle_session_warning(self, data: dict[str, Any]) -> AgentEvent:
        msg = data.get("message", "")
        return AgentEvent(event_type="status", content=msg, level="warn")

    def _handle_result(self, raw: dict[str, Any]) -> None:
        if raw.get("sessionId"):
            self._state.session_id = raw["sessionId"]
        exit_code = raw.get("exitCode", 0)
        if exit_code != 0:
            self._state.final_status = "failed"
            exit_msg = f"copilot exited with code {exit_code}"
            if self._state.final_error:
                if exit_msg not in self._state.final_error:
                    self._state.final_error += "; " + exit_msg
            else:
                self._state.final_error = exit_msg

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
        """Execute copilot CLI and return structured result."""
        import time as _time

        seed_model = model or "copilot"
        self._reset_state(seed_model=seed_model)

        # Locate binary
        binary = cmd_path or "copilot"
        if not shutil.which(binary):
            return TaskResult(
                status="failed",
                output="",
                error=f"copilot executable not found: {binary}",
            )

        args = self.build_args(
            task_prompt,
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

            # Read stdout line by line
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
            self._state.final_error = f"copilot timed out after {timeout}s"
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
