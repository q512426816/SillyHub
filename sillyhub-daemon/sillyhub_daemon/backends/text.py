"""TextBackend — antigravity plain text stdout protocol backend.

Design reference: task-06, antigravity.go.
Protocol: stdout is plain assistant text line by line. No structured events.
"""

from __future__ import annotations

import asyncio
import logging
import shutil
from dataclasses import dataclass

from sillyhub_daemon.backends import AgentBackend, AgentEvent, TaskResult

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Internal state accumulator
# ---------------------------------------------------------------------------


@dataclass
class _TextState:
    """Mutable state accumulated while processing plain text output."""

    output: str = ""
    final_status: str = "completed"
    final_error: str = ""


# ---------------------------------------------------------------------------
# Backend implementation
# ---------------------------------------------------------------------------


class TextBackend(AgentBackend):
    """Plain text stdout protocol backend for antigravity."""

    provider: str = "antigravity"
    binary_name: str = "agy"

    def __init__(self) -> None:
        self._state = _TextState()

    def _reset_state(self) -> None:
        """Reset internal state for a fresh execution."""
        self._state = _TextState()

    # ── Argument builder ──────────────────────────────────────────────────

    def build_args(
        self,
        task_prompt: str,
        *,
        model: str = "",
        work_dir: str = "",
        session_id: str = "",
    ) -> list[str]:
        """Assemble argv for a one-shot agy invocation.

        Reference: ``buildAntigravityArgs`` in antigravity.go.

        .. code-block:: bash

            agy -p "<prompt>" --dangerously-skip-permissions
                [--model <m>] [--add-dir <cwd>] [--conversation <id>]
        """
        args: list[str] = [
            "-p",
            task_prompt,
            "--dangerously-skip-permissions",
        ]
        if model:
            args.extend(["--model", model])
        if work_dir:
            args.extend(["--add-dir", work_dir])
        if session_id:
            args.extend(["--conversation", session_id])
        return args

    # ── Event parsing ────────────────────────────────────────────────────

    def parse_line(self, line: str) -> AgentEvent | None:
        """Parse a single output line. Every non-empty line becomes a TextEvent.

        Synchronous version for direct use in tests and stateless parsing.
        Reference: antigravity.go Execute — each non-empty trimmed line
        becomes a MessageText event; all lines are accumulated into the
        output buffer separated by newlines.
        """
        stripped = line.strip()
        if not stripped:
            return None

        # Accumulate into output with newline separator
        if self._state.output:
            self._state.output += "\n"
        self._state.output += stripped

        return AgentEvent(event_type="text", content=stripped)

    async def parse_output(self, line: str) -> AgentEvent | None:
        """Async wrapper satisfying the AgentBackend ABC contract."""
        return self.parse_line(line)

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
        """Execute agy CLI and return structured result."""
        import time as _time

        self._reset_state()

        binary = cmd_path or self.binary_name
        if not shutil.which(binary):
            return TaskResult(
                status="failed",
                output="",
                error=f"agy executable not found: {binary}",
            )

        args = self.build_args(
            task_prompt,
            model=model,
            work_dir=work_dir,
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
                text_line = raw_line.decode(errors="replace").rstrip("\n").rstrip("\r")
                event = self.parse_line(text_line)
                if event:
                    collected_events.append(event)

            await proc.wait()

        except asyncio.TimeoutError:
            self._state.final_status = "timeout"
            self._state.final_error = f"agy timed out after {timeout}s"
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
            events=collected_events,
        )
