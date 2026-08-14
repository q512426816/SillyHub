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

# 跨平台子进程仍可启动所需的最小 OS 环境白名单(全部系统/运行时配置,不含任何密钥)。
# build_env_vars 在隔离宿主 os.environ 的同时把这些非密项透传给子进程:
# - Windows: SYSTEMROOT — Python/Win32 启动必需,缺则 python 子进程启动失败;
#   TEMP/TMP — 临时目录;PATHEXT — 按 PATH 解析 .exe;COMSPEC — 可能起的 cmd。
# - POSIX: TMPDIR/TEMP/TMP — 临时目录;LANG/LC_* — locale,影响 glibc/工具默认编码。
# SECRET_KEY / DB / Redis 密码 / API key / token 等主密钥一律不在此列。
_OS_ENV_ALLOWLIST: tuple[str, ...] = (
    "SYSTEMROOT",
    "TEMP",
    "TMP",
    "PATHEXT",
    "COMSPEC",
    "TMPDIR",
    "LANG",
    "LC_ALL",
    "LC_CTYPE",
    "LC_MESSAGES",
)


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
        """写 lease 隔离目录的 ``gitconfig``（``[user] name/email``）。

        写入前防御性拒绝含换行 / 回车的 username / email（ValueError fail-fast，
        不落盘）。这是 gitconfig 换行注入的**纵深防御**而非重复校验：schema 层
        （GitIdentityCreate pattern，security-audit-remediation task-10）已拦
        HTTP 入口，本层防的是绕过 schema 的路径——service 直调传入的存量旧数据
        / 内部构造值。注入尝试必须可观测，故抛错而非静默跳过。
        """
        for label, value in (("git_username", git_username), ("git_email", git_email)):
            if value is not None and ("\n" in value or "\r" in value):
                raise ValueError(
                    f"{label} must not contain newline characters "
                    f"(gitconfig injection defense): {value!r}"
                )
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
        # 透传最小 OS 必需非密白名单(见 _OS_ENV_ALLOWLIST):保证子进程跨平台可启动,
        # 同时绝不带入宿主主密钥。仅复制 os.environ 中已存在且非空的项。
        for key in _OS_ENV_ALLOWLIST:
            value = os.environ.get(key)
            if value:
                env[key] = value
        return env
