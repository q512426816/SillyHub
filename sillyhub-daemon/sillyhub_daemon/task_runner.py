"""Task execution engine for the SillyHub local daemon.

Design reference: design section 4.2.4 (Wave 4) — TaskRunner receives a
claimed lease + execution payload, prepares the workspace, delegates to
the appropriate AgentBackend based on the provider field, streams progress,
and collects the resulting diff.

Blueprint: .sillyspec/changes/2026-06-09-daemon-agent-detection/tasks/task-08.md

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

from sillyhub_daemon.backends import (
    AgentEvent,
    TaskResult as BackendTaskResult,
    get_backend,
)
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
        """Execute a claimed task end-to-end using the appropriate agent backend.

        Steps:

        1. Prepare workspace (clone / pull).
        2. Write ``CLAUDE.md`` from the payload.
        3. Render credential placeholders into env vars.
        4. Resolve provider and obtain the correct backend via factory.
        5. Delegate execution to the backend.
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
            ``workspace_name``, ``claude_md``, ``prompt``, ``tool_config``,
            ``provider``, ``cmd_path``, etc.
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

            # 3. Render credentials -> env dict
            credential_config = payload.get("tool_config", {})
            extra_env = self._credentials.build_env(credential_config)
            env = {**os.environ, **extra_env}

            # 4. Resolve provider and obtain backend
            provider = payload.get("provider", "claude")  # default: claude
            cmd_path = payload.get("cmd_path", "")
            prompt = payload.get("prompt", "")
            timeout = payload.get("timeout", 0)
            model = payload.get("model", "")
            session_id = payload.get("session_id", "")

            try:
                backend_cls = get_backend(provider)
            except (ValueError, ImportError) as exc:
                duration_ms = int((time.monotonic() - start) * 1000)
                logger.warning(
                    "unsupported_provider lease_id=%s provider=%s error=%s",
                    lease_id,
                    provider,
                    exc,
                )
                return TaskResult(
                    success=False,
                    error=f"unsupported provider: {provider}",
                    duration_ms=duration_ms,
                )

            # 5. Create backend instance and build on_event callback
            backend = backend_cls()
            agent_run_id = payload.get("agent_run_id", "")

            async def on_event(event: AgentEvent) -> None:
                """Forward agent events to the server via submit_messages."""
                message = self._event_to_message(event)
                if message:
                    try:
                        await self._client.submit_messages(
                            lease_id=lease_id,
                            claim_token=claim_token,
                            agent_run_id=agent_run_id,
                            messages=[message],
                        )
                    except Exception as exc:
                        logger.warning("event_forward_failed error=%s", exc)

            # 6. Delegate execution to backend
            backend_result: BackendTaskResult = await backend.execute(
                cmd_path=cmd_path,
                task_prompt=prompt,
                work_dir=str(work_dir),
                env=env,
                timeout=timeout,
                model=model,
                session_id=session_id,
                on_event=on_event,
            )

            duration_ms = int((time.monotonic() - start) * 1000)

            # 7. Collect diff (non-fatal — failure to collect diff should
            #    not mark the whole task as failed).
            diff_result: dict[str, Any] = {}
            try:
                diff_result = await self._workspace.collect_diff(work_dir)
            except Exception as exc:
                logger.warning(
                    "diff_collect_failed work_dir=%s error=%s", work_dir, exc
                )

            # 8. Convert backend result to TaskRunner TaskResult
            success = backend_result.status == "completed"
            result = TaskResult(
                success=success,
                exit_code=0 if success else 1,
                patch=diff_result.get("patch", ""),
                files_changed=diff_result.get("files_changed", 0),
                insertions=diff_result.get("insertions", 0),
                deletions=diff_result.get("deletions", 0),
                output=self._truncate(backend_result.output, self._MAX_OUTPUT),
                error=self._truncate(backend_result.error, self._MAX_ERROR),
                duration_ms=duration_ms,
            )

            logger.info(
                "task_execute_done lease_id=%s status=%s "
                "duration_ms=%s files_changed=%s",
                lease_id,
                backend_result.status,
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

    # Maximum output/error lengths to keep in TaskResult.
    _MAX_OUTPUT: int = 10_000
    _MAX_ERROR: int = 5_000

    @staticmethod
    def _truncate(text: str, limit: int) -> str:
        """Return *text* truncated to *limit* characters."""
        if len(text) <= limit:
            return text
        return text[:limit]

    @staticmethod
    def _event_to_message(event: AgentEvent) -> dict[str, Any] | None:
        """Convert an :class:`AgentEvent` to a submit_messages payload dict.

        Returns ``None`` if the event should be silently dropped (e.g. empty
        content with no meaningful metadata).
        """
        message: dict[str, Any] = {
            "event_type": event.event_type,
        }
        if event.content:
            message["content"] = event.content
        if event.tool_name:
            message["tool_name"] = event.tool_name
        if event.call_id:
            message["call_id"] = event.call_id
        if event.status:
            message["status"] = event.status
        if event.level:
            message["level"] = event.level
        if event.session_id:
            message["session_id"] = event.session_id

        # Only return if there is meaningful content
        if not event.content and not event.tool_name and not event.status:
            return None

        return message
