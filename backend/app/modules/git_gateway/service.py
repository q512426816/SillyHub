"""Git Gateway Service.

Whitelist/blacklist enforcement, subprocess execution, output redaction,
and audit logging for all git operations inside worktree leases.
"""

from __future__ import annotations

import asyncio
import json
import re
import uuid
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import col

from app.core.errors import AppError, PermissionDenied, WorktreeLeaseNotFound
from app.core.logging import get_logger
from app.modules.git_gateway.model import GitOperationLog
from app.modules.worktree.model import WorktreeLease

log = get_logger(__name__)

# ── Whitelist / Blacklist ───────────────────────────────────────────────────

ALLOWED_OPERATIONS: frozenset[str] = frozenset({
    "status", "diff", "add", "commit", "push", "pull", "fetch",
    "log", "branch", "checkout", "merge", "rebase",
})

BLOCKED_PATTERNS: list[re.Pattern[str]] = [
    re.compile(r"--force", re.IGNORECASE),
    re.compile(r"--hard", re.IGNORECASE),
    re.compile(r"clean\s", re.IGNORECASE),
    re.compile(r"\breflog\b", re.IGNORECASE),
    re.compile(r"--exec", re.IGNORECASE),
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
    ) -> GitOperationLog:
        """Validate, execute, and log a git operation."""
        # 1. Validate
        validate_operation(operation, args)

        # 2. Resolve lease
        lease = await self._get_active_lease(lease_id, user_id)

        # 3. Build command
        repo_dir = self._resolve_repo_dir(lease)
        cmd = ["git", operation, *args]

        # 4. Execute
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            cwd=str(repo_dir),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
        )
        try:
            stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=GIT_TIMEOUT)
        except TimeoutError:
            proc.kill()
            await proc.wait()
            raise GitOperationFailed(
                f"Git operation timed out after {GIT_TIMEOUT}s.",
                details={"operation": operation},
            ) from None

        raw_output = stdout.decode(errors="replace") if stdout else ""
        safe_output = redact_output(raw_output)
        result_code = proc.returncode if proc.returncode is not None else -1

        # 5. Log
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

    async def _get_active_lease(
        self, lease_id: uuid.UUID, user_id: uuid.UUID,
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
