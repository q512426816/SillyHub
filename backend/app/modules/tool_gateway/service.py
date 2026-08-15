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
from urllib.parse import urlparse

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError, PermissionDenied, WorktreeLeaseNotFound
from app.core.logging import get_logger
from app.core.ssrf import UnsafeRepoUrl, assert_public_url
from app.modules.git_gateway.service import redact_output
from app.modules.task.model import Task
from app.modules.tool_gateway.model import ToolOperationLog
from app.modules.tool_gateway.tool_policy import (
    PolicyLimits,
    SsrfBlocked,
    ToolPolicy,
    ToolPolicyService,
    default_policy,
)
from app.modules.workflow.model import AuditLog
from app.modules.worktree.exec_env import ExecEnvBuilder
from app.modules.worktree.model import WorktreeLease

log = get_logger(__name__)

TOOL_TYPES = frozenset(
    {
        "file_read",
        "file_write",
        "file_list",
        "file_search",
        "shell_exec",
        "run_tests",
        "http_get",
    }
)

MAX_OUTPUT_SIZE = 64_000
DEFAULT_TIMEOUT = 30
# http_get 手动逐跳重定向上限（design B4 / R-04）：每跳 assert_public_url 复查，封堵重定向绕过。
_MAX_REDIRECT_HOPS = 3

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
            "路径越出工作区租约边界，已拒绝访问。",
            details={"path": requested_path},
        ) from None

    if allowed_paths:
        rel = target.relative_to(root)
        rel_str = str(rel).replace("\\", "/")
        matched = any(
            rel_str == ap or rel_str == ap.rstrip("/") or rel_str.startswith(ap.rstrip("/") + "/")
            for ap in allowed_paths
        )
        if not matched:
            raise ToolPathForbidden(
                "路径不在任务授权的访问范围内，已拒绝访问。",
                details={"path": requested_path, "allowed_paths": allowed_paths},
            )

    return target


def validate_shell_command(command: str, args: list[str]) -> None:
    """Raise ToolOperationForbidden if the shell command is blocked."""
    combined = f"{command} {' '.join(args)}"
    for pat in SHELL_BLOCKED_PATTERNS:
        if pat.search(combined):
            raise ToolOperationForbidden(
                "命令包含被安全策略禁止的模式，已拦截。",
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
                "未知的工具类型，请检查请求参数。",
                details={"tool_type": tool_type, "available": sorted(TOOL_TYPES)},
            )

        lease, task = await self._get_lease_and_task(lease_id, user_id)
        lease_root = self._resolve_lease_root(lease)
        isolated_env = self._build_isolated_env(lease)
        allowed_paths = task.allowed_paths if task else []

        # Load or use provided policy
        if policy is None:
            policy = default_policy()

        # Policy check — raises ToolOperationForbidden on violation
        # Wave C（性能，2026-07-24 代码健壮性优化）：check 内部做同步 socket.getaddrinfo
        # （SSRF 私网检查），直接在事件循环上跑会阻塞工作协程 + 所有 daemon WS 连接直到
        # DNS 超时（慢解析器拖垮整个 worker）。check 是纯函数（无 session/DB 状态），
        # 整块移到线程池；ToolOperationForbidden 异常照常透传给调用方。
        await asyncio.to_thread(ToolPolicyService.check, policy, tool_type, params, lease_root)

        # Apply resource limits
        limits = ToolPolicyService.apply_limits(policy, params)

        result = await self._dispatch(
            tool_type, params, lease_root, allowed_paths, limits, isolated_env
        )

        # Truncate output to policy limit
        output = result.get("output", "")
        if output and len(output) > limits.max_output_size:
            output = (
                output[: limits.max_output_size] + f"\n... (truncated, {len(output)} total chars)"
            )
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
            details_json=json.dumps(
                {
                    "tool_type": tool_type,
                    "result_code": result["result_code"],
                    "lease_id": str(lease_id),
                    "policy_name": policy.name,
                }
            ),
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
        limits: PolicyLimits | None = None,
        env: dict[str, str] | None = None,
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
            raise ToolOperationForbidden(
                "不支持的工具类型，请检查请求参数。",
                details={"tool_type": tool_type},
            )

        # shell_exec / run_tests 起子进程,透传最小隔离 env(绝不继承宿主 os.environ);
        # http_get 用 httpx 不起子进程,无需 env。
        if tool_type in ("shell_exec", "run_tests"):
            return await handler(params, lease_root, env)
        if tool_type == "http_get":
            return await handler(params, lease_root)
        return await handler(params, lease_root, allowed_paths)

    async def _handle_file_read(
        self,
        params: dict,
        lease_root: Path,
        allowed_paths: list[str],
    ) -> dict:
        path_str = params.get("path", "")
        target = validate_path(lease_root, path_str, allowed_paths)

        if not target.is_file():
            return {"result_code": 1, "output": f"File not found: {path_str}"}

        try:
            # Wave C（性能）：read_text 同步阻塞 I/O 移到线程，避免大文件读取阻塞事件循环。
            content = await asyncio.to_thread(target.read_text, encoding="utf-8", errors="replace")
        except OSError as e:
            return {"result_code": 1, "output": f"Read error: {e}"}

        return {"result_code": 0, "output": redact_output(content)}

    async def _handle_file_write(
        self,
        params: dict,
        lease_root: Path,
        allowed_paths: list[str],
    ) -> dict:
        path_str = params.get("path", "")
        content = params.get("content", "")
        target = validate_path(lease_root, path_str, allowed_paths)

        def _do_write() -> None:
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(content, encoding="utf-8")

        try:
            # Wave C（性能）：同步文件 I/O 移到线程。
            await asyncio.to_thread(_do_write)
        except OSError as e:
            return {"result_code": 1, "output": f"Write error: {e}"}

        return {"result_code": 0, "output": f"Written {len(content)} chars to {path_str}"}

    async def _handle_file_list(
        self,
        params: dict,
        lease_root: Path,
        allowed_paths: list[str],
    ) -> dict:
        path_str = params.get("path", ".")
        recursive = params.get("recursive", False)
        target = validate_path(lease_root, path_str, allowed_paths)

        if not target.is_dir():
            return {"result_code": 1, "output": f"Not a directory: {path_str}"}

        def _do_list() -> list[str]:
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
            return entries

        try:
            # Wave C（性能）：rglob/iterdir 同步遍历移到线程（递归列大目录会阻塞事件循环数秒）。
            entries = await asyncio.to_thread(_do_list)
            output = "\n".join(entries) if entries else "(empty)"
        except OSError as e:
            return {"result_code": 1, "output": f"List error: {e}"}

        return {"result_code": 0, "output": output}

    async def _handle_file_search(
        self,
        params: dict,
        lease_root: Path,
        allowed_paths: list[str],
    ) -> dict:
        path_str = params.get("path", ".")
        pattern = params.get("pattern", "")
        target = validate_path(lease_root, path_str, allowed_paths)

        if not pattern:
            return {"result_code": 1, "output": "Missing search pattern."}

        def _do_search() -> list[str]:
            matches: list[str] = []
            for p in target.rglob("*"):
                if p.is_file():
                    rel = p.relative_to(target)
                    if fnmatch.fnmatch(str(rel).replace("\\", "/"), f"*{pattern}*"):
                        matches.append(f"file  {rel}")
            return matches

        try:
            # Wave C（性能）：rglob 同步遍历移到线程。
            matches = await asyncio.to_thread(_do_search)
            output = "\n".join(matches) if matches else "No matches found."
        except OSError as e:
            return {"result_code": 1, "output": f"Search error: {e}"}

        return {"result_code": 0, "output": output}

    async def _handle_shell_exec(
        self,
        params: dict,
        lease_root: Path,
        env: dict[str, str] | None,
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
                env=env,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,
            )
            try:
                stdout, _ = await asyncio.wait_for(
                    proc.communicate(),
                    timeout=timeout,
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
        self,
        params: dict,
        lease_root: Path,
        env: dict[str, str] | None,
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
                env=env,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,
            )
            try:
                stdout, _ = await asyncio.wait_for(
                    proc.communicate(),
                    timeout=timeout,
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
            failed = (
                int(summary_match.group(2) or 0)
                if summary_match.lastindex and summary_match.lastindex >= 2
                else 0
            )
            skipped = (
                int(summary_match.group(3) or 0)
                if summary_match.lastindex and summary_match.lastindex >= 3
                else 0
            )
            errors = (
                int(summary_match.group(4) or 0)
                if summary_match.lastindex and summary_match.lastindex >= 4
                else 0
            )

            # Extract failed test names
            failed_tests: list[str] = []
            for line in raw_output.split("\n"):
                fail_match = _re.match(r"FAILED (.+)", line.strip())
                if fail_match:
                    failed_tests.append(fail_match.group(1))

            # Output summary (last 50 lines)
            output_lines = raw_output.strip().split("\n")
            summary_text = (
                "\n".join(output_lines[-50:]) if len(output_lines) > 50 else raw_output.strip()
            )

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
        self,
        params: dict,
        lease_root: Path,
    ) -> dict:
        """Execute HTTP GET request with per-hop SSRF protection.

        SSRF：每跳（含重定向目标）经 ``assert_public_url`` 校验（scheme 白名单 +
        IPv4/IPv6 私网拒），封堵重定向绕过与 IPv6 私网（design B4 / D-005）。
        policy 阶段的 ``_check_not_private_ip``（IPv4-only）保留，本 handler 逐跳
        复查覆盖其盲区。
        """
        import httpx

        url = params.get("url", "")
        headers = params.get("headers", {})
        timeout = min(params.get("timeout", 10), 30)

        if not url:
            return {"result_code": 1, "output": "Missing URL."}

        # Enforce HTTPS or HTTP scheme only（fast-path 友好消息；assert_public_url 也会拒）
        parsed = urlparse(url)
        if parsed.scheme not in ("http", "https"):
            return {"result_code": 1, "output": f"Unsupported scheme: {parsed.scheme}"}

        try:
            current_url = url
            resp: httpx.Response | None = None
            async with httpx.AsyncClient(timeout=timeout, follow_redirects=False) as client:
                # 手动逐跳：≤ _MAX_REDIRECT_HOPS 次重定向，每跳 assert_public_url 复查
                # （防 3xx 跳到 169.254.169.254 / 127.0.0.1 / 内网，design B4 / R-04）。
                for hop in range(_MAX_REDIRECT_HOPS + 1):  # +1 = 初始请求
                    await assert_public_url(current_url)  # SSRF：scheme + IPv4/IPv6 私网
                    resp = await client.get(current_url, headers=headers)
                    if resp.is_redirect and hop < _MAX_REDIRECT_HOPS:
                        location = resp.headers.get("location", "")
                        # 相对路径用 resp.url join 成绝对 URL，下一跳再校验（R-04）。
                        current_url = str(httpx.URL(resp.url).join(location))
                        continue
                    break  # 非重定向 / 达重定向上限 → 取当前响应
            assert resp is not None  # 循环至少执行一次（range 非空）
            body = resp.text

            # Truncate output
            if len(body) > MAX_OUTPUT_SIZE:
                body = body[:MAX_OUTPUT_SIZE] + f"\n... (truncated, {len(body)} total chars)"

            return {
                "result_code": resp.status_code,
                "output": redact_output(body),
            }
        except (SsrfBlocked, UnsafeRepoUrl) as exc:
            return {"result_code": 1, "output": f"SSRF blocked: {exc}"}
        except httpx.TimeoutException:
            return {"result_code": -1, "output": f"HTTP request timed out after {timeout}s."}
        except httpx.RequestError as e:
            return {"result_code": 1, "output": f"HTTP request failed: {e}"}

    async def _get_lease_and_task(
        self,
        lease_id: uuid.UUID,
        user_id: uuid.UUID,
    ) -> tuple[WorktreeLease, Task | None]:
        lease = await self._session.get(WorktreeLease, lease_id)
        if lease is None:
            raise WorktreeLeaseNotFound(
                "工作区租约不存在或已失效，请重新获取后再操作。",
                details={"lease_id": str(lease_id)},
            )
        if lease.user_id != user_id:
            raise PermissionDenied("无权操作他人的工作区租约。")
        if lease.status != "locked":
            raise WorktreeLeaseNotFound(
                "工作区租约已不在锁定状态，请重新获取租约。",
                details={"lease_id": str(lease_id), "status": lease.status},
            )
        task = await self._session.get(Task, lease.task_id) if lease.task_id else None
        return lease, task

    @staticmethod
    def _build_isolated_env(lease: WorktreeLease) -> dict[str, str]:
        """构造子进程最小隔离环境(无宿主 os.environ 泄漏)。

        复用 ExecEnvBuilder.build_env_vars(lease.path):HOME / GIT_CONFIG_* /
        GIT_ASKPASS / PATH + OS 必需非密白名单。确保 shell_exec / run_tests 子进程
        既拿不到宿主主密钥,又能跨平台正常启动(Win 缺 SYSTEMROOT 会导致 python
        子进程启动失败)。
        """
        return ExecEnvBuilder().build_env_vars(Path(lease.path))

    @staticmethod
    def _resolve_lease_root(lease: WorktreeLease) -> Path:
        lease_root = Path(lease.path)
        repo_dir = ExecEnvBuilder().repo_dir(lease_root)
        if repo_dir.exists():
            return repo_dir
        return lease_root
