"""Async subprocess wrapper for git operations.

All commands use ``asyncio.create_subprocess_exec`` with explicit env dicts.
No ``shell=True``, no credential leakage in args or logs.
"""

from __future__ import annotations

import asyncio
from pathlib import Path

from app.core.errors import WorktreeAcquireFailed
from app.core.logging import get_logger
from app.core.ssrf import assert_safe_repo_url

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
            _stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout)
        except TimeoutError:
            proc.kill()
            await proc.wait()
            raise WorktreeAcquireFailed(
                f"git 命令超时（{timeout} 秒），请稍后重试。",
                details={"args": args[:3]},
            ) from None
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
        # 协议白名单：拒 ext::（remote helper RCE）/ file://（读本地文件）/ 裸路径，
        # 放行 https/ssh/git + scp-like（含内网 git，design B3 / D-004）。非法抛 UnsafeRepoUrl(400)。
        assert_safe_repo_url(repo_url)
        bare_path.parent.mkdir(parents=True, exist_ok=True)
        try:
            await self._run(
                ["clone", "--bare", str(repo_url), str(bare_path)],
                env=env,
                timeout=CLONE_TIMEOUT,
            )
        except GitCommandError as exc:
            # BS-10（2026-08-20 审计）：repo_url 可内嵌 https://user:token@host，
            # 失败 stderr 常回显完整 URL，回传前先套 redact_output 再截断。
            # 延迟导入：模块级 import 会与 git_gateway → worktree 成环。
            from app.modules.git_gateway.service import redact_output

            raise WorktreeAcquireFailed(
                "代码仓库克隆失败，请检查仓库地址与网络后重试。",
                details={"stderr": redact_output(exc.stderr)[:500]},
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
                "创建代码工作区失败，请重试。",
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
