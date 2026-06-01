"""Filesystem isolation for worktree leases.

Creates directory trees, writes askpass scripts and gitconfig,
and handles secure cleanup (shred + unlink).
"""

from __future__ import annotations

import os
import stat
import sys
from pathlib import Path

from app.core.config import get_settings
from app.core.logging import get_logger

log = get_logger(__name__)


class ExecEnvBuilder:
    """Builds and tears down the isolated filesystem for a worktree lease."""

    def __init__(self, base_dir: Path | None = None) -> None:
        self._base_dir = base_dir or self._default_base_dir()

    @staticmethod
    def _default_base_dir() -> Path:
        settings = get_settings()
        return Path(settings.worktree_base_dir)

    def lease_root(
        self,
        workspace_id: str,
        component_id: str,
        user_id: str,
        change_id: str,
        task_id: str,
        run_id: str,
    ) -> Path:
        return (
            self._base_dir
            / workspace_id
            / "components"
            / component_id
            / "worktrees"
            / user_id
            / change_id
            / task_id
            / run_id
        )

    def bare_repo_path(self, workspace_id: str, component_id: str) -> Path:
        return self._base_dir / workspace_id / "components" / component_id / ".repo-bare"

    def repo_dir(self, lease_root: Path) -> Path:
        return lease_root / "repo"

    def home_dir(self, lease_root: Path) -> Path:
        return lease_root / "home"

    def gitconfig_path(self, lease_root: Path) -> Path:
        return lease_root / "gitconfig"

    def askpass_path(self, lease_root: Path) -> Path:
        if sys.platform == "win32":
            return lease_root / "askpass.cmd"
        return lease_root / "askpass.sh"

    def create_directories(self, lease_root: Path) -> None:
        self.repo_dir(lease_root).mkdir(parents=True, exist_ok=True)
        self.home_dir(lease_root).mkdir(parents=True, exist_ok=True)

    def write_gitconfig(
        self, lease_root: Path, git_username: str | None, git_email: str | None
    ) -> None:
        lines: list[str] = []
        if git_username:
            lines.append(f"[user]\n\tname = {git_username}")
        if git_email:
            if not lines:
                lines.append("[user]")
            lines.append(f"\temail = {git_email}")
        if lines:
            self.gitconfig_path(lease_root).write_text("\n".join(lines) + "\n")

    def write_askpass(self, lease_root: Path, token: str) -> None:
        path = self.askpass_path(lease_root)
        if sys.platform == "win32":
            content = f"@echo off\necho {token}\n"
        else:
            content = f'#!/bin/sh\necho "{token}"\n'
        path.write_text(content)
        if sys.platform != "win32":
            path.chmod(path.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
            path.chmod(stat.S_IRWXU)

    def shred_askpass(self, lease_root: Path) -> None:
        path = self.askpass_path(lease_root)
        if not path.exists():
            return
        try:
            size = path.stat().st_size
            for _ in range(3):
                path.write_bytes(os.urandom(size))
            path.unlink()
        except OSError:
            log.warning("shred_askpass_failed", path=str(path))

    def cleanup(self, lease_root: Path) -> None:
        import shutil

        if lease_root.exists():
            try:
                shutil.rmtree(lease_root)
            except OSError:
                log.warning("cleanup_failed", path=str(lease_root))

    def build_env_vars(self, lease_root: Path) -> dict[str, str]:
        env: dict[str, str] = {
            "HOME": str(self.home_dir(lease_root)),
            "GIT_CONFIG_GLOBAL": str(self.gitconfig_path(lease_root)),
            "GIT_ASKPASS": str(self.askpass_path(lease_root)),
            "GIT_TERMINAL_PROMPT": "0",
            "PATH": os.environ.get("PATH", ""),
        }
        if sys.platform == "win32":
            env["GIT_CONFIG_SYSTEM"] = "NUL"
        else:
            env["GIT_CONFIG_SYSTEM"] = "/dev/null"
        return env
