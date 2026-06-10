"""StreamJsonBackend: NDJSON stream-json protocol for claude/gemini/cursor.

Implements the AgentBackend ABC for providers that use the NDJSON stream-json
CLI protocol (claude, gemini, cursor). The backend spawns the agent CLI with
``--output-format stream-json`` and parses each stdout line as a JSON message.

Reference: task-04.md blueprint, multica server/pkg/agent/claude.go.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from typing import Any

from . import AgentBackend, AgentEvent, TaskResult

logger = logging.getLogger(__name__)

# Default timeout for a single task execution (seconds).
_EXECUTE_TIMEOUT = 10


class StreamJsonBackend(AgentBackend):
    """AgentBackend for NDJSON stream-json protocol (claude/gemini/cursor).

    Usage::

        backend = StreamJsonBackend()
        result = await backend.execute("/usr/local/bin/claude", "list files", "/home/user/project")
    """

    provider: str = "stream_json"

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def execute(
        self,
        cmd_path: str,
        task_prompt: str,
        work_dir: str,
        env: dict | None = None,
    ) -> TaskResult:
        """Execute agent CLI and return structured result.

        Spawns the CLI process, writes the prompt to stdin, reads stdout
        line-by-line, and accumulates events into a :class:`TaskResult`.
        """
        start = time.monotonic()
        output_parts: list[str] = []
        events: list[AgentEvent] = []
        session_id = ""
        final_status = "completed"
        final_error = ""
        stdin_write_error: str = ""

        args = self._build_args()
        # Prepend cmd_path
        full_args = [cmd_path] + args

        try:
            proc = await asyncio.create_subprocess_exec(
                *full_args,
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=work_dir,
                env=env,
            )
        except (FileNotFoundError, OSError) as exc:
            return TaskResult(
                status="failed",
                output="",
                error=str(exc),
                duration_ms=int((time.monotonic() - start) * 1000),
            )

        # Write prompt to stdin in a separate task to avoid deadlock.
        input_data = self._build_input(task_prompt)

        async def _write_stdin():
            nonlocal stdin_write_error
            try:
                proc.stdin.write(input_data)
                await proc.stdin.drain()
                # Keep stdin open for control_response writes
            except (BrokenPipeError, ConnectionResetError, OSError) as exc:
                stdin_write_error = str(exc)
                logger.debug("stdin write failed: %s", exc)

        stdin_task = asyncio.create_task(_write_stdin())

        stderr_chunks: list[bytes] = []

        async def _read_stderr():
            """Drain stderr in background to prevent pipe blocking."""
            try:
                while True:
                    chunk = await proc.stderr.read(4096)
                    if not chunk:
                        break
                    stderr_chunks.append(chunk)
            except Exception:
                pass

        stderr_task = asyncio.create_task(_read_stderr())

        # Read stdout with timeout
        try:
            async with asyncio.timeout(_EXECUTE_TIMEOUT):
                async for raw_line in proc.stdout:
                    line = raw_line.decode("utf-8", errors="replace").strip()
                    if not line:
                        continue

                    # Keep stdin reference for control_request handling
                    ev = await self.parse_output(
                        line,
                        _stdin=proc.stdin,
                        _stdin_task=stdin_task,
                    )

                    if ev is not None:
                        events.append(ev)
                        if ev.event_type == "text" and ev.content:
                            output_parts.append(ev.content)

                    # Check for result/error metadata stored in _last_result_info
                    info = getattr(self, "_last_result_info", None)
                    if info is not None:
                        if info.get("session_id"):
                            session_id = info["session_id"]
                        if info.get("is_error"):
                            final_status = "failed"
                            final_error = info.get("result_text", "")
                        # Clear after reading
                        self._last_result_info = None

                    # Also check system events for session_id
                    if (
                        ev
                        and ev.event_type == "status"
                        and hasattr(ev, "session_id")
                        and ev.session_id
                    ):
                        session_id = ev.session_id

        except TimeoutError:
            proc.kill()
            final_status = "timeout"
            final_error = f"execution timed out after {_EXECUTE_TIMEOUT}s"

        # Wait for process to exit
        try:
            await asyncio.wait_for(proc.wait(), timeout=5)
        except TimeoutError:
            proc.kill()

        # Ensure stdin/stderr tasks complete
        try:
            await asyncio.wait_for(stdin_task, timeout=3)
        except (TimeoutError, asyncio.CancelledError):
            pass

        try:
            await asyncio.wait_for(stderr_task, timeout=3)
        except (TimeoutError, asyncio.CancelledError):
            pass

        # If no result event set the status, check exit code
        if final_status == "completed" and proc.returncode and proc.returncode != 0:
            final_status = "failed"
            stderr_text = (
                b"".join(stderr_chunks).decode("utf-8", errors="replace").strip()
            )
            if stderr_text:
                final_error = (
                    f"process exited with code {proc.returncode}: {stderr_text}"
                )
            else:
                final_error = f"process exited with code {proc.returncode}"

        # Check stdin write error
        if stdin_write_error and final_status == "completed" and not session_id:
            final_status = "failed"
            final_error = f"write stdin failed: {stdin_write_error}"

        duration_ms = int((time.monotonic() - start) * 1000)

        # Use result text as output if available (overrides accumulated text)
        result_info = getattr(self, "_last_result_info", None)
        output_text = "".join(output_parts)
        if (
            result_info
            and result_info.get("result_text")
            and not result_info.get("is_error")
        ):
            output_text = result_info["result_text"]

        return TaskResult(
            status=final_status,
            output=output_text,
            error=final_error,
            duration_ms=duration_ms,
            session_id=session_id,
            events=events,
        )

    async def parse_output(
        self,
        line: str,
        *,
        _stdin: Any = None,
        _stdin_task: Any = None,
    ) -> AgentEvent | None:
        """Parse a single stdout line into a structured AgentEvent.

        Returns None for empty lines, invalid JSON, unknown types, and
        types that don't map to external events (result, control_request).

        Args:
            line: Raw stdout line (should be stripped before calling).
            _stdin: Internal — process stdin for writing control_response.
            _stdin_task: Internal — stdin write task reference.
        """
        if not line.strip():
            return None

        try:
            obj = json.loads(line)
        except (json.JSONDecodeError, ValueError):
            logger.debug("non-JSON line: %s", line[:200])
            return None

        if not isinstance(obj, dict):
            logger.debug("parsed JSON is not an object: %s", line[:200])
            return None

        msg_type = obj.get("type")

        if msg_type == "assistant":
            return self._parse_assistant(obj)
        elif msg_type == "user":
            return self._parse_user(obj)
        elif msg_type == "system":
            return self._parse_system(obj)
        elif msg_type == "result":
            self._parse_result(obj)
            return None
        elif msg_type == "log":
            return self._parse_log(obj)
        elif msg_type == "control_request":
            self._handle_control_request(obj, _stdin)
            return None
        else:
            logger.debug("unknown message type: %s", msg_type)
            return None

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _build_args(self) -> list[str]:
        """Build CLI arguments (excluding the executable path)."""
        return [
            "-p",
            "--output-format",
            "stream-json",
            "--input-format",
            "stream-json",
            "--verbose",
            "--permission-mode",
            "bypassPermissions",
        ]

    def _build_input(self, prompt: str) -> bytes:
        """Build the JSON payload to write to process stdin."""
        payload = {
            "type": "user",
            "message": {
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                ],
            },
        }
        return json.dumps(payload).encode("utf-8") + b"\n"

    def _handle_control_request(self, obj: dict, stdin: Any) -> None:
        """Auto-approve control_request by writing control_response to stdin.

        Mirrors the Go implementation in handleControlRequest().
        """
        if stdin is None:
            logger.debug("control_request received but no stdin available")
            return

        request = obj.get("request", {})
        request_id = obj.get("request_id", "")

        # Extract input from request payload
        input_data = request.get("input", {})
        if input_data is None:
            input_data = {}

        response = {
            "type": "control_response",
            "response": {
                "subtype": "success",
                "request_id": request_id,
                "response": {
                    "behavior": "allow",
                    "updatedInput": input_data,
                },
            },
        }

        try:
            data = json.dumps(response).encode("utf-8") + b"\n"
            stdin.write(data)
            # drain is async but we're in a sync context here
            # The event loop will handle flushing
            logger.debug("auto-approved control_request %s", request_id)
        except (BrokenPipeError, ConnectionResetError, OSError) as exc:
            logger.debug("failed to write control_response: %s", exc)

    # ------------------------------------------------------------------
    # Message type parsers
    # ------------------------------------------------------------------

    def _parse_assistant(self, obj: dict) -> AgentEvent | None:
        """Parse assistant message → text/thinking/tool_use event."""
        message = obj.get("message")
        if not message or not isinstance(message, dict):
            return None

        content = message.get("content")
        if not content or not isinstance(content, list):
            return None

        last_event: AgentEvent | None = None
        for block in content:
            block_type = block.get("type")
            if block_type == "text":
                text = block.get("text", "")
                if text:
                    last_event = AgentEvent(event_type="text", content=text)
            elif block_type == "thinking":
                text = block.get("text", "")
                if text:
                    last_event = AgentEvent(event_type="thinking", content=text)
            elif block_type == "tool_use":
                tool_input = block.get("input")
                if tool_input is None:
                    tool_input = {}
                last_event = AgentEvent(
                    event_type="tool_use",
                    tool_name=block.get("name", ""),
                    call_id=block.get("id", ""),
                    tool_input=tool_input,
                )

        return last_event

    def _parse_user(self, obj: dict) -> AgentEvent | None:
        """Parse user message → tool_result event."""
        message = obj.get("message")
        if not message or not isinstance(message, dict):
            return None

        content = message.get("content")
        if not content or not isinstance(content, list):
            return None

        last_event: AgentEvent | None = None
        for block in content:
            if block.get("type") == "tool_result":
                result_content = block.get("content", "")
                if isinstance(result_content, list):
                    # content can be a list of content blocks
                    parts = []
                    for item in result_content:
                        if isinstance(item, dict):
                            parts.append(item.get("text", ""))
                        else:
                            parts.append(str(item))
                    result_content = "\n".join(parts)
                elif result_content is None:
                    result_content = ""

                last_event = AgentEvent(
                    event_type="tool_result",
                    call_id=block.get("tool_use_id", ""),
                    tool_output=str(result_content),
                )

        return last_event

    def _parse_system(self, obj: dict) -> AgentEvent:
        """Parse system message → status event."""
        return AgentEvent(
            event_type="status",
            status="running",
            session_id=obj.get("session_id", ""),
        )

    def _parse_result(self, obj: dict) -> None:
        """Parse result message — stores metadata internally for execute().

        Does not produce an AgentEvent. The execute() method reads
        _last_result_info after each parse_output() call.
        """
        self._last_result_info = {
            "session_id": obj.get("session_id", ""),
            "result_text": obj.get("result", ""),
            "is_error": obj.get("is_error", False),
        }

    def _parse_log(self, obj: dict) -> AgentEvent | None:
        """Parse log message → log event."""
        log = obj.get("log")
        if not log or not isinstance(log, dict):
            return None
        return AgentEvent(
            event_type="log",
            level=log.get("level", ""),
            content=log.get("message", ""),
        )
