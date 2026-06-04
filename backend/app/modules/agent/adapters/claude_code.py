"""Claude Code adapter — manages claude CLI as a subprocess.

Uses stream-json protocol (matching multica's approach) to capture
full agent conversation including tool calls, thinking, and results.

author: qinyi
created_at: 2026-05-28 09:35:00
"""

from __future__ import annotations

import asyncio
import json
import os
import shutil
import uuid
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from pathlib import Path

from app.core.logging import get_logger
from app.core.redis import get_redis
from app.modules.agent.base import AgentAdapter, AgentRunResult, AgentSpecBundle, TaskContext
from app.modules.agent.context_builder import render_bundle_to_claude_md
from app.modules.git_gateway.service import redact_output

log = get_logger(__name__)

_CLAUDE_CLI = "claude"

LogCallback = Callable[[str, str, str], Awaitable[None]]


def _build_claude_command(*, disallow_ask_user: bool = False) -> list[str]:
    """Build a cross-platform Claude CLI command."""
    cmd = [
        _CLAUDE_CLI,
        "-p",
        "--output-format",
        "stream-json",
        "--input-format",
        "stream-json",
        "--verbose",
        "--permission-mode",
        "bypassPermissions",
    ]
    if disallow_ask_user:
        cmd.extend(["--disallowedTools", "AskUserQuestion"])
    if os.name != "nt" and shutil.which("stdbuf") is not None:
        return ["stdbuf", "-oL", *cmd]
    return cmd


def _build_stream_input(prompt: str) -> bytes:
    """Encode prompt as a stream-json user message for stdin."""
    payload = {
        "type": "user",
        "message": {
            "role": "user",
            "content": [{"type": "text", "text": prompt}],
        },
    }
    return json.dumps(payload, ensure_ascii=False).encode() + b"\n"


def _build_stage_dispatch_prompt(bundle: AgentSpecBundle) -> str:
    """为 stage_dispatch 模式生成明确的 SillySpec 阶段执行 prompt。

    Args:
        bundle: 已包含 stage_dispatch=True 的 AgentSpecBundle，
                必须包含 stage 和 change_key 字段。

    Returns:
        完整的阶段执行 prompt 字符串。
    """
    stage = bundle.stage or "unknown"
    change_key = bundle.change_key or "unknown"

    if bundle.stage is None:
        log.warning("stage_dispatch_missing_stage", change_key=bundle.change_key)
    if bundle.change_key is None:
        log.warning("stage_dispatch_missing_change_key", stage=bundle.stage)

    # ── scan 阶段：使用 step_prompt（已包含完整平台参数） ──
    if stage == "scan":
        prompt = bundle.step_prompt or ""
        if not prompt:
            # fallback: 从 platform_metadata 构建命令
            meta = bundle.platform_metadata or {}
            spec_root = meta.get("spec_root", "")
            runtime_root = meta.get("runtime_root", "")
            workspace_id = meta.get("workspace_id", "")
            scan_run_id = meta.get("scan_run_id", "")
            root_path = meta.get("root_path", "")
            scan_cmd = (
                f"sillyspec run scan"
                f" --dir {root_path}"
                f" --spec-root {spec_root}"
                f" --runtime-root {runtime_root}"
                f" --workspace-id {workspace_id}"
                f" --scan-run-id {scan_run_id}"
            )
            prompt = (
                f"你是一个项目分析 agent。请对项目目录 {root_path} 执行 sillyspec scan。\n\n"
                f"## 重要：sillyspec scan 是分步交互式 CLI\n"
                f"运行 scan 命令后会输出当前步骤的 prompt，你必须：\n"
                f"1. 读 step prompt\n"
                f"2. 按 prompt 的指示执行操作（扫描文件、分析结构等）\n"
                f'3. 用 --done 完成当前步骤：\n'
                f'   sillyspec run scan --done --change default --input "步骤描述" --output "步骤摘要"\n'
                f"4. CLI 会自动输出下一步 prompt，重复直到所有步骤完成\n\n"
                f"## 执行步骤\n"
                f"1. 先执行 init（如果尚未初始化）：\n"
                f"   sillyspec init --dir {spec_root}\n"
                f"2. 开始 scan（带完整平台参数）：\n"
                f"   {scan_cmd}\n"
                f"3. 按 step prompt 逐步执行，每步用 --done 推进\n"
                f"4. 所有步骤完成后确认\n\n"
                f"## 规则\n"
                f"- 对 {root_path} 目录只读，不要修改任何项目文件\n"
                f"- 所有产出写入 {spec_root} 目录\n"
                f"- 每个步骤必须用 --done 完成，不要跳过\n"
                f"- 运行 scan 命令后会输出 step prompt，仔细阅读后执行"
            )
        if bundle.read_only:
            prompt += "\n## 模式: READ-ONLY\nDo NOT modify any files. Only analyze and report.\n"
        return prompt

    # ── 通用阶段（propose/plan/execute 等） ──
    prompt = (
        f"你是 SillySpec {stage} 阶段的执行者。\n\n"
        f"## 任务\n"
        f"为变更 {change_key} 完成 SillySpec {stage} 阶段。\n\n"
        f"## 执行步骤\n"
        f"1. 运行 `sillyspec run {stage} --change {change_key}`\n"
        f"2. 阅读当前 step 的 prompt\n"
        f"3. 按 prompt 完成工作\n"
        f"4. `sillyspec run {stage} --done --change {change_key} --input '...' --output '...'`\n"
        f"5. 重复直到所有步骤完成\n\n"
        f"## 规则\n"
        f"- 所有文档写入 `.sillyspec/changes/{change_key}/`\n"
        f"- 只产出文档，禁止改代码\n"
        f"- 文档头部 author + created_at\n"
        f"- 每步完成立即 --done\n"
    )

    if bundle.read_only:
        prompt += "\n## 模式: READ-ONLY\nDo NOT modify any files. Only analyze and report.\n"

    if bundle.step_prompt is not None:
        prompt += f"\n## 当前步骤 Prompt\n{bundle.step_prompt}\n"

    return prompt


def _extract_tool_use_blocks(event: dict) -> list[dict]:
    """Extract tool_use content blocks from a stream-json event."""
    if event.get("type") != "assistant":
        return []
    blocks: list[dict] = []
    for block in event.get("message", {}).get("content", []):
        if isinstance(block, dict) and block.get("type") == "tool_use":
            blocks.append(block)
    return blocks


def _parse_stream_events(raw_stdout: str) -> list[dict]:
    """Parse stream-json stdout into structured event list."""
    events: list[dict] = []
    for line in raw_stdout.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            events.append(json.loads(line))
        except json.JSONDecodeError:
            events.append({"type": "raw", "text": line})
    return events


def _format_conversation_log(events: list[dict]) -> str:
    """Convert stream events into a human-readable conversation log."""
    lines: list[str] = []
    for event in events:
        etype = event.get("type", "")

        if etype == "assistant":
            message = event.get("message", {})
            content_blocks = message.get("content", [])
            for block in content_blocks:
                if not isinstance(block, dict):
                    continue
                btype = block.get("type", "")
                if btype == "text":
                    text = block.get("text", "").strip()
                    if text:
                        lines.append(f"[ASSISTANT] {text}")
                elif btype == "thinking":
                    text = (block.get("thinking") or block.get("text") or "").strip()
                    if text:
                        preview = text[:300] + ("..." if len(text) > 300 else "")
                        lines.append(f"[THINKING] {preview}")
                elif btype == "tool_use":
                    tool_name = block.get("name", "unknown")
                    tool_input = block.get("input", {})
                    if isinstance(tool_input, dict):
                        cmd_str = tool_input.get("command", "")
                        if cmd_str:
                            lines.append(f"[TOOL_USE] {tool_name}: {cmd_str}")
                        else:
                            args_preview = json.dumps(tool_input, ensure_ascii=False)[:200]
                            lines.append(f"[TOOL_USE] {tool_name}: {args_preview}")

        elif etype == "user":
            message = event.get("message", {})
            content_blocks = message.get("content", [])
            for block in content_blocks:
                if isinstance(block, dict) and block.get("type") == "tool_result":
                    content = block.get("content", "")
                    if isinstance(content, str) and content.strip():
                        preview = content.strip()[:500]
                        lines.append(f"[TOOL_RESULT] {preview}")

        elif etype == "result":
            text = event.get("result", "").strip()
            subtype = event.get("subtype", "")
            duration_ms = event.get("duration_ms")
            num_turns = event.get("num_turns")
            cost_info = ""
            if duration_ms is not None:
                cost_info += f" duration={duration_ms}ms"
            if num_turns is not None:
                cost_info += f" turns={num_turns}"
            label = f"[RESULT{':' + subtype if subtype else ''}]"
            if text:
                lines.append(f"{label} {text}{cost_info}")
            elif cost_info:
                lines.append(f"{label}{cost_info}")

        elif etype == "system":
            msg = event.get("message", "")
            subtype = event.get("subtype", "")
            if msg:
                lines.append(f"[SYSTEM{':' + subtype if subtype else ''}] {msg}")
            elif subtype == "init":
                lines.append("[SYSTEM:init] session started")
            elif subtype == "api_retry":
                attempt = event.get("attempt", "?")
                max_retries = event.get("max_retries", "?")
                error = event.get("error", "unknown")
                lines.append(f"[SYSTEM:api_retry] attempt {attempt}/{max_retries}, error: {error}")

        elif etype == "raw":
            lines.append(event.get("text", ""))

    return "\n".join(lines)


class ClaudeCodeAdapter(AgentAdapter):
    """Execute Claude Code CLI as a subprocess using stream-json protocol."""

    async def run_with_bundle(
        self,
        run_id: uuid.UUID,
        bundle: AgentSpecBundle,
        lease_path: Path,
        timeout: int = 600,
        on_log: LogCallback | None = None,
    ) -> AgentRunResult:
        """Execute Claude Code CLI using the full spec bundle."""
        claude_md = render_bundle_to_claude_md(bundle)
        (lease_path / "CLAUDE.md").write_text(claude_md, encoding="utf-8")

        if getattr(bundle, "stage_dispatch", False):
            prompt = _build_stage_dispatch_prompt(bundle)
            log.info(
                "stage_dispatch_prompt",
                stage=bundle.stage,
                change_key=bundle.change_key,
            )
        else:
            prompt = (
                f"Implement task {bundle.task_key}: {bundle.task_title}.\n"
                f"Change: {bundle.change_summary}.\n"
                "Read CLAUDE.md for full spec context before starting."
            )

            if "sillyspec" in bundle.available_tools:
                prompt += (
                    "\n\nYou have access to the `sillyspec` CLI tool. "
                    "Use it to generate spec files instead of writing them directly. "
                    "Commands: `sillyspec init --dir <path>`, `sillyspec run scan --dir <path>`. "
                    "The spec root directory is where .sillyspec/ structure should be created."
                )

        cmd = _build_claude_command(disallow_ask_user=True)

        env_vars: dict[str, str] = {}
        if bundle.allowed_paths:
            env_vars["CLAUDE_ALLOWED_PATHS"] = ":".join(bundle.allowed_paths)

        log.info(
            "agent_start",
            run_id=str(run_id),
            task_key=bundle.task_key,
            spec_strategy=bundle.spec_strategy,
            profile_version=bundle.profile_version,
        )

        return await self._exec_stream(
            run_id, cmd, prompt, lease_path, env_vars, timeout, on_log=on_log
        )

    async def run(
        self,
        run_id: uuid.UUID,
        task_context: TaskContext,
        lease_path: Path,
        timeout: int = 600,
        on_log: LogCallback | None = None,
    ) -> AgentRunResult:
        cmd = _build_claude_command()
        env_vars: dict[str, str] = {}
        if task_context.allowed_paths:
            env_vars["CLAUDE_ALLOWED_PATHS"] = ":".join(task_context.allowed_paths)

        log.info("agent_start", run_id=str(run_id))
        return await self._exec_stream(
            run_id, cmd, task_context.task_title, lease_path, env_vars, timeout, on_log=on_log
        )

    async def _exec_stream(
        self,
        run_id: uuid.UUID,
        cmd: list[str],
        prompt: str,
        cwd: Path,
        env_vars: dict[str, str],
        timeout: int,
        on_log: LogCallback | None = None,
    ) -> AgentRunResult:
        """Run claude CLI with stream-json protocol.

        Reads stdout line-by-line, parses each stream-json event, publishes
        formatted lines to Redis Pub/Sub channel ``agent_run:{run_id}``, and
        accumulates the full output for the returned ``AgentRunResult``.
        """
        child_env = {**os.environ, **env_vars}
        channel = f"agent_run:{run_id}"

        try:
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=cwd.as_posix(),
                env=child_env,
                limit=10 * 1024 * 1024,  # 10 MB — stream-json lines can exceed default 64 KB
            )
            log.info(
                "subprocess_created",
                run_id=str(run_id),
                pid=proc.pid,
                stdout_fd=str(proc.stdout),
            )
        except FileNotFoundError as exc:
            missing = exc.filename or cmd[0]
            message = f"CLI command '{missing}' not found while starting '{_CLAUDE_CLI}'."
            ts = datetime.now(UTC).isoformat()
            log.error("agent_cli_not_found", cli=_CLAUDE_CLI, missing=missing)
            if on_log is not None:
                try:
                    await on_log("stderr", message, ts)
                except Exception:
                    log.warning("on_log_callback_failed", run_id=str(run_id))
            try:
                redis = get_redis()
                await redis.publish(
                    channel,
                    json.dumps(
                        {
                            "channel": "stderr",
                            "content": message,
                            "timestamp": ts,
                        },
                        ensure_ascii=False,
                    ),
                )
                await redis.publish(
                    channel,
                    json.dumps({"event": "done", "timestamp": ts}),
                )
            except Exception:
                log.warning("redis_publish_spawn_failure_failed", run_id=str(run_id))
            return AgentRunResult(
                exit_code=127,
                stdout="",
                stderr=message,
                redacted_output=message,
            )

        # ---- Register process in _proc_registry ----
        # Local import to avoid circular dependency (service → claude_code → service)
        from app.modules.agent.service import AgentService

        AgentService._proc_registry[run_id] = proc

        try:
            # Write user prompt to stdin and close it
            stdin_data = _build_stream_input(prompt)
            try:
                proc.stdin.write(stdin_data)
                await proc.stdin.drain()
                proc.stdin.close()
            except Exception:
                pass

            # Acquire Redis client for Pub/Sub publishing
            redis = get_redis()

            # Accumulators
            stdout_lines: list[str] = []
            all_events: list[dict] = []

            async def _read_stdout() -> None:
                """Read stdout line-by-line, parse events, publish to Redis."""
                log.info("stdout_reader_started", run_id=str(run_id), pid=proc.pid)
                line_count = 0
                while True:
                    try:
                        line_bytes = await asyncio.wait_for(
                            proc.stdout.readline(),
                            timeout=timeout,
                        )
                    except TimeoutError:
                        log.warning(
                            "stdout_reader_timeout", run_id=str(run_id), line_count=line_count
                        )
                        break
                    except ValueError as ve:
                        log.warning("stdout_line_too_long", run_id=str(run_id), error=str(ve))
                        break
                    except Exception as exc:
                        log.error("stdout_reader_error", run_id=str(run_id), error=str(exc))
                        break
                    if not line_bytes:
                        log.info("stdout_reader_eof", run_id=str(run_id), line_count=line_count)
                        break
                    line = line_bytes.decode("utf-8", errors="replace").rstrip("\n").rstrip("\r")
                    if not line:
                        continue
                    stdout_lines.append(line)
                    line_count += 1
                    if line_count <= 3:
                        log.info(
                            "stdout_line",
                            run_id=str(run_id),
                            line_num=line_count,
                            line_preview=line[:200],
                        )

                    # Parse the stream-json event
                    try:
                        event = json.loads(line)
                    except json.JSONDecodeError:
                        event = {"type": "raw", "text": line}
                    all_events.append(event)

                    # Format into a human-readable log line
                    formatted = _format_conversation_log([event])
                    if not formatted:
                        if line_count <= 5:
                            log.info(
                                "stdout_line_no_format",
                                run_id=str(run_id),
                                event_type=event.get("type", "?"),
                                line_num=line_count,
                            )
                        continue

                    # Publish to Redis — detect tool_use events for tool_call channel
                    try:
                        ts = datetime.now(UTC).isoformat()
                        tool_use_blocks = _extract_tool_use_blocks(event)
                        # Publish formatted text as stdout
                        msg = json.dumps(
                            {
                                "channel": "stdout",
                                "content": formatted,
                                "timestamp": ts,
                            },
                            ensure_ascii=False,
                        )
                        await redis.publish(channel, msg)
                        # Incremental DB write for stdout
                        if on_log:
                            try:
                                await on_log("stdout", formatted[:4000], ts)
                            except Exception:
                                log.warning("on_log_callback_failed", run_id=str(run_id))
                        # Publish structured tool_call events
                        for tb in tool_use_blocks:
                            tc_content = json.dumps(
                                {
                                    "tool": tb.get("name", "unknown"),
                                    "args": tb.get("input", {}),
                                    "timestamp": ts,
                                    "status": "allowed",
                                    "success": True,
                                },
                                ensure_ascii=False,
                            )
                            tc_msg = json.dumps(
                                {
                                    "channel": "tool_call",
                                    "content": tc_content,
                                    "timestamp": ts,
                                },
                                ensure_ascii=False,
                            )
                            await redis.publish(channel, tc_msg)
                            if on_log:
                                try:
                                    await on_log("tool_call", tc_content[:4000], ts)
                                except Exception:
                                    log.warning("on_log_callback_failed", run_id=str(run_id))
                    except Exception:
                        log.warning("redis_publish_failed", run_id=str(run_id))

            async def _read_stderr() -> str:
                """Read stderr fully after process ends."""
                raw = await proc.stderr.read()
                return raw.decode("utf-8", errors="replace")

            try:
                stdout_task = asyncio.create_task(_read_stdout())
                await proc.wait()
                # stdout task should finish once the pipe closes
                await asyncio.wait_for(stdout_task, timeout=5)
            except TimeoutError:
                proc.kill()
                await proc.wait()
                log.warning("agent_timeout", run_id=str(run_id))
                # Publish done event before returning
                try:
                    done_msg = json.dumps(
                        {
                            "channel": "stdout",
                            "content": "[TIMEOUT] Agent execution timed out.",
                            "timestamp": datetime.now(UTC).isoformat(),
                        },
                        ensure_ascii=False,
                    )
                    await redis.publish(channel, done_msg)
                    await redis.publish(
                        channel,
                        json.dumps({"event": "done", "timestamp": datetime.now(UTC).isoformat()}),
                    )
                except Exception:
                    pass
                return AgentRunResult(
                    exit_code=-1,
                    stdout="",
                    stderr="Agent timed out.",
                    redacted_output="Agent execution timed out.",
                    timed_out=True,
                )

            stderr_raw = await _read_stderr()
            stdout_raw = "\n".join(stdout_lines)

            # Publish done event
            try:
                await redis.publish(
                    channel,
                    json.dumps({"event": "done", "timestamp": datetime.now(UTC).isoformat()}),
                )
            except Exception:
                log.warning("redis_publish_done_failed", run_id=str(run_id))

            # Build conversation log from accumulated events
            conversation_log = _format_conversation_log(all_events)

            combined = conversation_log
            if stderr_raw.strip():
                combined += "\n\n[STDERR]\n" + stderr_raw

            redacted = redact_output(combined)

            log.info(
                "agent_done",
                run_id=str(run_id),
                exit_code=proc.returncode,
                output_len=len(redacted),
                event_count=len(all_events),
            )
            return AgentRunResult(
                exit_code=proc.returncode or 1,
                stdout=stdout_raw,
                stderr=stderr_raw,
                redacted_output=redacted,
            )

        finally:
            # ---- Unregister process from _proc_registry (guaranteed cleanup) ----
            AgentService._proc_registry.pop(run_id, None)

    def supported_tools(self) -> list[str]:
        return [
            "file_read",
            "file_write",
            "file_list",
            "file_search",
            "shell_exec",
            "git",
            "web_fetch",
        ]
