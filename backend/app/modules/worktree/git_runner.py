"""Async subprocess wrapper for git operations.

All commands use ``asyncio.create_subprocess_exec`` with explicit env dicts.
No ``shell=True``, no credential leakage in args or logs.
"""

from __future__ import annotations

import asyncio
from pathlib import Path

from app.core.errors import WorktreeAcquireFailed
from app.core.logging import get_logger

log = get_logger(__name__)

CLONE_TIMEOUT = 120
WORKTREE_TIMEOUT = 30


class GitCommandError(Exception):
    """Raised when a git subprocess exits non-zero."""

    def __init__(self, cmd: list[str], returncode: int, stderr: str) -> None:
        self.cmd = cmd
        self.returncode = returncode
        self.stderr = stderr
        super().__init__(f"git {' '.join(cmd[:3])}... failed (exit {returncode})")


class GitRunner:
    """Stateless async wrapper around the ``git`` binary."""

    async def _run(
        self,
        args: list[str],
        *,
        env: dict[str, str],
        cwd: Path | None = None,
        timeout: int = WORKTREE_TIMEOUT,
    ) -> None:
        cmd = ["git", *args]
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            cwd=cwd,
            env=env,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout)
        except asyncio.TimeoutError:
            proc.kill()
            await proc.wait()
            raise WorktreeAcquireFailed(
                f"git command timed out after {timeout}s",
                details={"args": args[:3]},
            )
        if proc.returncode != 0:
            err_text = stderr.decode(errors="replace").strip()
            log.warning(
                "git_command_failed",
                args=args[:3],
                returncode=proc.returncode,
            )
            raise GitCommandError(cmd, proc.returncode, err_text)

    async def clone_bare(
        self,
        repo_url: str,
        bare_path: Path,
        env: dict[str, str],
    ) -> None:
        if bare_path.exists() and (bare_path / "HEAD").exists():
            return
        bare_path.parent.mkdir(parents=True, exist_ok=True)
        try:
            await self._run(
                ["clone", "--bare", str(repo_url), str(bare_path)],
                env=env,
                timeout=CLONE_TIMEOUT,
            )
        except GitCommandError as exc:
            raise WorktreeAcquireFailed(
                "Failed to clone bare repository.",
                details={"stderr": exc.stderr[:500]},
            ) from exc

    async def worktree_add(
        self,
        bare_path: Path,
        worktree_path: Path,
        branch_name: str,
        env: dict[str, str],
    ) -> None:
        worktree_path.parent.mkdir(parents=True, exist_ok=True)
        try:
            await self._run(
                [
                    "worktree",
                    "add",
                    str(worktree_path),
                    "-b",
                    branch_name,
                    "HEAD",
                ],
                env=env,
                cwd=bare_path,
                timeout=WORKTREE_TIMEOUT,
            )
        except GitCommandError as exc:
            # Branch may already exist; try without -b
            if "already exists" in exc.stderr or "already taken" in exc.stderr:
                try:
                    await self._run(
                        ["worktree", "add", str(worktree_path)],
                        env=env,
                        cwd=bare_path,
                        timeout=WORKTREE_TIMEOUT,
                    )
                    return
                except GitCommandError:
                    pass
            raise WorktreeAcquireFailed(
                "Failed to create worktree.",
                details={"stderr": exc.stderr[:500]},
            ) from exc

    async def worktree_remove(
        self,
        worktree_path: Path,
        env: dict[str, str],
    ) -> None:
        if not worktree_path.exists():
            return
        try:
            await self._run(
                ["worktree", "remove", "--force", str(worktree_path)],
                env=env,
                timeout=WORKTREE_TIMEOUT,
            )
        except GitCommandError:
            log.warning("worktree_remove_failed", path=str(worktree_path))
