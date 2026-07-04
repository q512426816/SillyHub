"""ExecutionCoordinatorService — execution reliability guarantees.

Provides 6 capability points:
1. Idempotent run creation (idempotency_key)
2. Optimistic locking (version field)
3. Context fingerprint (SHA-256)
4. Resume from interruption (resume_token)
5. Checkpoint save/load (checkpoint_data JSONB)
6. Approval workflow (approval_token)
"""

from __future__ import annotations

import asyncio
import hashlib
import secrets
import uuid
import warnings
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import UTC
from pathlib import Path

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import col

from app.core.db import get_session_factory
from app.core.errors import AppError
from app.core.logging import get_logger
from app.modules.agent.base import AgentSpecBundle
from app.modules.agent.model import AgentRun

log = get_logger(__name__)


# ---------------------------------------------------------------------------
# Custom errors
# ---------------------------------------------------------------------------


class OptimisticLockError(AppError):
    """Raised when an optimistic lock conflict is detected."""

    code = "OPTIMISTIC_LOCK_CONFLICT"
    http_status = 409


class FingerprintMismatchError(AppError):
    """Raised when context fingerprint does not match."""

    code = "FINGERPRINT_MISMATCH"
    http_status = 409


class InvalidTokenError(AppError):
    """Raised when a resume or approval token is invalid."""

    code = "INVALID_TOKEN"
    http_status = 400


class AgentRunNotResumable(AppError):
    """Raised when an AgentRun is not in a resumable state."""

    code = "AGENT_RUN_NOT_RESUMABLE"
    http_status = 400


class AgentRunNotPendingApproval(AppError):
    """Raised when an AgentRun is not pending approval."""

    code = "AGENT_RUN_NOT_PENDING_APPROVAL"
    http_status = 400


# ---------------------------------------------------------------------------
# ExecutionCoordinatorService
# ---------------------------------------------------------------------------


class ExecutionCoordinatorService:
    """Execution reliability guarantees for agent runs."""

    # 后台任务引用集 — 防止 asyncio.Task 被 GC 回收
    _background_tasks: set[asyncio.Task] = set()

    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    # ------------------------------------------------------------------
    # Background task lifecycle helpers
    # ------------------------------------------------------------------

    def _fire_background_task(
        self,
        coro,
        *,
        workspace_id: uuid.UUID | None = None,
        run_id: uuid.UUID | None = None,
    ) -> asyncio.Task:
        """Create a background task and hold a strong reference to prevent GC."""
        task = asyncio.create_task(coro)
        self._background_tasks.add(task)
        task.add_done_callback(self._on_background_task_done)
        log.info(
            "background_task_fired",
            task_id=id(task),
            workspace_id=str(workspace_id),
            run_id=str(run_id),
        )
        return task

    @staticmethod
    def _on_background_task_done(task: asyncio.Task) -> None:
        """Remove task from the tracking set and surface exceptions."""
        ExecutionCoordinatorService._background_tasks.discard(task)
        try:
            exc = task.exception()
        except (asyncio.InvalidStateError, asyncio.CancelledError):
            return
        if exc is not None:
            log.exception("background_task_failed", task_id=id(task), exc_info=exc)

    # ------------------------------------------------------------------
    # 1. Idempotency
    # ------------------------------------------------------------------

    async def check_idempotency(self, key: str) -> AgentRun | None:
        """Check if a run with the given idempotency_key already exists.

        Returns the existing AgentRun if found, or ``None``.
        """
        stmt = select(AgentRun).where(col(AgentRun.idempotency_key) == key)
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()

    # ------------------------------------------------------------------
    # 2. Optimistic lock
    # ------------------------------------------------------------------

    async def update_with_lock(
        self,
        run_id: uuid.UUID,
        expected_version: int,
        **updates: object,
    ) -> AgentRun:
        """Update an AgentRun using optimistic locking.

        Performs ``UPDATE ... WHERE version = :expected`` and checks
        that exactly one row was affected.  Raises
        :class:`OptimisticLockError` on conflict.

        Args:
            run_id: The AgentRun UUID.
            expected_version: The version we expect in the DB.
            **updates: Column-value pairs to set.

        Returns:
            The refreshed AgentRun with version incremented.

        Raises:
            OptimisticLockError: version mismatch (concurrent modification).
        """
        # Increment version as part of the update
        update_values = {**updates, "version": expected_version + 1}
        stmt = (
            update(AgentRun)
            .where(col(AgentRun.id) == run_id, col(AgentRun.version) == expected_version)
            .values(**update_values)
        )
        result = await self.session.execute(stmt)

        if result.rowcount != 1:
            raise OptimisticLockError(
                f"Optimistic lock conflict for run '{run_id}'. "
                f"Expected version {expected_version}.",
                details={"run_id": str(run_id), "expected_version": expected_version},
            )

        await self.session.commit()
        run = await self.session.get(AgentRun, run_id)
        assert run is not None  # validated by rowcount check
        return run

    # ------------------------------------------------------------------
    # 3. Context fingerprint
    # ------------------------------------------------------------------

    def compute_fingerprint(self, bundle: AgentSpecBundle) -> str:
        """Compute a SHA-256 fingerprint of the spec bundle.

        Hashes the concatenation of key spec documents to detect context
        changes between runs.
        """
        parts = [
            bundle.proposal or "",
            bundle.design or "",
            bundle.plan or "",
            bundle.task_markdown or "",
        ]
        payload = "\n---\n".join(parts)
        return hashlib.sha256(payload.encode("utf-8")).hexdigest()

    async def validate_fingerprint(self, run_id: uuid.UUID, fingerprint: str) -> bool:
        """Check if the given fingerprint matches the stored one.

        Returns ``True`` if they match, ``False`` otherwise.
        """
        run = await self.session.get(AgentRun, run_id)
        if run is None or run.context_fingerprint is None:
            return True  # no fingerprint stored → skip validation
        return run.context_fingerprint == fingerprint

    # ------------------------------------------------------------------
    # 4. Resume
    # ------------------------------------------------------------------

    async def generate_resume_token(self, run: AgentRun) -> str:
        """Generate a resume_token and persist it on the AgentRun.

        Args:
            run: The AgentRun to attach the token to.

        Returns:
            The generated token string.
        """
        token = secrets.token_urlsafe(32)
        run.resume_token = token
        self.session.add(run)
        await self.session.commit()
        await self.session.refresh(run)
        log.info("resume_token_generated", run_id=str(run.id))
        return token

    async def resume_run(
        self,
        run_id: uuid.UUID,
        resume_token: str,
        context_fingerprint: str | None = None,
    ) -> AgentRun:
        """Resume an interrupted AgentRun.

        Validates the resume_token and optionally the context_fingerprint.
        Resets status to ``pending`` so the execution pipeline can pick it up.

        Args:
            run_id: The AgentRun UUID.
            resume_token: The token presented by the client.
            context_fingerprint: Optional fingerprint to validate against.

        Returns:
            The updated AgentRun.

        Raises:
            AgentRunNotFound: run does not exist.
            InvalidTokenError: token mismatch.
            FingerprintMismatchError: fingerprint mismatch.
            AgentRunNotResumable: run is not in a resumable state.
        """
        run = await self.session.get(AgentRun, run_id)
        if run is None:
            from app.core.errors import AgentRunNotFound

            raise AgentRunNotFound(
                f"Run '{run_id}' not found.",
                details={"run_id": str(run_id)},
            )

        # Only failed/killed runs can be resumed
        if run.status not in ("failed", "killed"):
            raise AgentRunNotResumable(
                f"Run '{run_id}' is not resumable (status={run.status}).",
                details={"run_id": str(run_id), "status": run.status},
            )

        # Validate token
        if run.resume_token != resume_token:
            raise InvalidTokenError(
                "Invalid resume token.",
                details={"run_id": str(run_id)},
            )

        # Optionally validate fingerprint
        if (
            context_fingerprint
            and run.context_fingerprint
            and run.context_fingerprint != context_fingerprint
        ):
            raise FingerprintMismatchError(
                "Context fingerprint mismatch — spec has changed since last run.",
                details={
                    "run_id": str(run_id),
                    "expected": run.context_fingerprint,
                    "provided": context_fingerprint,
                },
            )

        # Reset for re-execution
        run.status = "pending"
        run.resume_token = None  # consume token
        run.started_at = None
        run.finished_at = None
        run.exit_code = None
        run.retry_count = (run.retry_count or 0) + 1
        self.session.add(run)
        await self.session.commit()
        await self.session.refresh(run)

        log.info("run_resumed", run_id=str(run_id))
        return run

    # ------------------------------------------------------------------
    # 5. Checkpoint
    # ------------------------------------------------------------------

    async def save_checkpoint(
        self,
        run_id: uuid.UUID,
        data: dict,
        expected_version: int,
    ) -> int:
        """Save checkpoint data with optimistic locking.

        Increments ``checkpoint_version`` on success.

        Args:
            run_id: The AgentRun UUID.
            data: Arbitrary checkpoint payload (must be JSON-serializable).
            expected_version: The checkpoint_version we expect.

        Returns:
            The new checkpoint_version.

        Raises:
            OptimisticLockError: checkpoint_version mismatch.
        """
        run = await self.session.get(AgentRun, run_id)
        if run is None:
            from app.core.errors import AgentRunNotFound

            raise AgentRunNotFound(
                f"Run '{run_id}' not found.",
                details={"run_id": str(run_id)},
            )

        if run.checkpoint_version != expected_version:
            raise OptimisticLockError(
                f"Checkpoint version conflict for run '{run_id}'. "
                f"Expected {expected_version}, actual {run.checkpoint_version}.",
                details={
                    "run_id": str(run_id),
                    "expected_version": expected_version,
                    "actual_version": run.checkpoint_version,
                },
            )

        new_version = expected_version + 1
        run.checkpoint_data = data
        run.checkpoint_version = new_version
        self.session.add(run)
        await self.session.commit()
        await self.session.refresh(run)

        log.info(
            "checkpoint_saved",
            run_id=str(run_id),
            checkpoint_version=new_version,
        )
        return new_version

    async def load_checkpoint(self, run_id: uuid.UUID) -> dict | None:
        """Load the latest checkpoint data.

        Args:
            run_id: The AgentRun UUID.

        Returns:
            The checkpoint data dict, or ``None`` if no checkpoint exists.
        """
        run = await self.session.get(AgentRun, run_id)
        if run is None:
            return None
        return run.checkpoint_data

    # ------------------------------------------------------------------
    # 6. Approval
    # ------------------------------------------------------------------

    async def request_approval(self, run_id: uuid.UUID) -> str:
        """Generate an approval_token and mark the run as pending_approval.

        Args:
            run_id: The AgentRun UUID.

        Returns:
            The generated approval_token.

        Raises:
            AgentRunNotFound: run does not exist.
        """
        run = await self.session.get(AgentRun, run_id)
        if run is None:
            from app.core.errors import AgentRunNotFound

            raise AgentRunNotFound(
                f"Run '{run_id}' not found.",
                details={"run_id": str(run_id)},
            )

        token = secrets.token_urlsafe(32)
        run.approval_token = token
        run.status = "pending_approval"
        self.session.add(run)
        await self.session.commit()
        await self.session.refresh(run)

        log.info("approval_requested", run_id=str(run_id))
        return token

    async def approve(self, run_id: uuid.UUID, token: str) -> AgentRun:
        """Validate an approval_token and resume execution.

        The token is consumed (set to ``None``) after successful approval.

        Args:
            run_id: The AgentRun UUID.
            token: The approval_token presented by the client.

        Returns:
            The updated AgentRun.

        Raises:
            AgentRunNotFound: run does not exist.
            InvalidTokenError: token mismatch or already consumed.
            AgentRunNotPendingApproval: run is not in pending_approval state.
        """
        run = await self.session.get(AgentRun, run_id)
        if run is None:
            from app.core.errors import AgentRunNotFound

            raise AgentRunNotFound(
                f"Run '{run_id}' not found.",
                details={"run_id": str(run_id)},
            )

        if run.status != "pending_approval":
            raise AgentRunNotPendingApproval(
                f"Run '{run_id}' is not pending approval (status={run.status}).",
                details={"run_id": str(run_id), "status": run.status},
            )

        if run.approval_token is None or run.approval_token != token:
            raise InvalidTokenError(
                "Invalid or expired approval token.",
                details={"run_id": str(run_id)},
            )

        # Consume token and resume
        run.approval_token = None
        run.status = "pending"
        self.session.add(run)
        await self.session.commit()
        await self.session.refresh(run)

        log.info("run_approved", run_id=str(run_id))
        return run

    # ------------------------------------------------------------------
    # 7. SillySpec dispatch
    # ------------------------------------------------------------------

    async def start_sillyspec_run(
        self,
        *,
        change_key: str,
        workspace_id: uuid.UUID,
        user_id: uuid.UUID,
        scope: str = "full",
        repo_dir: Path,
    ) -> AgentRun:
        """Create and launch a SillySpec AgentRun in the background.

        .. deprecated::
            ``start_sillyspec_run`` bypasses the Agent adapter layer and
            directly runs a subprocess, preventing log/status/progress
            collection.  Use
            ``SillySpecStageDispatchService.dispatch_next_step()``
            instead.

        Args:
            change_key: Change key (e.g. "2026-05-31-my-feature").
            workspace_id: Workspace UUID.
            user_id: User who triggered the run.
            scope: ``"full"`` or ``"quick"``.
            repo_dir: Repository root directory.

        Returns:
            The newly created AgentRun record (status=pending).
        """
        # ── deprecated warning ──
        warnings.warn(
            "start_sillyspec_run is deprecated. "
            "Use SillySpecStageDispatchService.dispatch_next_step() instead.",
            DeprecationWarning,
            stacklevel=2,
        )
        log.warning(
            "deprecated_method_called",
            method="start_sillyspec_run",
            change_key=change_key,
            scope=scope,
        )

        run = AgentRun(
            id=uuid.uuid4(),
            task_id=None,  # change-level run, not tied to a task
            lease_id=None,  # no lease needed
            agent_type=f"sillyspec_{scope}",
            status="pending",
            spec_strategy="sillyspec",
        )
        self.session.add(run)
        await self.session.commit()
        await self.session.refresh(run)

        # Fire-and-forget background task
        self._fire_background_task(
            self._run_sillyspec_background(
                run_id=run.id,
                change_key=change_key,
                scope=scope,
                repo_dir=repo_dir,
                workspace_id=workspace_id,
                user_id=user_id,
            ),
            workspace_id=workspace_id,
            run_id=run.id,
        )
        return run

    @asynccontextmanager
    async def _short_db(self) -> AsyncIterator[AsyncSession]:
        """Open a short-lived session that returns its pool slot on exit.

        Background tasks must NOT hold the request-scoped ``self.session``
        across long awaits (e.g. ``subprocess.communicate``): it keeps a
        connection checked out for the whole run and, because the task
        outlives the request, the request session may already be closed.
        Each DB touch in ``_run_sillyspec_background`` opens its own session
        here instead. The request session's ``audit_context`` is propagated
        so the audit hooks still fire (``agent_runs`` is audited).
        """
        db = get_session_factory()()
        audit_ctx = self.session.info.get("audit_context")
        if audit_ctx is not None:
            db.info["audit_context"] = audit_ctx
        try:
            yield db
        finally:
            await db.close()

    async def _run_sillyspec_background(
        self,
        *,
        run_id: uuid.UUID,
        change_key: str,
        scope: str,
        repo_dir: Path,
        workspace_id: uuid.UUID,
        user_id: uuid.UUID,
    ) -> None:
        """Execute a sillyspec command in the background and persist results.

        .. deprecated::
            This method is called internally by ``start_sillyspec_run``
            and is likewise deprecated.
        """
        log.warning(
            "deprecated_method_called",
            method="_run_sillyspec_background",
            run_id=str(run_id),
        )

        from datetime import datetime

        # Load the run and mark it running in a short-lived session, then
        # release the connection BEFORE spawning the subprocess so the
        # (potentially minutes-long) child process does not hold a pool slot.
        async with self._short_db() as db:
            run = await db.get(AgentRun, run_id)
            if run is None:
                return
            run.status = "running"
            run.started_at = datetime.now(UTC)
            db.add(run)
            await db.commit()

        try:
            # Build command
            if scope == "full":
                cmd = ["sillyspec", "run", "--change", change_key]
            else:
                cmd = ["sillyspec", "quick", "--change", change_key]

            process = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=str(repo_dir),
            )
            stdout, _stderr = await process.communicate()

            # Persist result in a fresh short-lived session (the session used
            # to mark running above was already closed before the subprocess).
            async with self._short_db() as db:
                run = await db.get(AgentRun, run_id)
                if run is not None:
                    run.status = "completed" if process.returncode == 0 else "failed"
                    run.finished_at = datetime.now(UTC)
                    run.exit_code = process.returncode
                    run.output_redacted = (stdout or b"").decode("utf-8", errors="replace")[:10000]
                    db.add(run)
                    await db.commit()

            log.info(
                "sillyspec_run_completed",
                run_id=str(run_id),
                exit_code=process.returncode,
            )
        except Exception as exc:
            log.error("sillyspec_run_failed", run_id=str(run_id), error=str(exc))
            async with self._short_db() as db:
                run = await db.get(AgentRun, run_id)
                if run is not None:
                    run.status = "failed"
                    run.finished_at = datetime.now(UTC)
                    run.exit_code = 1
                    run.output_redacted = str(exc)[:10000]
                    db.add(run)
                    await db.commit()
        finally:
            # Safety net: ensure run is never stuck in "running"
            try:
                async with self._short_db() as db:
                    run = await db.get(AgentRun, run_id)
                    if run is not None and run.status == "running":
                        run.status = "failed"
                        run.finished_at = datetime.now(UTC)
                        run.exit_code = -1
                        run.output_redacted = "Force-failed: task lifecycle guard"[:10000]
                        db.add(run)
                        await db.commit()
            except Exception:
                log.error(
                    "sillyspec_run_finally_guard_failed",
                    run_id=str(run_id),
                )
