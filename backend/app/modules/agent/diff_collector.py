"""Diff Collector — collect git diff stats after agent execution.

Executes ``git diff --stat`` and ``git diff`` in the lease's repo directory,
redacts sensitive content, and returns a structured ``DiffResult``.
"""

from __future__ import annotations

import asyncio
import re
from dataclasses import dataclass
from pathlib import Path

from app.core.logging import get_logger
from app.modules.git_gateway.service import redact_output

log = get_logger(__name__)

# ---------------------------------------------------------------------------
# DiffResult dataclass
# ---------------------------------------------------------------------------


@dataclass
class DiffResult:
    """Structured result of a git diff collection."""

    stat_summary: str  # git diff --stat output (redacted)
    full_diff: str  # git diff output (truncated + redacted)
    files_changed: int  # number of changed files
    insertions: int  # lines added
    deletions: int  # lines removed


# Zero-value for error / no-change scenarios
ZERO_DIFF_RESULT = DiffResult(
    stat_summary="",
    full_diff="",
    files_changed=0,
    insertions=0,
    deletions=0,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_STAT_PATTERN = re.compile(
    r"(\d+) files? changed"
    r"(?:,\s+(\d+) insertions?\(\+\))?"
    r"(?:,\s+(\d+) deletions?\(-\))?"
)


def _parse_stat_numbers(stat_output: str) -> tuple[int, int, int]:
    """Parse files_changed / insertions / deletions from ``git diff --stat``.

    Returns:
        ``(files_changed, insertions, deletions)``.  ``(0, 0, 0)`` on parse
        failure.
    """
    lines = stat_output.strip().splitlines()
    if not lines:
        return 0, 0, 0

    last_line = lines[-1].strip()
    match = _STAT_PATTERN.search(last_line)
    if not match:
        return 0, 0, 0

    return (
        int(match.group(1)),
        int(match.group(2) or "0"),
        int(match.group(3) or "0"),
    )


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


async def collect_diff(
    lease_path: Path,
    *,
    max_diff_size: int = 50_000,
) -> DiffResult:
    """Collect git diff in the lease's repo directory.

    Args:
        lease_path: worktree lease root; the actual git repo lives at
            ``lease_path / "repo"``.
        max_diff_size: character limit for ``full_diff`` before truncation.

    Returns:
        A ``DiffResult``.  Returns ``ZERO_DIFF_RESULT`` on any error or when
        the directory is not a git repository.
    """
    repo_dir = lease_path / "repo"

    # 1. Check .git exists
    if not (repo_dir / ".git").exists():
        log.warning("diff_collector_no_git", path=str(repo_dir))
        return ZERO_DIFF_RESULT

    # 2. git diff --stat
    try:
        proc_stat = await asyncio.create_subprocess_exec(
            "git",
            "diff",
            "--stat",
            cwd=str(repo_dir),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout_stat, _ = await asyncio.wait_for(
            proc_stat.communicate(),
            timeout=15,
        )
    except (TimeoutError, FileNotFoundError, OSError) as exc:
        log.warning("diff_collector_stat_failed", error=str(exc))
        return ZERO_DIFF_RESULT

    if proc_stat.returncode != 0:
        log.warning(
            "diff_collector_stat_error",
            returncode=proc_stat.returncode,
        )
        return ZERO_DIFF_RESULT

    stat_raw = stdout_stat.decode("utf-8", errors="replace")

    # 3. git diff (full)
    try:
        proc_diff = await asyncio.create_subprocess_exec(
            "git",
            "diff",
            cwd=str(repo_dir),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout_diff, _ = await asyncio.wait_for(
            proc_diff.communicate(),
            timeout=30,
        )
    except (TimeoutError, FileNotFoundError, OSError) as exc:
        log.warning("diff_collector_diff_failed", error=str(exc))
        # git itself may be broken — discard stat too
        return ZERO_DIFF_RESULT

    if proc_diff.returncode != 0:
        log.warning(
            "diff_collector_diff_error",
            returncode=proc_diff.returncode,
        )
        stat_redacted = redact_output(stat_raw)
        return DiffResult(
            stat_summary=stat_redacted,
            full_diff="",
            files_changed=0,
            insertions=0,
            deletions=0,
        )

    diff_raw = stdout_diff.decode("utf-8", errors="replace")

    # 4. Truncate
    diff_truncated = diff_raw[:max_diff_size]
    if len(diff_raw) > max_diff_size:
        diff_truncated += "\n...[truncated]"

    # 5. Redact (reuses git_gateway redact_output)
    stat_redacted = redact_output(stat_raw)
    diff_redacted = redact_output(diff_truncated)

    # 6. Parse stats
    files_changed, insertions, deletions = _parse_stat_numbers(stat_raw)

    return DiffResult(
        stat_summary=stat_redacted,
        full_diff=diff_redacted,
        files_changed=files_changed,
        insertions=insertions,
        deletions=deletions,
    )
