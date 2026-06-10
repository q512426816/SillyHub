"""JSON-RPC 2.0 over stdio protocol backend for codex/hermes/kimi/kiro.

Implements the AgentBackend interface for agents that communicate
via JSON-RPC 2.0 over stdin/stdout pipes, following the codex app-server
protocol: initialize -> notifications/initialized -> thread/start ->
turn/start -> stream item/turn notifications -> turn/completed.

Reference: multica/server/pkg/agent/codex.go
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from typing import Any

from sillyhub_daemon.backends import AgentBackend, AgentEvent, TaskResult

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_HANDSHAKE_TIMEOUT: float = 30.0
_DEFAULT_SEMANTIC_INACTIVITY_TIMEOUT: float = 600.0  # 10 minutes
_STDERR_TAIL_BYTES: int = 2048

# Provider command configuration
_PROVIDER_COMMANDS: dict[str, list[str]] = {
    "codex": ["app-server", "--listen", "stdio://"],
    "hermes": [],
    "kimi": [],
    "kiro": [],
}


# ---------------------------------------------------------------------------
# _JsonRpcTransport — JSON-RPC 2.0 message transport over stdio
# ---------------------------------------------------------------------------


class _JsonRpcTransport:
    """Low-level JSON-RPC 2.0 transport over stdin/stdout pipes.

    Handles:
    - Sending requests (with id) and awaiting responses
    - Sending notifications (no id, no response expected)
    - Responding to server requests (e.g. auto-approval)
    - Background read loop that dispatches incoming messages
    """

    def __init__(
        self,
        stdin: asyncio.StreamWriter,
        stdout_reader: asyncio.StreamReader,
    ) -> None:
        self._stdin = stdin
        self._stdout = stdout_reader
        self._next_id = 0
        self._pending: dict[int, asyncio.Future[dict]] = {}
        self._early_responses: dict[
            int, dict
        ] = {}  # responses arrived before request registered
        self._loop = asyncio.get_running_loop()
        self._read_task: asyncio.Task | None = None
        self._stopped = False
        # Callbacks for the read loop to emit events
        self.on_notification: Any = None  # async callable(method, params)
        self.on_server_request: Any = None  # async callable(id, method, params)

    # -- Public API ----------------------------------------------------------

    async def request(
        self, method: str, params: dict | None = None, *, timeout: float = 0
    ) -> dict:
        """Send a JSON-RPC request and wait for the response."""
        self._next_id += 1
        req_id = self._next_id

        msg: dict[str, Any] = {
            "jsonrpc": "2.0",
            "id": req_id,
            "method": method,
        }
        if params is not None:
            msg["params"] = params

        # Register pending BEFORE sending, so the read loop can find it
        future: asyncio.Future[dict] = self._loop.create_future()
        self._pending[req_id] = future

        # Check if response arrived early (before we registered)
        early = self._early_responses.pop(req_id, None)
        if early is not None:
            if "error" in early:
                err = early["error"]
                err_msg = (
                    err.get("message", "unknown error")
                    if isinstance(err, dict)
                    else str(err)
                )
                err_code = err.get("code", -1) if isinstance(err, dict) else -1
                future.set_exception(RuntimeError(f"{err_msg} (code={err_code})"))
            else:
                future.set_result(early.get("result", {}))

        await self._send(msg)

        if timeout > 0:
            return await asyncio.wait_for(future, timeout=timeout)
        return await future

    async def notify(self, method: str, params: dict | None = None) -> None:
        """Send a JSON-RPC notification (no id, no response)."""
        msg: dict[str, Any] = {"jsonrpc": "2.0", "method": method}
        if params is not None:
            msg["params"] = params
        await self._send(msg)

    async def respond(self, req_id: int, result: dict) -> None:
        """Respond to a server request with a result."""
        msg: dict[str, Any] = {
            "jsonrpc": "2.0",
            "id": req_id,
            "result": result,
        }
        await self._send(msg)

    def start_read_loop(self) -> asyncio.Task:
        """Start the background read loop as an asyncio Task."""
        self._read_task = asyncio.create_task(self._read_loop())
        return self._read_task

    def stop_read_loop(self) -> None:
        """Signal the read loop to stop."""
        self._stopped = True

    def close_all_pending(self, error: Exception) -> None:
        """Resolve all pending requests with the given error."""
        for fut in self._pending.values():
            if not fut.done():
                fut.set_exception(error)
        self._pending.clear()

    # -- Internal ------------------------------------------------------------

    async def _send(self, msg: dict) -> None:
        """Serialize and write a message to stdin."""
        data = json.dumps(msg) + "\n"
        self._stdin.write(data.encode())
        await self._stdin.drain()

    async def _read_loop(self) -> None:
        """Background coroutine: read lines from stdout and dispatch."""
        try:
            while not self._stopped:
                line_bytes = await self._stdout.readline()
                if not line_bytes:
                    break
                line = line_bytes.decode().strip()
                if not line:
                    continue
                await self._handle_line(line)
        except asyncio.CancelledError:
            pass
        except Exception as exc:
            logger.debug("read loop error: %s", exc)
        finally:
            self.close_all_pending(RuntimeError("JSON-RPC transport closed"))

    async def _handle_line(self, line: str) -> None:
        """Parse and dispatch a single JSON-RPC line."""
        try:
            raw = json.loads(line)
        except (json.JSONDecodeError, ValueError):
            logger.warning("Skipping non-JSON line: %s", line[:200])
            return

        if not isinstance(raw, dict):
            logger.warning("Skipping non-object JSON: %s", line[:200])
            return

        # Response to our request (has id, has result or error)
        if "id" in raw and "method" not in raw:
            await self._handle_response(raw)
            return

        # Server request (has id + method)
        if "id" in raw and "method" in raw:
            await self._handle_server_request(raw)
            return

        # Notification (no id, has method)
        if "method" in raw:
            await self._handle_notification(raw)
            return

        logger.debug("Unhandled JSON-RPC message: %s", line[:200])

    async def _handle_response(self, raw: dict) -> None:
        """Dispatch a response to the matching pending request."""
        req_id = raw.get("id")
        if not isinstance(req_id, int):
            return

        fut = self._pending.get(req_id)
        if fut is None or fut.done():
            # No pending request for this id yet — cache it for later
            self._early_responses[req_id] = raw
            return

        # Remove from pending
        self._pending.pop(req_id, None)

        if "error" in raw:
            err = raw["error"]
            msg = (
                err.get("message", "unknown error")
                if isinstance(err, dict)
                else str(err)
            )
            code = err.get("code", -1) if isinstance(err, dict) else -1
            fut.set_exception(RuntimeError(f"{msg} (code={code})"))
        else:
            fut.set_result(raw.get("result", {}))

    async def _handle_server_request(self, raw: dict) -> None:
        """Handle a server-initiated request (e.g. approval)."""
        req_id = raw.get("id", 0)
        method = raw.get("method", "")
        params = raw.get("params", {})

        # Auto-approve execution and file change requests
        if method in (
            "item/commandExecution/requestApproval",
            "execCommandApproval",
            "item/fileChange/requestApproval",
            "applyPatchApproval",
        ):
            await self.respond(req_id, {"decision": "accept"})
        elif method == "mcpServer/elicitation/request":
            await self.respond(
                req_id, {"action": "accept", "content": None, "_meta": None}
            )
        else:
            logger.warning("Unhandled server request: %s (id=%s)", method, req_id)

        if self.on_server_request is not None:
            await self.on_server_request(req_id, method, params)

    async def _handle_notification(self, raw: dict) -> None:
        """Handle a JSON-RPC notification."""
        method = raw.get("method", "")
        params = raw.get("params", {})

        if self.on_notification is not None:
            await self.on_notification(method, params)


# ---------------------------------------------------------------------------
# JsonRpcBackend
# ---------------------------------------------------------------------------


class JsonRpcBackend(AgentBackend):
    """JSON-RPC 2.0 over stdio protocol backend for codex/hermes/kimi/kiro.

    Supports the codex app-server JSON-RPC protocol and ACP-simplified
    variants used by hermes, kimi, and kiro.
    """

    provider: str  # "codex" | "hermes" | "kimi" | "kiro"

    def __init__(self, provider: str) -> None:
        self.provider = provider

    # -- AgentBackend interface ----------------------------------------------

    async def execute(
        self,
        cmd_path: str,
        task_prompt: str,
        work_dir: str,
        env: dict | None = None,
        *,
        timeout: float = 0,
        model: str = "",
        session_id: str = "",
    ) -> TaskResult:
        """Execute agent via JSON-RPC protocol.

        Spawns the agent process, performs handshake, sends the task,
        streams events, and returns the final result.
        """
        start_time = time.monotonic()
        events: list[AgentEvent] = []
        output_parts: list[str] = []

        # Build command args
        extra_args = _PROVIDER_COMMANDS.get(self.provider, [])
        cmd_args = [cmd_path] + extra_args

        # Spawn process
        try:
            proc = await asyncio.create_subprocess_exec(
                *cmd_args,
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=work_dir,
                env=env,
            )
        except (FileNotFoundError, OSError) as exc:
            return TaskResult(
                status="failed",
                output="",
                error=str(exc),
                duration_ms=int((time.monotonic() - start_time) * 1000),
                events=events,
            )

        assert proc.stdin is not None
        assert proc.stdout is not None
        assert proc.stderr is not None

        transport = _JsonRpcTransport(
            stdin=proc.stdin,
            stdout_reader=proc.stdout,
        )

        # Track turn lifecycle
        turn_done = asyncio.Event()
        turn_error: list[str] = []
        turn_completed_data: dict = {}
        semantic_activity = asyncio.Event()
        # Mutable reference so on_notification can see thread_id set by _run_lifecycle
        thread_id_ref: list[str] = [""]

        async def on_notification(method: str, params: dict) -> None:
            semantic_activity.set()

            # Filter by thread_id once we have one
            current_thread_id = thread_id_ref[0]
            if current_thread_id and "threadId" in params:
                if params["threadId"] != current_thread_id:
                    return

            if method == "turn/started":
                events.append(AgentEvent(event_type="status", status="running"))

            elif method == "turn/completed":
                turn_data = params.get("turn", {})
                status = turn_data.get("status", "")
                if status == "failed":
                    err_msg = ""
                    err_obj = turn_data.get("error")
                    if isinstance(err_obj, dict):
                        err_msg = err_obj.get("message", "turn failed")
                    else:
                        err_msg = "turn failed"
                    turn_error.append(err_msg)

                # Extract usage
                usage = (
                    turn_data.get("usage")
                    or turn_data.get("token_usage")
                    or turn_data.get("tokens")
                )
                turn_completed_data.update(turn_data)
                if usage and isinstance(usage, dict):
                    turn_completed_data["usage"] = usage

                turn_done.set()

            elif method == "item/completed":
                item = params.get("item", {})
                item_type = item.get("type", "")

                if item_type == "agentMessage":
                    text = item.get("text", "")
                    if text:
                        output_parts.append(text)
                        events.append(AgentEvent(event_type="text", content=text))

                elif item_type == "commandExecution":
                    output_text = item.get("aggregatedOutput", "")
                    events.append(
                        AgentEvent(
                            event_type="tool_result",
                            tool_name="exec_command",
                            call_id=item.get("id", ""),
                            tool_output=output_text,
                        )
                    )

                elif item_type == "fileChange":
                    events.append(
                        AgentEvent(
                            event_type="tool_result",
                            tool_name="patch_apply",
                            call_id=item.get("id", ""),
                        )
                    )

            elif method == "item/started":
                item = params.get("item", {})
                item_type = item.get("type", "")

                if item_type == "commandExecution":
                    events.append(
                        AgentEvent(
                            event_type="tool_use",
                            tool_name="exec_command",
                            call_id=item.get("id", ""),
                            tool_input={"command": item.get("command", "")},
                        )
                    )

                elif item_type == "fileChange":
                    events.append(
                        AgentEvent(
                            event_type="tool_use",
                            tool_name="patch_apply",
                            call_id=item.get("id", ""),
                        )
                    )

        transport.on_notification = on_notification

        # Start reading in background
        read_task = transport.start_read_loop()

        try:
            return await self._run_lifecycle(
                transport=transport,
                read_task=read_task,
                proc=proc,
                task_prompt=task_prompt,
                work_dir=work_dir,
                model=model,
                session_id=session_id,
                timeout=timeout,
                turn_done=turn_done,
                turn_error=turn_error,
                events=events,
                output_parts=output_parts,
                start_time=start_time,
                thread_id_ref=thread_id_ref,
            )
        finally:
            # Ensure read loop is stopped and process is cleaned up
            transport.stop_read_loop()
            if not read_task.done():
                read_task.cancel()
                try:
                    await read_task
                except asyncio.CancelledError:
                    pass

            # Close stdin to signal process to exit
            if proc.stdin:
                proc.stdin.close()
                try:
                    await proc.stdin.wait_closed()
                except Exception:
                    pass

            # Read stderr
            try:
                stderr_bytes = await asyncio.wait_for(proc.stderr.read(), timeout=2.0)
                stderr_bytes.decode(errors="replace")[-_STDERR_TAIL_BYTES:]
            except Exception:
                pass

            # Wait for process to exit
            try:
                await asyncio.wait_for(proc.wait(), timeout=5.0)
            except asyncio.TimeoutError:
                proc.kill()

    async def _run_lifecycle(
        self,
        transport: _JsonRpcTransport,
        read_task: asyncio.Task,
        proc: asyncio.subprocess.Process,
        task_prompt: str,
        work_dir: str,
        model: str,
        session_id: str,
        timeout: float,
        turn_done: asyncio.Event,
        turn_error: list[str],
        events: list[AgentEvent],
        output_parts: list[str],
        start_time: float,
        thread_id_ref: list[str],
    ) -> TaskResult:
        """Drive the JSON-RPC lifecycle: handshake -> thread -> turn -> wait."""

        # 1. Initialize handshake
        try:
            await transport.request(
                "initialize",
                {
                    "clientInfo": {
                        "name": "sillyhub-daemon",
                        "version": "0.1.0",
                    },
                    "capabilities": {},
                },
                timeout=_HANDSHAKE_TIMEOUT,
            )
        except Exception as exc:
            return TaskResult(
                status="failed",
                output="",
                error=f"initialize handshake failed: {exc}",
                duration_ms=int((time.monotonic() - start_time) * 1000),
                events=events,
            )

        # 2. Send initialized notification
        await transport.notify("notifications/initialized")

        # 3. Start or resume thread
        try:
            if session_id:
                thread_id = await self._resume_thread(
                    transport, session_id, work_dir, model
                )
            else:
                thread_id = await self._start_thread(transport, work_dir, model)
        except Exception as exc:
            return TaskResult(
                status="failed",
                output="",
                error=str(exc),
                duration_ms=int((time.monotonic() - start_time) * 1000),
                events=events,
            )

        thread_id_ref[0] = thread_id

        # 4. Send turn/start
        try:
            await transport.request(
                "turn/start",
                {
                    "threadId": thread_id,
                    "input": [{"type": "text", "text": task_prompt}],
                },
            )
        except Exception as exc:
            return TaskResult(
                status="failed",
                output="",
                error=f"turn/start failed: {exc}",
                duration_ms=int((time.monotonic() - start_time) * 1000),
                events=events,
            )

        # 5. Wait for turn completion or timeout
        semantic_timeout = _DEFAULT_SEMANTIC_INACTIVITY_TIMEOUT
        wall_timeout = timeout if timeout > 0 else 0

        try:
            if wall_timeout > 0:
                await asyncio.wait_for(turn_done.wait(), timeout=wall_timeout)
            else:
                # Use semantic inactivity timeout
                while not turn_done.is_set():
                    try:
                        await asyncio.wait_for(
                            turn_done.wait(),
                            timeout=semantic_timeout,
                        )
                    except asyncio.TimeoutError:
                        if wall_timeout > 0:
                            return TaskResult(
                                status="timeout",
                                output="".join(output_parts),
                                error=f"semantic inactivity timeout after {semantic_timeout}s",
                                duration_ms=int((time.monotonic() - start_time) * 1000),
                                session_id=thread_id,
                                events=events,
                            )
                        # If no wall timeout set, use semantic timeout as wall timeout
                        return TaskResult(
                            status="timeout",
                            output="".join(output_parts),
                            error=f"semantic inactivity timeout after {semantic_timeout}s",
                            duration_ms=int((time.monotonic() - start_time) * 1000),
                            session_id=thread_id,
                            events=events,
                        )
        except asyncio.TimeoutError:
            return TaskResult(
                status="timeout",
                output="".join(output_parts),
                error=f"timed out after {wall_timeout}s",
                duration_ms=int((time.monotonic() - start_time) * 1000),
                session_id=thread_id,
                events=events,
            )

        # 6. Build final result
        final_status = "completed"
        final_error = ""
        if turn_error:
            final_status = "failed"
            final_error = turn_error[0]

        duration_ms = int((time.monotonic() - start_time) * 1000)

        return TaskResult(
            status=final_status,
            output="".join(output_parts),
            error=final_error,
            duration_ms=duration_ms,
            session_id=thread_id,
            events=events,
        )

    async def _start_thread(
        self, transport: _JsonRpcTransport, work_dir: str, model: str
    ) -> str:
        """Start a new thread and return its ID. Raises on failure."""
        params: dict[str, Any] = {
            "cwd": work_dir,
        }
        if model:
            params["model"] = model

        result = await transport.request("thread/start", params)

        thread_id = self._extract_thread_id(result)
        if not thread_id:
            raise RuntimeError("thread/start returned no thread ID")

        return thread_id

    async def _resume_thread(
        self, transport: _JsonRpcTransport, session_id: str, work_dir: str, model: str
    ) -> str:
        """Resume an existing thread. Falls back to start on failure."""
        params: dict[str, Any] = {
            "threadId": session_id,
            "cwd": work_dir,
        }
        if model:
            params["model"] = model

        try:
            result = await transport.request("thread/resume", params)
            thread_id = self._extract_thread_id(result)
            if thread_id:
                return thread_id
        except Exception as exc:
            logger.warning(
                "thread/resume failed, falling back to thread/start: %s", exc
            )

        # Fallback to start
        return await self._start_thread(transport, work_dir, model)

    @staticmethod
    def _extract_thread_id(result: dict) -> str:
        """Extract thread ID from a thread/start or thread/resume result."""
        thread = result.get("thread", {})
        if isinstance(thread, dict):
            return thread.get("id", "")
        return ""

    async def parse_output(self, line: str) -> AgentEvent | None:
        """Parse a JSON-RPC response/notification line into an AgentEvent.

        Returns None for non-event lines (responses, turn lifecycle events,
        malformed lines).
        """
        try:
            raw = json.loads(line)
        except (json.JSONDecodeError, ValueError):
            return None

        if not isinstance(raw, dict):
            return None

        # Only process notifications (have method, no id, no result/error)
        method = raw.get("method")
        if not method:
            return None

        # Responses (have result or error) are not events
        if "result" in raw or "error" in raw:
            return None

        params = raw.get("params", {})
        if not isinstance(params, dict):
            params = {}

        if method == "item/completed":
            item = params.get("item", {})
            item_type = item.get("type", "")

            if item_type == "agentMessage":
                text = item.get("text", "")
                return AgentEvent(event_type="text", content=text)

            if item_type == "commandExecution":
                return AgentEvent(
                    event_type="tool_result",
                    tool_name="exec_command",
                    call_id=item.get("id", ""),
                    tool_output=item.get("aggregatedOutput", ""),
                )

            if item_type == "fileChange":
                return AgentEvent(
                    event_type="tool_result",
                    tool_name="patch_apply",
                    call_id=item.get("id", ""),
                )

        elif method == "item/started":
            item = params.get("item", {})
            item_type = item.get("type", "")

            if item_type == "commandExecution":
                return AgentEvent(
                    event_type="tool_use",
                    tool_name="exec_command",
                    call_id=item.get("id", ""),
                    tool_input={"command": item.get("command", "")},
                )

            if item_type == "fileChange":
                return AgentEvent(
                    event_type="tool_use",
                    tool_name="patch_apply",
                    call_id=item.get("id", ""),
                )

        elif method == "turn/started":
            return AgentEvent(event_type="status", status="running")

        return None
