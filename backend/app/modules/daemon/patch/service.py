"""Patch service — applies unified diff patches to agent run worktrees.

Extracted from DaemonService (2026-06-22-daemon-service-split task-03).
Behavior is byte-for-byte identical to the original DaemonService._apply_patch_to_worktree
/ _run_git_apply methods.
"""

from __future__ import annotations

import asyncio
from pathlib import Path
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import col

from app.core.errors import AppError
from app.core.logging import get_logger
from app.modules.agent.model import AgentRun  # noqa: F401  (对齐原 import 风格)
from app.modules.workspace.model import AgentRunWorkspace, Workspace

log = get_logger(__name__)


# ── Domain errors (task-07 迁入；原 facade service.py:85/90 字符级搬入) ───────


class PatchApplyError(AppError):
    code = "HTTP_422_PATCH_APPLY_ERROR"
    http_status = 422


class PatchConflictError(AppError):
    code = "HTTP_409_PATCH_CONFLICT"
    http_status = 409


class PatchService:
    """Applies unified diff patches to the workspace associated with an agent run.

    子域归位判据（design §5.1）：操作对象 = worktree patch 应用 → 归 patch 子域。
    """

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def apply_patch_to_worktree(
        self,
        agent_run_id: UUID,
        patch_data: str,
        use_3way: bool = True,
    ) -> None:
        """Apply a unified diff patch to the workspace associated with *agent_run_id*.

        Steps:
        1. Resolve the workspace root_path via the AgentRunWorkspace M:N table.
        2. Run ``git apply --check`` to validate the patch.
        3. If the check fails and *use_3way* is True, retry with ``--3way``.
        4. If 3way also fails raise :class:`PatchConflictError`.
        5. If the check succeeds, apply the patch normally.
        """
        # 1. Resolve workspace root_path
        ws_stmt = (
            select(AgentRunWorkspace.workspace_id)
            .where(col(AgentRunWorkspace.agent_run_id) == agent_run_id)
            .limit(1)
        )
        ws_row = (await self._session.execute(ws_stmt)).first()
        if ws_row is None:
            raise PatchApplyError(
                f"No workspace associated with agent_run '{agent_run_id}'.",
                details={"agent_run_id": str(agent_run_id)},
            )

        workspace = await self._session.get(Workspace, ws_row[0])
        if workspace is None:
            raise PatchApplyError(
                f"Workspace '{ws_row[0]}' not found.",
                details={"workspace_id": str(ws_row[0])},
            )

        workdir = Path(workspace.root_path)

        # 2. git apply --check
        check_ok, check_stderr = await self._run_git_apply(
            workdir=workdir,
            args=["git", "apply", "--check"],
            patch_data=patch_data,
        )

        if check_ok:
            # 5. Apply normally
            apply_ok, apply_stderr = await self._run_git_apply(
                workdir=workdir,
                args=["git", "apply"],
                patch_data=patch_data,
            )
            if not apply_ok:
                raise PatchApplyError(
                    f"git apply failed after successful check: {apply_stderr}",
                    details={
                        "agent_run_id": str(agent_run_id),
                        "workspace_id": str(workspace.id),
                        "stderr": apply_stderr,
                    },
                )
            return

        # Check failed
        if not use_3way:
            raise PatchApplyError(
                f"Patch does not apply cleanly: {check_stderr}",
                details={
                    "agent_run_id": str(agent_run_id),
                    "workspace_id": str(workspace.id),
                    "stderr": check_stderr,
                },
            )

        # 3. Try --3way
        log.info(
            "daemon_patch_check_failed_trying_3way",
            agent_run_id=str(agent_run_id),
            check_stderr=check_stderr,
        )
        merge_ok, merge_stderr = await self._run_git_apply(
            workdir=workdir,
            args=["git", "apply", "--3way"],
            patch_data=patch_data,
        )
        if not merge_ok:
            # 4. Conflict
            raise PatchConflictError(
                f"Patch conflict (3way merge failed): {merge_stderr}",
                details={
                    "agent_run_id": str(agent_run_id),
                    "workspace_id": str(workspace.id),
                    "check_stderr": check_stderr,
                    "merge_stderr": merge_stderr,
                },
            )

    @staticmethod
    async def _run_git_apply(
        *,
        workdir: Path,
        args: list[str],
        patch_data: str,
    ) -> tuple[bool, str]:
        """Run a ``git apply`` sub-command and return ``(ok, stderr)``."""
        proc = await asyncio.create_subprocess_exec(
            *args,
            cwd=str(workdir),
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        _, stderr_bytes = await proc.communicate(input=patch_data.encode())
        stderr = stderr_bytes.decode(errors="replace").strip()
        return proc.returncode == 0, stderr
