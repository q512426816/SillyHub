"""Workspace management for SillyHub daemon.

Implements Strategy A: mirror workspace.
- On first use, git clone from server repo URL to local directory.
- Before each task execution, git pull to ensure latest state.
- After task execution, collect diff (git diff) for upload to server.
"""

from __future__ import annotations

import asyncio
import logging
import shutil
from pathlib import Path

logger = logging.getLogger(__name__)


class WorkspaceManager:
    """Manages local workspace mirrors for task execution."""

    def __init__(self, base_dir: str | Path) -> None:
        self._base_dir = Path(base_dir)
        self._base_dir.mkdir(parents=True, exist_ok=True)

    async def prepare_workspace(
        self,
        workspace_name: str,
        repo_url: str | None = None,
        branch: str = "main",
    ) -> Path:
        """Ensure a local mirror of the workspace exists and is up-to-date.

        1. If directory doesn't exist (or has no .git) -> git clone
        2. If exists with .git -> git pull --ff-only
        3. Return the workspace path

        Args:
            workspace_name: Unique name for the workspace directory.
            repo_url: Git remote URL. Required for initial clone.
            branch: Branch to checkout (default "main").

        Returns:
            Path to the local workspace directory.
        """
        ws_dir = self._base_dir / workspace_name

        if ws_dir.exists() and (ws_dir / ".git").exists():
            await self._run_git(["pull", "--ff-only"], cwd=ws_dir)
            logger.info("workspace_pulled path=%s", ws_dir)
        elif repo_url:
            # git clone runs from the base directory; the last arg is the
            # destination directory that git will create.
            await self._run_git(
                ["clone", "-b", branch, repo_url, str(ws_dir)],
                cwd=self._base_dir,
            )
            logger.info("workspace_cloned url=%s path=%s", repo_url, ws_dir)
        else:
            # No repo URL provided -- create an empty directory.
            ws_dir.mkdir(parents=True, exist_ok=True)
            logger.info("workspace_created_empty path=%s", ws_dir)

        return ws_dir

    async def collect_diff(self, workspace_path: Path) -> dict:
        """Collect changes from the workspace as a unified diff.

        Returns:
            Dictionary with keys:
                patch: full unified diff text (str)
                files_changed: number of changed files (int)
                insertions: number of added lines (int)
                deletions: number of removed lines (int)
                stats: short stat summary line (str)
        """
        status = await self._run_git(
            ["status", "--porcelain"], cwd=workspace_path, capture=True
        )

        if not status.strip():
            return {
                "patch": "",
                "files_changed": 0,
                "insertions": 0,
                "deletions": 0,
                "stats": "",
            }

        # Numeric stats (--shortstat).
        shortstat = await self._run_git(
            ["diff", "--shortstat"], cwd=workspace_path, capture=True
        )

        # Full unified diff.
        diff_output = await self._run_git(["diff"], cwd=workspace_path, capture=True)

        files_changed, insertions, deletions = _parse_shortstat(shortstat)

        return {
            "patch": diff_output,
            "files_changed": files_changed,
            "insertions": insertions,
            "deletions": deletions,
            "stats": shortstat.strip(),
        }

    async def clean_workspace(self, workspace_name: str) -> None:
        """Remove a workspace directory entirely."""
        ws_dir = self._base_dir / workspace_name
        if ws_dir.exists():
            shutil.rmtree(ws_dir, onexc=_on_rmtree_error)
            logger.info("workspace_cleaned path=%s", ws_dir)

    def get_workspace_path(self, workspace_name: str) -> Path:
        """Return the expected path for a workspace (may not exist yet)."""
        return self._base_dir / workspace_name

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    async def _run_git(
        self,
        args: list[str],
        *,
        cwd: Path,
        capture: bool = False,
    ) -> str:
        """Run a git subprocess and return stdout when *capture* is True."""
        cmd = ["git"] + args
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            cwd=str(cwd),
            stdout=asyncio.subprocess.PIPE if capture else asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=60)

        if proc.returncode != 0:
            error = (stderr or b"").decode(errors="replace")
            raise RuntimeError(f"git {' '.join(args)} failed: {error}")

        return (stdout or b"").decode() if capture else ""


# ------------------------------------------------------------------
# Utility
# ------------------------------------------------------------------


def _on_rmtree_error(func, path, exc_info):
    """Handle read-only files (git objects) on Windows during rmtree."""
    import stat
    import os

    os.chmod(path, stat.S_IWRITE)
    func(path)


def _parse_shortstat(shortstat: str) -> tuple[int, int, int]:
    """Parse git diff --shortstat output into (files, insertions, deletions).

    Typical input:
        " 3 files changed, 10 insertions(+), 2 deletions(-)"
    May also be:
        " 1 file changed, 5 insertions(+)"
        " 2 files changed, 3 deletions(-)"
    """
    files_changed = 0
    insertions = 0
    deletions = 0

    text = shortstat.strip()
    if not text:
        return (0, 0, 0)

    # "X file(s) changed"
    for token in text.split(","):
        token = token.strip()
        if "file" in token:
            parts = token.split()
            if parts and parts[0].isdigit():
                files_changed = int(parts[0])
        elif "insertion" in token:
            parts = token.split()
            if parts and parts[0].isdigit():
                insertions = int(parts[0])
        elif "deletion" in token:
            parts = token.split()
            if parts and parts[0].isdigit():
                deletions = int(parts[0])

    return (files_changed, insertions, deletions)
