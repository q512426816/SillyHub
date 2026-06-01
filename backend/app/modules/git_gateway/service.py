"""Git Gateway Service.

Whitelist/blacklist enforcement, subprocess execution, output redaction,
and audit logging for all git operations inside worktree leases.
"""

from __future__ import annotations

import asyncio
import json
import os
import re
import uuid
from pathlib import Path
from typing import TYPE_CHECKING

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import col

from app.core.errors import AppError, PermissionDenied, WorktreeLeaseNotFound
from app.core.logging import get_logger
from app.modules.git_gateway.model import GitOperationLog
from app.modules.git_identity.model import GitIdentity
from app.modules.worktree.model import WorktreeLease

if TYPE_CHECKING:
    from app.modules.git_gateway.schema import RetryPolicy

log = get_logger(__name__)

# ── Whitelist / Blacklist ───────────────────────────────────────────────────

ALLOWED_OPERATIONS: frozenset[str] = frozenset(
    {
        "status",
        "diff",
        "add",
        "commit",
        "push",
        "pull",
        "fetch",
        "log",
        "branch",
        "checkout",
        "merge",
        "rebase",
    }
)

BLOCKED_PATTERNS: list[re.Pattern[str]] = [
    re.compile(r"--force", re.IGNORECASE),
    re.compile(r"--hard", re.IGNORECASE),
    re.compile(r"clean\s", re.IGNORECASE),
    re.compile(r"\breflog\b", re.IGNORECASE),
    re.compile(r"--exec", re.IGNORECASE),
]

# ── Default git identity ────────────────────────────────────────────────────

DEFAULT_GIT_AUTHOR_NAME = "SillyHub Agent"
DEFAULT_GIT_AUTHOR_EMAIL = "agent@sillyhub.local"

# ── Shell injection patterns ────────────────────────────────────────────────

SHELL_INJECTION_PATTERNS: list[re.Pattern[str]] = [
    re.compile(r"\$\("),  # $( command substitution
    re.compile(r"`"),  # backtick command substitution
    re.compile(r";\s*\w"),  # ;cmd chain
    re.compile(r"\|\s*[a-zA-Z]"),  # |cmd pipe
    re.compile(r"&&\s*\w"),  # && chain
    re.compile(r">\s*/"),  # > /path redirect
]

# ── Redaction ───────────────────────────────────────────────────────────────

# PAT patterns: ghp_xxx, gho_xxx, ghu_xxx, ghs_xxx, github_pat_xxx
# Also catch common token shapes in URLs.
_TOKEN_PATTERN = re.compile(
    r"(ghp|gho|ghu|ghs|github_pat)_[A-Za-z0-9_]{20,}",
    re.IGNORECASE,
)
_BEARER_PATTERN = re.compile(
    r"(Bearer\s+)[A-Za-z0-9\-._~+/]+=*",
    re.IGNORECASE,
)
_URL_TOKEN_PATTERN = re.compile(
    r"(://[^:]+:)([A-Za-z0-9\-._~+/]+=*)(@)",
)

MAX_OUTPUT_SIZE = 64_000

GIT_TIMEOUT = 30


class GitOperationForbidden(AppError):
    code = "GIT_OPERATION_FORBIDDEN"
    http_status = 403


class GitOperationFailed(AppError):
    code = "GIT_OPERATION_FAILED"
    http_status = 502


def redact_output(raw: str) -> str:
    """Strip PATs and bearer tokens from git output."""
    text = _TOKEN_PATTERN.sub("***REDACTED***", raw)
    text = _BEARER_PATTERN.sub(r"\1***REDACTED***", text)
    text = _URL_TOKEN_PATTERN.sub(r"\1***REDACTED***\3", text)
    if len(text) > MAX_OUTPUT_SIZE:
        text = text[:MAX_OUTPUT_SIZE] + "\n...[truncated]"
    return text


def validate_operation(operation: str, args: list[str]) -> None:
    """Raise GitOperationForbidden if the operation is disallowed."""
    if operation not in ALLOWED_OPERATIONS:
        raise GitOperationForbidden(
            f"Operation '{operation}' is not allowed.",
            details={"operation": operation},
        )
    combined = f"{operation} {' '.join(args)}"
    for pat in BLOCKED_PATTERNS:
        if pat.search(combined):
            raise GitOperationForbidden(
                f"Blocked pattern in command: {combined[:200]}",
                details={"operation": operation, "args": args},
            )

    # Default branch push protection: reject pushes targeting main/master
    # Also reject force push short flag -f
    if operation == "push":
        protected = {"main", "master"}
        for arg in args:
            if arg in protected:
                raise GitOperationForbidden(
                    f"Push to protected branch '{arg}' is forbidden.",
                    details={"operation": operation, "args": args},
                )
            if arg == "-f":
                raise GitOperationForbidden(
                    "Blocked pattern in command: push -f",
                    details={"operation": operation, "args": args},
                )

    # Shell injection detection
    for arg in args:
        for pat in SHELL_INJECTION_PATTERNS:
            if pat.search(arg):
                raise GitOperationForbidden(
                    "Shell injection pattern detected in argument.",
                    details={"operation": operation, "args": args},
                )


class GitGatewayService:
    """Execute validated git operations inside a worktree lease."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def execute(
        self,
        lease_id: uuid.UUID,
        user_id: uuid.UUID,
        operation: str,
        args: list[str],
        retry_policy: RetryPolicy | None = None,
    ) -> GitOperationLog:
        """Validate, execute, and log a git operation."""
        # 1. Validate
        validate_operation(operation, args)

        # 2. Resolve lease
        lease = await self._get_active_lease(lease_id, user_id)

        # 3. Resolve git identity for env vars
        author_name, author_email = await self._resolve_git_identity(user_id)

        # 4. Build command + env
        repo_dir = self._resolve_repo_dir(lease)
        cmd = ["git", operation, *args]
        env = {
            **os.environ,
            "GIT_AUTHOR_NAME": author_name,
            "GIT_AUTHOR_EMAIL": author_email,
            "GIT_COMMITTER_NAME": author_name,
            "GIT_COMMITTER_EMAIL": author_email,
        }

        # 5. Execute (with optional retry on failure)
        max_attempts = 1 + (retry_policy.max_retries if retry_policy else 0)
        result_code: int = -1
        raw_output = ""

        for attempt in range(max_attempts):
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                cwd=str(repo_dir),
                env=env,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,
            )
            try:
                stdout, _ = await asyncio.wait_for(
                    proc.communicate(),
                    timeout=GIT_TIMEOUT,
                )
            except TimeoutError:
                proc.kill()
                await proc.wait()
                raise GitOperationFailed(
                    f"Git operation timed out after {GIT_TIMEOUT}s.",
                    details={"operation": operation},
                ) from None

            raw_output = stdout.decode(errors="replace") if stdout else ""
            result_code = proc.returncode if proc.returncode is not None else -1

            # Success → stop retrying
            if result_code == 0:
                break

            # Failure → retry if allowed
            if retry_policy and attempt < max_attempts - 1:
                delay = retry_policy.base_delay * (2**attempt)
                log.warning(
                    "git_gateway_retry",
                    operation=operation,
                    attempt=attempt + 1,
                    result_code=result_code,
                    delay=delay,
                )
                await asyncio.sleep(delay)

        safe_output = redact_output(raw_output)

        # 6. Log
        op_log = GitOperationLog(
            id=uuid.uuid4(),
            workspace_id=lease.workspace_id,
            lease_id=lease.id,
            user_id=user_id,
            operation=operation,
            args_json=json.dumps(args) if args else None,
            result_code=result_code,
            redacted_output=safe_output,
        )
        self._session.add(op_log)
        await self._session.commit()
        await self._session.refresh(op_log)

        log.info(
            "git_gateway_exec",
            operation=operation,
            lease_id=str(lease_id),
            result_code=result_code,
        )
        return op_log

    async def list_operations(
        self,
        user_id: uuid.UUID,
        workspace_id: uuid.UUID | None = None,
        lease_id: uuid.UUID | None = None,
        page: int = 1,
        page_size: int = 20,
    ) -> tuple[list[GitOperationLog], int]:
        """List git operation audit logs for the current user."""
        base = select(GitOperationLog).where(
            GitOperationLog.user_id == user_id,
        )
        if workspace_id is not None:
            base = base.where(GitOperationLog.workspace_id == workspace_id)
        if lease_id is not None:
            base = base.where(GitOperationLog.lease_id == lease_id)

        # Count
        from sqlalchemy import func

        count_stmt = select(func.count()).select_from(base.subquery())
        total = (await self._session.execute(count_stmt)).scalar() or 0

        # Paginate
        stmt = (
            base.order_by(GitOperationLog.timestamp.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
        rows = list((await self._session.execute(stmt)).scalars().all())
        return rows, total

    async def _resolve_git_identity(self, user_id: uuid.UUID) -> tuple[str, str]:
        """Look up a non-revoked GitIdentity for the user.

        Returns (git_username, git_email).  Falls back to defaults if none found
        or if the identity has no username/email set.
        """
        stmt = (
            select(GitIdentity)
            .where(
                GitIdentity.user_id == user_id,
                GitIdentity.revoked_at.is_(None),
            )
            .limit(1)
        )
        identity = (await self._session.execute(stmt)).scalars().first()
        if identity and identity.git_username and identity.git_email:
            return identity.git_username, identity.git_email
        return DEFAULT_GIT_AUTHOR_NAME, DEFAULT_GIT_AUTHOR_EMAIL

    async def _get_active_lease(
        self,
        lease_id: uuid.UUID,
        user_id: uuid.UUID,
    ) -> WorktreeLease:
        stmt = select(WorktreeLease).where(col(WorktreeLease.id) == lease_id)
        lease = (await self._session.execute(stmt)).scalars().first()
        if lease is None:
            raise WorktreeLeaseNotFound(
                f"Worktree lease '{lease_id}' not found.",
                details={"lease_id": str(lease_id)},
            )
        if lease.user_id != user_id:
            raise PermissionDenied("Not your worktree lease.")
        if lease.status != "locked":
            raise WorktreeLeaseNotFound(
                "Lease is not active.",
                details={"lease_id": str(lease_id), "status": lease.status},
            )
        return lease

    @staticmethod
    def _resolve_repo_dir(lease: WorktreeLease) -> Path:
        from app.modules.worktree.exec_env import ExecEnvBuilder

        lease_root = Path(lease.path)
        repo_dir = ExecEnvBuilder().repo_dir(lease_root)
        if not repo_dir.exists():
            raise GitOperationFailed(
                "Worktree directory does not exist.",
                details={"path": str(repo_dir)},
            )
        return repo_dir
