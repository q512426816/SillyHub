"""Task execution engine for the SillyHub local daemon.

Design reference: design section 4.2.4 (Wave 4) — TaskRunner receives a
claimed lease + execution payload, prepares the workspace, launches an
agent subprocess, streams progress, and collects the resulting diff.

The public entry point is :meth:`TaskRunner.execute_task`.
"""

from __future__ import annotations

import asyncio
import logging
import os
import time
import uuid
from dataclasses import dataclass, field
from typing import Any

from sillyhub_daemon.client import HubClient
from sillyhub_daemon.credential import CredentialManager
from sillyhub_daemon.workspace import WorkspaceManager

logger = logging.getLogger(__name__)


@dataclass
class TaskResult:
    """Structured result of a single task execution."""

    success: bool
    exit_code: int = -1
    patch: str = ""
    files_changed: int = 0
    insertions: int = 0
    deletions: int = 0
    output: str = ""
    error: str = ""
    duration_ms: int = 0
    metadata: dict[str, Any] = field(default_factory=dict)


class TaskRunner:
    """Executes agent tasks locally and reports progress.

    Parameters
    ----------
    client:
        HTTP client used to report progress and completion.
    workspace_manager:
        Manages local workspace mirrors (clone / pull / diff).
    credential_manager:
        Renders ``{{USER_*}}`` credential placeholders.
    """

    # How often (in lines of output) we submit a progress message.
    _PROGRESS_INTERVAL: int = 10

    # Maximum output/error lengths to keep in TaskResult.
    _MAX_OUTPUT: int = 10_000
    _MAX_ERROR: int = 5_000

    def __init__(
        self,
        client: HubClient,
        workspace_manager: WorkspaceManager,
        credential_manager: CredentialManager,
    ) -> None:
        self._client = client
        self._workspace = workspace_manager
        self._credentials = credential_manager
        self._running_tasks: dict[str, asyncio.Task[TaskResult]] = {}

    # ── Public API ──────────────────────────────────────────────────────────

    async def execute_task(
        self,
        lease_id: str,
        claim_token: str,
        payload: dict[str, Any],
    ) -> TaskResult:
        """Execute a claimed task end-to-end.

        Steps:

        1. Prepare workspace (clone / pull).
        2. Write ``CLAUDE.md`` from the payload.
        3. Render credential placeholders into env vars.
        4. Start the agent subprocess.
        5. Stream progress to the server.
        6. Collect the unified diff.
        7. Return a :class:`TaskResult`.

        Parameters
        ----------
        lease_id:
            Server-side lease identifier.
        claim_token:
            Token that authorises lease operations (start / messages / complete).
        payload:
            Execution context returned by ``claim_lease`` — includes
            ``workspace_name``, ``claude_md``, ``prompt``, ``tool_config``, etc.
        """
        start = time.monotonic()
        task_id = str(uuid.uuid4())
        logger.info("task_execute_start lease_id=%s task_id=%s", lease_id, task_id)

        try:
            # 1. Prepare workspace
            workspace_name = payload.get("workspace_name", "default")
            repo_url = payload.get("repo_url")
            branch = payload.get("branch", "main")
            work_dir = await self._workspace.prepare_workspace(
                workspace_name,
                repo_url=repo_url,
                branch=branch,
            )

            # 2. Write CLAUDE.md
            claude_md = payload.get("claude_md", "")
            if claude_md:
                claude_path = work_dir / ".claude" / "CLAUDE.md"
                claude_path.parent.mkdir(parents=True, exist_ok=True)
                claude_path.write_text(claude_md, encoding="utf-8")

            # 3. Render credentials → env dict
            credential_config = payload.get("tool_config", {})
            extra_env = self._credentials.build_env(credential_config)
            env = {**os.environ, **extra_env}

            # 4. Start agent subprocess
            prompt = payload.get("prompt", "")
            cmd: list[str] = ["claude", "--print", prompt] if prompt else ["claude"]

            proc = await self._launch_agent(cmd, cwd=str(work_dir), env=env)

            # 5. Stream stdout in the background, collect stderr separately.
            agent_run_id = payload.get("agent_run_id", "")

            stdout_text, stderr_bytes = await asyncio.gather(
                self._stream_output(proc, lease_id, claim_token, agent_run_id),
                proc.stderr.read(),
            )
            stderr_text = stderr_bytes.decode(errors="replace")

            exit_code = await proc.wait()
            duration_ms = int((time.monotonic() - start) * 1000)

            # 6. Collect diff (non-fatal — failure to collect diff should
            #    not mark the whole task as failed).
            diff_result: dict[str, Any] = {}
            try:
                diff_result = await self._workspace.collect_diff(work_dir)
            except Exception as exc:
                logger.warning(
                    "diff_collect_failed work_dir=%s error=%s", work_dir, exc
                )

            result = TaskResult(
                success=exit_code == 0,
                exit_code=exit_code,
                patch=diff_result.get("patch", ""),
                files_changed=diff_result.get("files_changed", 0),
                insertions=diff_result.get("insertions", 0),
                deletions=diff_result.get("deletions", 0),
                output=self._truncate(stdout_text, self._MAX_OUTPUT),
                error=self._truncate(stderr_text, self._MAX_ERROR),
                duration_ms=duration_ms,
            )

            logger.info(
                "task_execute_done lease_id=%s exit_code=%s "
                "duration_ms=%s files_changed=%s",
                lease_id,
                exit_code,
                duration_ms,
                result.files_changed,
            )
            return result

        except Exception as exc:
            duration_ms = int((time.monotonic() - start) * 1000)
            logger.error("task_execute_failed lease_id=%s error=%s", lease_id, exc)
            return TaskResult(
                success=False,
                error=str(exc),
                duration_ms=duration_ms,
            )

    # ── Task tracking ───────────────────────────────────────────────────────

    @property
    def active_task_count(self) -> int:
        """Number of currently tracked background tasks."""
        return len(self._running_tasks)

    def track(self, task_id: str, task: asyncio.Task[TaskResult]) -> None:
        """Register a background task for later cancellation / status queries."""
        self._running_tasks[task_id] = task

    def untrack(self, task_id: str) -> None:
        """Remove a tracked task."""
        self._running_tasks.pop(task_id, None)

    async def cancel_task(self, task_id: str) -> bool:
        """Attempt to cancel a tracked task.  Returns ``True`` if found."""
        task = self._running_tasks.get(task_id)
        if task is None:
            return False
        task.cancel()
        self._running_tasks.pop(task_id, None)
        return True

    # ── Internal helpers ────────────────────────────────────────────────────

    async def _launch_agent(
        self,
        cmd: list[str],
        *,
        cwd: str,
        env: dict[str, str],
    ) -> asyncio.subprocess.Process:
        """Create the agent subprocess.  Extracted for testability."""
        return await asyncio.create_subprocess_exec(
            *cmd,
            cwd=cwd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env=env,
        )

    async def _stream_output(
        self,
        proc: asyncio.subprocess.Process,
        lease_id: str,
        claim_token: str,
        agent_run_id: str,
    ) -> str:
        """Read *proc* stdout line-by-line, periodically reporting progress."""
        lines: list[str] = []

        while True:
            raw = await proc.stdout.readline()
            if not raw:
                break
            text = raw.decode(errors="replace")
            lines.append(text)

            # Periodically submit progress to the server.
            if len(lines) % self._PROGRESS_INTERVAL == 0:
                try:
                    await self._client.submit_messages(
                        lease_id=lease_id,
                        claim_token=claim_token,
                        agent_run_id=agent_run_id,
                        messages=[{"content": text, "level": "info"}],
                    )
                except Exception as exc:
                    logger.warning("progress_report_failed error=%s", exc)

        return "".join(lines)

    @staticmethod
    def _truncate(text: str, limit: int) -> str:
        """Return *text* truncated to *limit* characters."""
        if len(text) <= limit:
            return text
        return text[:limit]
