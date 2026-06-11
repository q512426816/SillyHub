"""StreamJsonBackend: NDJSON stream-json protocol for claude/gemini/cursor.

Implements the AgentBackend ABC for providers that use the NDJSON stream-json
CLI protocol (claude, gemini, cursor). The backend spawns the agent CLI with
``--output-format stream-json`` and parses each stdout line as a JSON message.

Key design notes (from multica server/pkg/agent/claude.go):
- stdin must stay OPEN after writing the prompt, because the CLI emits
  ``control_request`` events mid-run and expects ``control_response``
  frames on the same input stream.
- stdout and stdin I/O run concurrently to avoid deadlocks.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from typing import Callable

from . import AgentBackend, AgentEvent, TaskResult

logger = logging.getLogger(__name__)

_EXECUTE_TIMEOUT = 300


class StreamJsonBackend(AgentBackend):
    """AgentBackend for NDJSON stream-json protocol (claude/gemini/cursor)."""

    provider: str = "stream_json"

    async def execute(
        self,
        cmd_path: str,
        task_prompt: str,
        work_dir: str,
        env: dict | None = None,
        **kwargs,
    ) -> TaskResult:
        start = time.monotonic()
        output_parts: list[str] = []
        events: list[AgentEvent] = []
        session_id = ""
        final_status = "completed"
        final_error = ""

        args = self._build_args()
        resume_session_id = kwargs.get("resume_session_id", "")
        if resume_session_id:
            args.extend(["--resume", resume_session_id])
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

        # Write prompt to stdin.  Do NOT close stdin — the CLI may emit
        # control_request events and expect control_response frames on the
        # same stream.  stdin is closed only after the result event or on
        # error / timeout.
        stdin_closed = False
        input_data = self._build_input(task_prompt)
        try:
            proc.stdin.write(input_data)
            await proc.stdin.drain()
        except (BrokenPipeError, ConnectionResetError, OSError) as exc:
            logger.debug("stdin write failed: %s", exc)

        def _close_stdin() -> None:
            nonlocal stdin_closed
            if not stdin_closed and proc.stdin and not proc.stdin.is_closing():
                try:
                    proc.stdin.close()
                except Exception:
                    pass
                stdin_closed = True

        # Drain stderr in background.
        stderr_chunks: list[bytes] = []

        async def _read_stderr():
            try:
                while True:
                    chunk = await proc.stderr.read(4096)
                    if not chunk:
                        break
                    stderr_chunks.append(chunk)
            except Exception:
                pass

        stderr_task = asyncio.create_task(_read_stderr())

        # Read stdout lines until process ends or timeout.
        try:
            await asyncio.wait_for(
                self._consume_stdout(
                    proc.stdout, output_parts, events, proc, _close_stdin
                ),
                timeout=_EXECUTE_TIMEOUT,
            )
        except asyncio.TimeoutError:
            proc.kill()
            final_status = "timeout"
            final_error = f"execution timed out after {_EXECUTE_TIMEOUT}s"

        _close_stdin()

        # Extract session_id / error from parsed result info.
        info = getattr(self, "_last_result_info", None)
        if info:
            if info.get("session_id"):
                session_id = info["session_id"]
            if info.get("is_error"):
                final_status = "failed"
                final_error = info.get("result_text", "")

        # Wait for process exit.
        try:
            await asyncio.wait_for(proc.wait(), timeout=5)
        except asyncio.TimeoutError:
            proc.kill()

        try:
            await asyncio.wait_for(stderr_task, timeout=3)
        except (asyncio.TimeoutError, asyncio.CancelledError):
            pass

        if final_status == "completed" and proc.returncode and proc.returncode != 0:
            final_status = "failed"
            stderr_text = (
                b"".join(stderr_chunks).decode("utf-8", errors="replace").strip()
            )
            final_error = (
                f"exit code {proc.returncode}: {stderr_text}"
                if stderr_text
                else f"exit code {proc.returncode}"
            )

        result_info = getattr(self, "_last_result_info", None)
        output_text = "".join(output_parts)
        if (
            result_info
            and result_info.get("result_text")
            and not result_info.get("is_error")
        ):
            output_text = result_info["result_text"]

        duration_ms = int((time.monotonic() - start) * 1000)

        return TaskResult(
            status=final_status,
            output=output_text,
            error=final_error,
            duration_ms=duration_ms,
            session_id=session_id,
            events=events,
        )

    async def _consume_stdout(
        self,
        stdout: asyncio.StreamReader,
        output_parts: list[str],
        events: list[AgentEvent],
        proc: asyncio.subprocess.Process,
        close_stdin: Callable[[], None],
    ) -> None:
        """Read all stdout lines, accumulate output, handle control_request."""
        async for raw_line in stdout:
            line = raw_line.decode("utf-8", errors="replace").strip()
            if not line:
                continue

            ev = await self.parse_output(line)
            if ev is not None:
                events.append(ev)
                if ev.event_type == "text" and ev.content:
                    output_parts.append(ev.content)

            # Handle control_request and result in the raw line.
            try:
                obj = json.loads(line)
                if isinstance(obj, dict):
                    if obj.get("type") == "control_request":
                        await self._handle_control_request(obj, proc)
                    elif obj.get("type") == "result":
                        # CLI is done — safe to close stdin now.
                        close_stdin()
            except (json.JSONDecodeError, ValueError):
                pass

    async def _handle_control_request(
        self, msg: dict, proc: asyncio.subprocess.Process
    ) -> None:
        """Auto-approve all tool use control requests (daemon autonomous mode)."""
        request = msg.get("request", {})
        if isinstance(request, str):
            try:
                request = json.loads(request)
            except (json.JSONDecodeError, ValueError):
                request = {}

        tool_input = request.get("input", {})
        if isinstance(tool_input, str):
            try:
                tool_input = json.loads(tool_input)
            except (json.JSONDecodeError, ValueError):
                tool_input = {}
        if not isinstance(tool_input, dict):
            tool_input = {}

        response = {
            "type": "control_response",
            "response": {
                "subtype": "success",
                "request_id": msg.get("request_id", ""),
                "response": {
                    "behavior": "allow",
                    "updatedInput": tool_input,
                },
            },
        }
        data = json.dumps(response).encode("utf-8") + b"\n"
        try:
            if proc.stdin and not proc.stdin.is_closing():
                proc.stdin.write(data)
                await proc.stdin.drain()
                logger.debug(
                    "control_response_sent request_id=%s", msg.get("request_id")
                )
        except (BrokenPipeError, ConnectionResetError, OSError) as exc:
            logger.debug("control_response_write_failed: %s", exc)

    async def parse_output(
        self,
        line: str,
        **kwargs,
    ) -> AgentEvent | None:
        """Parse a single stdout line into a structured AgentEvent."""
        if not line.strip():
            return None

        try:
            obj = json.loads(line)
        except (json.JSONDecodeError, ValueError):
            return None

        if not isinstance(obj, dict):
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
        else:
            return None

    def _build_args(self) -> list[str]:
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

    def _parse_assistant(self, obj: dict) -> AgentEvent | None:
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
                last_event = AgentEvent(
                    event_type="tool_use",
                    tool_name=block.get("name", ""),
                    call_id=block.get("id", ""),
                    tool_input=block.get("input") or {},
                )
        return last_event

    def _parse_user(self, obj: dict) -> AgentEvent | None:
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
                    parts = []
                    for item in result_content:
                        parts.append(
                            item.get("text", "")
                            if isinstance(item, dict)
                            else str(item)
                        )
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
        return AgentEvent(
            event_type="status",
            status="running",
            session_id=obj.get("session_id", ""),
        )

    def _parse_result(self, obj: dict) -> None:
        self._last_result_info = {
            "session_id": obj.get("session_id", ""),
            "result_text": obj.get("result", ""),
            "is_error": obj.get("is_error", False),
        }

    def _parse_log(self, obj: dict) -> AgentEvent | None:
        log = obj.get("log")
        if not log or not isinstance(log, dict):
            return None
        return AgentEvent(
            event_type="log",
            level=log.get("level", ""),
            content=log.get("message", ""),
        )
