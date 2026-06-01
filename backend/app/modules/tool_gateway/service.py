"""Tool Gateway Service.

Validates, executes, and logs tool operations inside worktree leases.
Supports file_read, file_write, file_list, file_search, shell_exec.
"""

from __future__ import annotations

import asyncio
import fnmatch
import json
import re
import uuid
from collections.abc import Callable, Coroutine
from pathlib import Path

from sqlalchemy.ext.asyncio import AsyncSession

from urllib.parse import urlparse

from app.core.errors import AppError, PermissionDenied, WorktreeLeaseNotFound
from app.core.logging import get_logger
from app.modules.git_gateway.service import redact_output
from app.modules.task.model import Task
from app.modules.tool_gateway.model import ToolOperationLog
from app.modules.tool_gateway.tool_policy import ToolPolicy, ToolPolicyService, default_policy
from app.modules.workflow.model import AuditLog
from app.modules.worktree.model import WorktreeLease

log = get_logger(__name__)

TOOL_TYPES = frozenset({
    "file_read", "file_write", "file_list", "file_search", "shell_exec",
    "run_tests", "http_get",
})

MAX_OUTPUT_SIZE = 64_000
DEFAULT_TIMEOUT = 30

SHELL_BLOCKED_PATTERNS: list[re.Pattern[str]] = [
    re.compile(r"\bsudo\b", re.IGNORECASE),
    re.compile(r"\bsu\s", re.IGNORECASE),
    re.compile(r"\brm\s+.*-[a-zA-Z]*r[a-zA-Z]*f[a-zA-Z]*\s+/", re.IGNORECASE),
    re.compile(r"\bmkfs\b", re.IGNORECASE),
    re.compile(r"\bdd\s+if=", re.IGNORECASE),
    re.compile(r">\s*/dev/sd", re.IGNORECASE),
    re.compile(r"\bnc\s", re.IGNORECASE),
    re.compile(r"\bsocat\b", re.IGNORECASE),
    re.compile(r"\bncat\b", re.IGNORECASE),
    re.compile(r"\bshutdown\b", re.IGNORECASE),
    re.compile(r"\breboot\b", re.IGNORECASE),
    re.compile(r"\bhalt\b", re.IGNORECASE),
    re.compile(r"\bpasswd\b", re.IGNORECASE),
    re.compile(r"\bcrontab\b", re.IGNORECASE),
]


class ToolOperationForbidden(AppError):
    code = "TOOL_OPERATION_FORBIDDEN"
    http_status = 403


class ToolOperationFailed(AppError):
    code = "TOOL_OPERATION_FAILED"
    http_status = 502


class ToolPathForbidden(AppError):
    code = "TOOL_PATH_FORBIDDEN"
    http_status = 403


def validate_path(
    lease_root: Path,
    requested_path: str,
    allowed_paths: list[str],
) -> Path:
    """Validate and resolve a file path within the lease boundary."""
    target = (lease_root / requested_path).resolve()
    root = lease_root.resolve()

    try:
        target.relative_to(root)
    except ValueError:
        raise ToolPathForbidden(
            f"Path escapes lease boundary: {requested_path}",
            details={"path": requested_path},
        ) from None

    if allowed_paths:
        rel = target.relative_to(root)
        rel_str = str(rel).replace("\\", "/")
        matched = any(
            rel_str == ap
            or rel_str == ap.rstrip("/")
            or rel_str.startswith(ap.rstrip("/") + "/")
            for ap in allowed_paths
        )
        if not matched:
            raise ToolPathForbidden(
                f"Path not in allowed_paths: {requested_path}",
                details={"path": requested_path, "allowed_paths": allowed_paths},
            )

    return target


def validate_shell_command(command: str, args: list[str]) -> None:
    """Raise ToolOperationForbidden if the shell command is blocked."""
    combined = f"{command} {' '.join(args)}"
    for pat in SHELL_BLOCKED_PATTERNS:
        if pat.search(combined):
            raise ToolOperationForbidden(
                f"Blocked pattern in command: {combined[:200]}",
                details={"command": command, "args": args},
            )


class ToolGatewayService:
    """Execute validated tool operations inside a worktree lease."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def execute(
        self,
        lease_id: uuid.UUID,
        user_id: uuid.UUID,
        tool_type: str,
        params: dict,
        policy: ToolPolicy | None = None,
    ) -> ToolOperationLog:
        if tool_type not in TOOL_TYPES:
            raise ToolOperationForbidden(
                f"Unknown tool type: {tool_type}",
                details={"tool_type": tool_type, "available": sorted(TOOL_TYPES)},
            )

        lease, task = await self._get_lease_and_task(lease_id, user_id)
        lease_root = self._resolve_lease_root(lease)
        allowed_paths = task.allowed_paths if task else []

        # Load or use provided policy
        if policy is None:
            policy = default_policy()

        # Policy check — raises ToolOperationForbidden on violation
        ToolPolicyService.check(policy, tool_type, params, lease_root)

        # Apply resource limits
        limits = ToolPolicyService.apply_limits(policy, params)

        result = await self._dispatch(tool_type, params, lease_root, allowed_paths, limits)

        # Truncate output to policy limit
        output = result.get("output", "")
        if output and len(output) > limits.max_output_size:
            output = output[:limits.max_output_size] + f"\n... (truncated, {len(output)} total chars)"
            result["output"] = output

        op_log = ToolOperationLog(
            id=uuid.uuid4(),
            workspace_id=lease.workspace_id,
            lease_id=lease.id,
            user_id=user_id,
            tool_type=tool_type,
            params_json=json.dumps(params) if params else None,
            result_code=result["result_code"],
            redacted_output=result["output"][:MAX_OUTPUT_SIZE] if result["output"] else None,
        )
        self._session.add(op_log)

        # Audit dual write — write to workflow AuditLog as well
        audit = AuditLog(
            id=uuid.uuid4(),
            workspace_id=lease.workspace_id,
            actor_id=user_id,
            action=f"tool:{tool_type}",
            resource_type="tool_operation",
            resource_id=op_log.id,
            details_json=json.dumps({
                "tool_type": tool_type,
                "result_code": result["result_code"],
                "lease_id": str(lease_id),
                "policy_name": policy.name,
            }),
        )
        self._session.add(audit)

        await self._session.commit()
        await self._session.refresh(op_log)

        log.info(
            "tool_gateway_exec",
            tool_type=tool_type,
            lease_id=str(lease_id),
            result_code=result["result_code"],
            policy=policy.name,
        )
        return op_log

    async def _dispatch(
        self,
        tool_type: str,
        params: dict,
        lease_root: Path,
        allowed_paths: list[str],
        limits: "PolicyLimits | None" = None,
    ) -> dict:
        handlers: dict[str, Callable[..., Coroutine[object, object, dict]]] = {
            "file_read": self._handle_file_read,
            "file_write": self._handle_file_write,
            "file_list": self._handle_file_list,
            "file_search": self._handle_file_search,
            "shell_exec": self._handle_shell_exec,
            "run_tests": self._handle_run_tests,
            "http_get": self._handle_http_get,
        }
        handler = handlers.get(tool_type)
        if handler is None:
            raise ToolOperationForbidden(f"Unhandled tool type: {tool_type}")

        if tool_type in ("shell_exec", "run_tests", "http_get"):
            return await handler(params, lease_root)
        return await handler(params, lease_root, allowed_paths)

    async def _handle_file_read(
        self, params: dict, lease_root: Path, allowed_paths: list[str],
    ) -> dict:
        path_str = params.get("path", "")
        target = validate_path(lease_root, path_str, allowed_paths)

        if not target.is_file():
            return {"result_code": 1, "output": f"File not found: {path_str}"}

        try:
            content = target.read_text(encoding="utf-8", errors="replace")
        except OSError as e:
            return {"result_code": 1, "output": f"Read error: {e}"}

        return {"result_code": 0, "output": redact_output(content)}

    async def _handle_file_write(
        self, params: dict, lease_root: Path, allowed_paths: list[str],
    ) -> dict:
        path_str = params.get("path", "")
        content = params.get("content", "")
        target = validate_path(lease_root, path_str, allowed_paths)

        try:
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(content, encoding="utf-8")
        except OSError as e:
            return {"result_code": 1, "output": f"Write error: {e}"}

        return {"result_code": 0, "output": f"Written {len(content)} chars to {path_str}"}

    async def _handle_file_list(
        self, params: dict, lease_root: Path, allowed_paths: list[str],
    ) -> dict:
        path_str = params.get("path", ".")
        recursive = params.get("recursive", False)
        target = validate_path(lease_root, path_str, allowed_paths)

        if not target.is_dir():
            return {"result_code": 1, "output": f"Not a directory: {path_str}"}

        try:
            entries: list[str] = []
            if recursive:
                for p in sorted(target.rglob("*")):
                    rel = p.relative_to(target)
                    kind = "dir" if p.is_dir() else "file"
                    entries.append(f"{kind}  {rel}")
            else:
                for p in sorted(target.iterdir()):
                    rel = p.relative_to(target)
                    kind = "dir" if p.is_dir() else "file"
                    entries.append(f"{kind}  {rel}")
            output = "\n".join(entries) if entries else "(empty)"
        except OSError as e:
            return {"result_code": 1, "output": f"List error: {e}"}

        return {"result_code": 0, "output": output}

    async def _handle_file_search(
        self, params: dict, lease_root: Path, allowed_paths: list[str],
    ) -> dict:
        path_str = params.get("path", ".")
        pattern = params.get("pattern", "")
        target = validate_path(lease_root, path_str, allowed_paths)

        if not pattern:
            return {"result_code": 1, "output": "Missing search pattern."}

        try:
            matches: list[str] = []
            for p in target.rglob("*"):
                if p.is_file():
                    rel = p.relative_to(target)
                    if fnmatch.fnmatch(str(rel).replace("\\", "/"), f"*{pattern}*"):
                        matches.append(f"file  {rel}")
            output = "\n".join(matches) if matches else "No matches found."
        except OSError as e:
            return {"result_code": 1, "output": f"Search error: {e}"}

        return {"result_code": 0, "output": output}

    async def _handle_shell_exec(
        self, params: dict, lease_root: Path,
    ) -> dict:
        command = params.get("command", "")
        args = params.get("args", [])
        timeout = min(params.get("timeout", DEFAULT_TIMEOUT), 120)

        if not command:
            return {"result_code": 1, "output": "Missing command."}

        validate_shell_command(command, args)

        cmd = [command, *args]
        try:
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                cwd=str(lease_root),
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,
            )
            try:
                stdout, _ = await asyncio.wait_for(
                    proc.communicate(), timeout=timeout,
                )
            except TimeoutError:
                proc.kill()
                await proc.wait()
                return {
                    "result_code": -1,
                    "output": f"Command timed out after {timeout}s.",
                }

            raw_output = stdout.decode(errors="replace") if stdout else ""
            safe_output = redact_output(raw_output)
            result_code = proc.returncode if proc.returncode is not None else -1
        except FileNotFoundError:
            return {"result_code": 127, "output": f"Command not found: {command}"}

        return {"result_code": result_code, "output": safe_output}

    async def _handle_run_tests(
        self, params: dict, lease_root: Path,
    ) -> dict:
        """Execute test runner (pytest) and parse structured results."""
        runner = params.get("runner", "pytest")
        test_args = params.get("args", [])
        test_path = params.get("path", ".")
        timeout = min(params.get("timeout", DEFAULT_TIMEOUT), 120)

        # Build command based on runner
        if runner == "pytest":
            cmd = ["python", "-m", "pytest", test_path, *test_args, "--tb=short", "-q"]
        elif runner == "go_test":
            cmd = ["go", "test", test_path, *test_args]
        else:
            return {"result_code": 1, "output": f"Unsupported runner: {runner}"}

        # Validate shell command against blocked patterns
        validate_shell_command(cmd[0], cmd[1:])

        try:
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                cwd=str(lease_root),
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,
            )
            try:
                stdout, _ = await asyncio.wait_for(
                    proc.communicate(), timeout=timeout,
                )
            except TimeoutError:
                proc.kill()
                await proc.wait()
                return {
                    "result_code": -1,
                    "output": f"Test run timed out after {timeout}s.",
                }

            raw_output = stdout.decode(errors="replace") if stdout else ""
            result_code = proc.returncode if proc.returncode is not None else -1

            # Parse structured results from pytest output
            structured = self._parse_test_output(raw_output, runner)
            return {
                "result_code": result_code,
                "output": json.dumps(structured) if structured else redact_output(raw_output),
            }
        except FileNotFoundError:
            return {"result_code": 127, "output": f"Runner not found: {cmd[0]}"}

    @staticmethod
    def _parse_test_output(raw_output: str, runner: str) -> dict | None:
        """Parse test runner output into structured result dict.

        Returns None if parsing fails (caller should use raw output).
        """
        import re as _re

        if runner == "pytest":
            # Match pytest summary line: "X passed, Y failed, Z skipped, W errors"
            summary_match = _re.search(
                r"(\d+) passed(?:,\s*(\d+) failed)?(?:,\s*(\d+) skipped)?(?:,\s*(\d+) errors?|,\s*(\d+) warnings?)",
                raw_output,
            )
            if not summary_match:
                # Try simpler pattern
                summary_match = _re.search(
                    r"(\d+) (?:passed|failed|error)",
                    raw_output,
                )
                if not summary_match:
                    return None

            passed = int(summary_match.group(1) or 0)
            failed = int(summary_match.group(2) or 0) if summary_match.lastindex and summary_match.lastindex >= 2 else 0
            skipped = int(summary_match.group(3) or 0) if summary_match.lastindex and summary_match.lastindex >= 3 else 0
            errors = int(summary_match.group(4) or 0) if summary_match.lastindex and summary_match.lastindex >= 4 else 0

            # Extract failed test names
            failed_tests: list[str] = []
            for line in raw_output.split("\n"):
                fail_match = _re.match(r"FAILED (.+)", line.strip())
                if fail_match:
                    failed_tests.append(fail_match.group(1))

            # Output summary (last 50 lines)
            output_lines = raw_output.strip().split("\n")
            summary_text = "\n".join(output_lines[-50:]) if len(output_lines) > 50 else raw_output.strip()

            return {
                "runner": "pytest",
                "passed": passed,
                "failed": failed,
                "skipped": skipped,
                "errors": errors,
                "failed_tests": failed_tests,
                "output_summary": redact_output(summary_text),
            }

        return None

    async def _handle_http_get(
        self, params: dict, lease_root: Path,
    ) -> dict:
        """Execute HTTP GET request with SSRF protection and domain whitelist.

        SSRF protection is enforced via ToolPolicyService._check_not_private_ip
        (called during policy check phase). This handler only does the actual
        HTTP request after validation has passed.
        """
        import httpx

        url = params.get("url", "")
        headers = params.get("headers", {})
        timeout = min(params.get("timeout", 10), 30)

        if not url:
            return {"result_code": 1, "output": "Missing URL."}

        # Enforce HTTPS or HTTP scheme only
        parsed = urlparse(url)
        if parsed.scheme not in ("http", "https"):
            return {"result_code": 1, "output": f"Unsupported scheme: {parsed.scheme}"}

        try:
            async with httpx.AsyncClient(timeout=timeout, follow_redirects=True, max_redirects=3) as client:
                resp = await client.get(url, headers=headers)
                body = resp.text

                # Truncate output
                if len(body) > MAX_OUTPUT_SIZE:
                    body = body[:MAX_OUTPUT_SIZE] + f"\n... (truncated, {len(body)} total chars)"

                return {
                    "result_code": resp.status_code,
                    "output": redact_output(body),
                }
        except httpx.TimeoutException:
            return {"result_code": -1, "output": f"HTTP request timed out after {timeout}s."}
        except httpx.RequestError as e:
            return {"result_code": 1, "output": f"HTTP request failed: {e}"}

    async def _get_lease_and_task(
        self, lease_id: uuid.UUID, user_id: uuid.UUID,
    ) -> tuple[WorktreeLease, Task | None]:
        lease = await self._session.get(WorktreeLease, lease_id)
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
        task = (
            await self._session.get(Task, lease.task_id)
            if lease.task_id
            else None
        )
        return lease, task

    @staticmethod
    def _resolve_lease_root(lease: WorktreeLease) -> Path:
        from app.modules.worktree.exec_env import ExecEnvBuilder

        lease_root = Path(lease.path)
        repo_dir = ExecEnvBuilder().repo_dir(lease_root)
        if repo_dir.exists():
            return repo_dir
        return lease_root
