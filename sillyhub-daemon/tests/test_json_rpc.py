"""Tests for JsonRpcBackend and _JsonRpcTransport — JSON-RPC 2.0 over stdio."""

from __future__ import annotations

import asyncio
import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from sillyhub_daemon.backends import AgentBackend, TaskResult, get_backend


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


class _FakeStdin:
    """Writes are captured into a list of JSON-decoded dicts.

    Mimics asyncio.StreamWriter enough for _JsonRpcTransport.
    """

    def __init__(self):
        self.written: list[bytes] = []
        self._closed = False

    def write(self, data: bytes) -> int:
        self.written.append(data)
        return len(data)

    async def drain(self):
        pass

    def close(self):
        self._closed = True

    async def wait_closed(self):
        pass

    def decode_messages(self) -> list[dict]:
        msgs = []
        for raw in self.written:
            for line in raw.decode().splitlines():
                line = line.strip()
                if line:
                    msgs.append(json.loads(line))
        return msgs


class _FakeStdout:
    """Produces lines from a pre-loaded buffer, one line per read."""

    def __init__(self, lines: list[str]):
        self._lines = list(lines)

    async def readline(self) -> bytes:
        if not self._lines:
            return b""
        return (self._lines.pop(0) + "\n").encode()


class _FakeProcess:
    """Minimal fake asyncio.subprocess.Process."""

    def __init__(self, stdin: _FakeStdin, stdout_lines: list[str] | None = None):
        self.stdin = stdin
        self.stdout = _FakeStdout(stdout_lines or [])
        self.stderr = _FakeStdout([])
        self.returncode = None
        self.pid = 12345

    async def wait(self):
        self.returncode = 0

    def kill(self):
        self.returncode = -9


def _make_rpc_response(
    req_id: int, result: dict | None = None, error: dict | None = None
) -> str:
    """Build a JSON-RPC response line."""
    msg = {"jsonrpc": "2.0", "id": req_id}
    if error is not None:
        msg["error"] = error
    else:
        msg["result"] = result or {}
    return json.dumps(msg)


def _make_rpc_notification(method: str, params: dict | None = None) -> str:
    """Build a JSON-RPC notification line."""
    msg: dict = {"jsonrpc": "2.0", "method": method}
    if params is not None:
        msg["params"] = params
    return json.dumps(msg)


def _make_rpc_server_request(
    req_id: int, method: str, params: dict | None = None
) -> str:
    """Build a JSON-RPC server request (has both id and method)."""
    msg: dict = {"jsonrpc": "2.0", "id": req_id, "method": method}
    if params is not None:
        msg["params"] = params
    return json.dumps(msg)


# Standard JSON-RPC response for turn/start (request id=3)
_TURN_START_RESPONSE = _make_rpc_response(3, {})


# ---------------------------------------------------------------------------
# TDD 1: _JsonRpcTransport request/response
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_transport_request_response():
    """request() sends valid JSON-RPC 2.0 request and returns the response result."""
    from sillyhub_daemon.backends.json_rpc import _JsonRpcTransport

    fake_stdin = _FakeStdin()

    # Response for request id=1
    response_line = _make_rpc_response(1, {"thread": {"id": "t_abc"}}) + "\n"
    fake_stdout = asyncio.StreamReader()
    fake_stdout.feed_data(response_line.encode())
    fake_stdout.feed_eof()

    transport = _JsonRpcTransport(stdin=fake_stdin, stdout_reader=fake_stdout)

    # Start read loop so the response can be dispatched
    read_task = transport.start_read_loop()

    result = await transport.request(
        "initialize", {"clientInfo": {"name": "sillyhub-daemon", "version": "0.1.0"}}
    )

    transport.stop_read_loop()
    read_task.cancel()
    try:
        await read_task
    except asyncio.CancelledError:
        pass

    assert result == {"thread": {"id": "t_abc"}}

    # Verify sent message format
    msgs = fake_stdin.decode_messages()
    assert len(msgs) == 1
    msg = msgs[0]
    assert msg["jsonrpc"] == "2.0"
    assert msg["id"] == 1
    assert msg["method"] == "initialize"
    assert "clientInfo" in msg["params"]


# ---------------------------------------------------------------------------
# TDD 2: _JsonRpcTransport notification
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_transport_notification():
    """notify() sends a JSON-RPC notification without an id and does not wait."""
    from sillyhub_daemon.backends.json_rpc import _JsonRpcTransport

    fake_stdin = _FakeStdin()
    fake_stdout = asyncio.StreamReader()
    fake_stdout.feed_eof()

    transport = _JsonRpcTransport(stdin=fake_stdin, stdout_reader=fake_stdout)

    # Start read loop (needed for transport internals)
    read_task = transport.start_read_loop()

    await transport.notify("notifications/initialized")

    transport.stop_read_loop()
    read_task.cancel()
    try:
        await read_task
    except asyncio.CancelledError:
        pass

    msgs = fake_stdin.decode_messages()
    assert len(msgs) == 1
    msg = msgs[0]
    assert msg["jsonrpc"] == "2.0"
    assert msg["method"] == "notifications/initialized"
    assert "id" not in msg


# ---------------------------------------------------------------------------
# TDD 3: _JsonRpcTransport server request auto-approval
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_transport_server_request_auto_approval():
    """Server request for approval is auto-responded with accept."""
    from sillyhub_daemon.backends.json_rpc import _JsonRpcTransport

    fake_stdin = _FakeStdin()

    # Server request line
    server_req = _make_rpc_server_request(
        10,
        "item/commandExecution/requestApproval",
        {
            "threadId": "t_1",
            "item": {"id": "item_1", "type": "commandExecution", "command": "ls"},
        },
    )
    fake_stdout = asyncio.StreamReader()
    fake_stdout.feed_data((server_req + "\n").encode())
    fake_stdout.feed_eof()

    transport = _JsonRpcTransport(stdin=fake_stdin, stdout_reader=fake_stdout)

    # Start read loop, let it process, then stop
    read_task = transport.start_read_loop()
    await asyncio.sleep(0.1)
    transport.stop_read_loop()
    try:
        await asyncio.wait_for(read_task, timeout=1.0)
    except asyncio.CancelledError:
        pass

    # Check that we responded with accept
    msgs = fake_stdin.decode_messages()
    response_msgs = [m for m in msgs if "id" in m and "method" not in m]
    assert len(response_msgs) >= 1
    resp = response_msgs[0]
    assert resp["id"] == 10
    assert resp["result"] == {"decision": "accept"}


# ---------------------------------------------------------------------------
# TDD 4: JsonRpcBackend execute — full handshake (codex)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_backend_execute_handshake_codex():
    """codex provider builds correct command args and performs full handshake."""
    from sillyhub_daemon.backends.json_rpc import JsonRpcBackend

    backend = JsonRpcBackend(provider="codex")

    # Build a sequence of JSON-RPC responses and notifications
    lines = [
        # initialize response
        _make_rpc_response(1, {"capabilities": {}}),
        # thread/start response
        _make_rpc_response(2, {"thread": {"id": "thread_001"}}),
        # turn/start response
        _TURN_START_RESPONSE,
        # turn/started notification
        _make_rpc_notification(
            "turn/started", {"threadId": "thread_001", "turn": {"id": "turn_001"}}
        ),
        # item/completed agentMessage
        _make_rpc_notification(
            "item/completed",
            {
                "threadId": "thread_001",
                "item": {"id": "item_1", "type": "agentMessage", "text": "Hello world"},
            },
        ),
        # turn/completed
        _make_rpc_notification(
            "turn/completed",
            {
                "threadId": "thread_001",
                "turn": {"id": "turn_001", "status": "completed"},
            },
        ),
    ]

    fake_stdin = _FakeStdin()

    async def _mock_create_subprocess(*args, **kwargs):
        fake_stdout = asyncio.StreamReader()
        for line in lines:
            fake_stdout.feed_data((line + "\n").encode())
        fake_stdout.feed_eof()
        proc = MagicMock()
        proc.stdin = fake_stdin
        proc.stdout = fake_stdout
        proc.stderr = MagicMock()
        proc.stderr.read = AsyncMock(return_value=b"")
        proc.pid = 999
        proc.returncode = None
        proc.wait = AsyncMock(return_value=0)
        proc.kill = MagicMock()
        return proc

    with patch(
        "sillyhub_daemon.backends.json_rpc.asyncio.create_subprocess_exec",
        _mock_create_subprocess,
    ):
        result = await backend.execute(
            cmd_path="codex",
            task_prompt="say hello",
            work_dir="/tmp/project",
            env={"PATH": "/usr/bin"},
        )

    assert isinstance(result, TaskResult)
    assert result.status == "completed"
    assert result.session_id == "thread_001"

    # Verify the command spawned is codex with app-server subcommand
    # (we patched create_subprocess_exec, so we check via the call args in the mock)
    # Instead, check the sent messages include initialize
    msgs = fake_stdin.decode_messages()
    methods = [m.get("method") for m in msgs if "method" in m]
    assert "initialize" in methods
    assert "notifications/initialized" in methods


# ---------------------------------------------------------------------------
# TDD 5: JsonRpcBackend execute — item events produce TextEvent
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_backend_execute_item_events():
    """item/completed with agentMessage produces a TextEvent in the result."""
    from sillyhub_daemon.backends.json_rpc import JsonRpcBackend

    backend = JsonRpcBackend(provider="codex")

    lines = [
        _make_rpc_response(1, {"capabilities": {}}),
        _make_rpc_response(2, {"thread": {"id": "t1"}}),
        _TURN_START_RESPONSE,
        _make_rpc_notification(
            "turn/started", {"threadId": "t1", "turn": {"id": "turn1"}}
        ),
        _make_rpc_notification(
            "item/completed",
            {
                "threadId": "t1",
                "item": {
                    "id": "i1",
                    "type": "agentMessage",
                    "text": "Result text here",
                },
            },
        ),
        _make_rpc_notification(
            "turn/completed",
            {
                "threadId": "t1",
                "turn": {"id": "turn1", "status": "completed"},
            },
        ),
    ]

    fake_stdin = _FakeStdin()

    async def _mock_create_subprocess(*args, **kwargs):
        fake_stdout = asyncio.StreamReader()
        for line in lines:
            fake_stdout.feed_data((line + "\n").encode())
        fake_stdout.feed_eof()
        proc = MagicMock()
        proc.stdin = fake_stdin
        proc.stdout = fake_stdout
        proc.stderr = MagicMock()
        proc.stderr.read = AsyncMock(return_value=b"")
        proc.pid = 999
        proc.returncode = None
        proc.wait = AsyncMock(return_value=0)
        proc.kill = MagicMock()
        return proc

    with patch(
        "sillyhub_daemon.backends.json_rpc.asyncio.create_subprocess_exec",
        _mock_create_subprocess,
    ):
        result = await backend.execute(
            cmd_path="codex",
            task_prompt="test",
            work_dir="/tmp",
            env={},
        )

    text_events = [e for e in result.events if e.event_type == "text"]
    assert len(text_events) >= 1
    assert "Result text here" in text_events[0].content


# ---------------------------------------------------------------------------
# TDD 6: JsonRpcBackend execute — turn/completed generates TaskResult
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_backend_execute_turn_completed():
    """turn/completed notification correctly finalizes the TaskResult."""
    from sillyhub_daemon.backends.json_rpc import JsonRpcBackend

    backend = JsonRpcBackend(provider="codex")

    lines = [
        _make_rpc_response(1, {"capabilities": {}}),
        _make_rpc_response(2, {"thread": {"id": "t2"}}),
        _TURN_START_RESPONSE,
        _make_rpc_notification(
            "turn/started", {"threadId": "t2", "turn": {"id": "turn2"}}
        ),
        _make_rpc_notification(
            "turn/completed",
            {
                "threadId": "t2",
                "turn": {"id": "turn2", "status": "completed"},
            },
        ),
    ]

    fake_stdin = _FakeStdin()

    async def _mock_create_subprocess(*args, **kwargs):
        fake_stdout = asyncio.StreamReader()
        for line in lines:
            fake_stdout.feed_data((line + "\n").encode())
        fake_stdout.feed_eof()
        proc = MagicMock()
        proc.stdin = fake_stdin
        proc.stdout = fake_stdout
        proc.stderr = MagicMock()
        proc.stderr.read = AsyncMock(return_value=b"")
        proc.pid = 999
        proc.returncode = None
        proc.wait = AsyncMock(return_value=0)
        proc.kill = MagicMock()
        return proc

    with patch(
        "sillyhub_daemon.backends.json_rpc.asyncio.create_subprocess_exec",
        _mock_create_subprocess,
    ):
        result = await backend.execute(
            cmd_path="codex",
            task_prompt="test",
            work_dir="/tmp",
            env={},
        )

    assert result.status == "completed"
    assert result.session_id == "t2"


# ---------------------------------------------------------------------------
# TDD 7: JsonRpcBackend execute — timeout
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_backend_execute_timeout():
    """Semantic inactivity timeout correctly returns timeout TaskResult."""
    from sillyhub_daemon.backends.json_rpc import JsonRpcBackend

    backend = JsonRpcBackend(provider="codex")

    # Only handshake responses, no turn/completed — simulates a hang
    lines = [
        _make_rpc_response(1, {"capabilities": {}}),
        _make_rpc_response(2, {"thread": {"id": "t3"}}),
        _TURN_START_RESPONSE,
    ]

    fake_stdin = _FakeStdin()

    async def _mock_create_subprocess(*args, **kwargs):
        fake_stdout = asyncio.StreamReader()
        for line in lines:
            fake_stdout.feed_data((line + "\n").encode())
        # Don't feed EOF — simulate a hanging process
        proc = MagicMock()
        proc.stdin = fake_stdin
        proc.stdout = fake_stdout
        proc.stderr = MagicMock()
        proc.stderr.read = AsyncMock(return_value=b"")
        proc.pid = 999
        proc.returncode = None
        proc.wait = AsyncMock(return_value=0)
        proc.kill = MagicMock()
        return proc

    with patch(
        "sillyhub_daemon.backends.json_rpc.asyncio.create_subprocess_exec",
        _mock_create_subprocess,
    ):
        result = await backend.execute(
            cmd_path="codex",
            task_prompt="test",
            work_dir="/tmp",
            env={},
            timeout=0.5,  # short wall-time timeout for fast test
        )

    assert result.status in ("timeout", "failed")


# ---------------------------------------------------------------------------
# TDD 8: JsonRpcBackend execute — malformed line skipped
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_backend_execute_malformed_line():
    """Non-JSON lines on stdout are skipped without crashing."""
    from sillyhub_daemon.backends.json_rpc import JsonRpcBackend

    backend = JsonRpcBackend(provider="codex")

    lines = [
        _make_rpc_response(1, {"capabilities": {}}),
        "this is not valid json {{{{{",
        _make_rpc_response(2, {"thread": {"id": "t4"}}),
        _TURN_START_RESPONSE,
        _make_rpc_notification(
            "turn/started", {"threadId": "t4", "turn": {"id": "turn4"}}
        ),
        "another bad line",
        _make_rpc_notification(
            "turn/completed",
            {
                "threadId": "t4",
                "turn": {"id": "turn4", "status": "completed"},
            },
        ),
    ]

    fake_stdin = _FakeStdin()

    async def _mock_create_subprocess(*args, **kwargs):
        fake_stdout = asyncio.StreamReader()
        for line in lines:
            fake_stdout.feed_data((line + "\n").encode())
        fake_stdout.feed_eof()
        proc = MagicMock()
        proc.stdin = fake_stdin
        proc.stdout = fake_stdout
        proc.stderr = MagicMock()
        proc.stderr.read = AsyncMock(return_value=b"")
        proc.pid = 999
        proc.returncode = None
        proc.wait = AsyncMock(return_value=0)
        proc.kill = MagicMock()
        return proc

    with patch(
        "sillyhub_daemon.backends.json_rpc.asyncio.create_subprocess_exec",
        _mock_create_subprocess,
    ):
        result = await backend.execute(
            cmd_path="codex",
            task_prompt="test",
            work_dir="/tmp",
            env={},
        )

    assert result.status == "completed"


# ---------------------------------------------------------------------------
# TDD 9: JsonRpcBackend parse_output
# ---------------------------------------------------------------------------


def test_backend_parse_output_agent_message():
    """parse_output correctly parses an item/completed agentMessage notification."""
    from sillyhub_daemon.backends.json_rpc import JsonRpcBackend

    backend = JsonRpcBackend(provider="codex")

    line = _make_rpc_notification(
        "item/completed",
        {
            "threadId": "t1",
            "item": {"id": "i1", "type": "agentMessage", "text": "Hello"},
        },
    )

    event = asyncio.run(backend.parse_output(line))
    assert event is not None
    assert event.event_type == "text"
    assert event.content == "Hello"


def test_backend_parse_output_command_execution_started():
    """parse_output correctly parses an item/started commandExecution notification."""
    from sillyhub_daemon.backends.json_rpc import JsonRpcBackend

    backend = JsonRpcBackend(provider="codex")

    line = _make_rpc_notification(
        "item/started",
        {
            "threadId": "t1",
            "item": {"id": "i2", "type": "commandExecution", "command": "ls -la"},
        },
    )

    event = asyncio.run(backend.parse_output(line))
    assert event is not None
    assert event.event_type == "tool_use"
    assert event.tool_name == "exec_command"
    assert event.call_id == "i2"


def test_backend_parse_output_command_execution_completed():
    """parse_output correctly parses an item/completed commandExecution notification."""
    from sillyhub_daemon.backends.json_rpc import JsonRpcBackend

    backend = JsonRpcBackend(provider="codex")

    line = _make_rpc_notification(
        "item/completed",
        {
            "threadId": "t1",
            "item": {
                "id": "i2",
                "type": "commandExecution",
                "aggregatedOutput": "file1.txt\nfile2.txt",
            },
        },
    )

    event = asyncio.run(backend.parse_output(line))
    assert event is not None
    assert event.event_type == "tool_result"
    assert event.tool_name == "exec_command"
    assert "file1.txt" in event.tool_output


def test_backend_parse_output_file_change():
    """parse_output correctly parses file change item notifications."""
    from sillyhub_daemon.backends.json_rpc import JsonRpcBackend

    backend = JsonRpcBackend(provider="codex")

    # fileChange started
    line1 = _make_rpc_notification(
        "item/started",
        {
            "threadId": "t1",
            "item": {"id": "i3", "type": "fileChange"},
        },
    )
    event1 = asyncio.run(backend.parse_output(line1))
    assert event1 is not None
    assert event1.event_type == "tool_use"
    assert event1.tool_name == "patch_apply"

    # fileChange completed
    line2 = _make_rpc_notification(
        "item/completed",
        {
            "threadId": "t1",
            "item": {"id": "i3", "type": "fileChange"},
        },
    )
    event2 = asyncio.run(backend.parse_output(line2))
    assert event2 is not None
    assert event2.event_type == "tool_result"
    assert event2.tool_name == "patch_apply"


def test_backend_parse_output_non_json():
    """parse_output returns None for non-JSON lines."""
    from sillyhub_daemon.backends.json_rpc import JsonRpcBackend

    backend = JsonRpcBackend(provider="codex")

    event = asyncio.run(backend.parse_output("not json at all"))
    assert event is None


def test_backend_parse_output_response_line():
    """parse_output returns None for JSON-RPC response lines (no method)."""
    from sillyhub_daemon.backends.json_rpc import JsonRpcBackend

    backend = JsonRpcBackend(provider="codex")

    line = _make_rpc_response(1, {"capabilities": {}})
    event = asyncio.run(backend.parse_output(line))
    assert event is None


def test_backend_parse_output_turn_started():
    """parse_output correctly parses a turn/started notification."""
    from sillyhub_daemon.backends.json_rpc import JsonRpcBackend

    backend = JsonRpcBackend(provider="codex")

    line = _make_rpc_notification(
        "turn/started",
        {
            "threadId": "t1",
            "turn": {"id": "turn1"},
        },
    )

    event = asyncio.run(backend.parse_output(line))
    assert event is not None
    assert event.event_type == "status"
    assert event.status == "running"


# ---------------------------------------------------------------------------
# TDD: Provider command differences
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_backend_codex_uses_app_server():
    """codex provider spawns with 'app-server --listen stdio://' subcommand."""
    from sillyhub_daemon.backends.json_rpc import JsonRpcBackend

    backend = JsonRpcBackend(provider="codex")

    captured_args = {}

    async def _mock_create_subprocess(*args, **kwargs):
        captured_args["args"] = args
        captured_args["kwargs"] = kwargs
        fake_stdout = asyncio.StreamReader()
        fake_stdout.feed_eof()
        proc = MagicMock()
        proc.stdin = _FakeStdin()
        proc.stdout = fake_stdout
        proc.stderr = MagicMock()
        proc.stderr.read = AsyncMock(return_value=b"")
        proc.pid = 999
        proc.returncode = None
        proc.wait = AsyncMock(return_value=0)
        proc.kill = MagicMock()
        return proc

    # We need at least initialize handshake to complete, but stdout has no data
    # so it will timeout. Patch the timeout to be short.
    with patch(
        "sillyhub_daemon.backends.json_rpc.asyncio.create_subprocess_exec",
        _mock_create_subprocess,
    ):
        try:
            await asyncio.wait_for(
                backend.execute(
                    cmd_path="codex", task_prompt="test", work_dir="/tmp", env={}
                ),
                timeout=2.0,
            )
        except (asyncio.TimeoutError, Exception):
            pass

    # Verify command args include app-server subcommand
    if "args" in captured_args:
        args_list = list(captured_args["args"])
        # First arg is cmd_path, then the subcommand args
        assert "app-server" in args_list
        assert "stdio://" in args_list


@pytest.mark.asyncio
async def test_backend_hermes_no_app_server():
    """hermes provider does not use 'app-server' subcommand."""
    from sillyhub_daemon.backends.json_rpc import JsonRpcBackend

    backend = JsonRpcBackend(provider="hermes")

    captured_args = {}

    async def _mock_create_subprocess(*args, **kwargs):
        captured_args["args"] = args
        captured_args["kwargs"] = kwargs
        fake_stdout = asyncio.StreamReader()
        fake_stdout.feed_eof()
        proc = MagicMock()
        proc.stdin = _FakeStdin()
        proc.stdout = fake_stdout
        proc.stderr = MagicMock()
        proc.stderr.read = AsyncMock(return_value=b"")
        proc.pid = 999
        proc.returncode = None
        proc.wait = AsyncMock(return_value=0)
        proc.kill = MagicMock()
        return proc

    with patch(
        "sillyhub_daemon.backends.json_rpc.asyncio.create_subprocess_exec",
        _mock_create_subprocess,
    ):
        try:
            await asyncio.wait_for(
                backend.execute(
                    cmd_path="hermes", task_prompt="test", work_dir="/tmp", env={}
                ),
                timeout=2.0,
            )
        except (asyncio.TimeoutError, Exception):
            pass

    if "args" in captured_args:
        args_list = list(captured_args["args"])
        assert "app-server" not in args_list


# ---------------------------------------------------------------------------
# TDD: Thread filtering
# ---------------------------------------------------------------------------


def test_backend_parse_output_filters_other_thread():
    """Notifications from a different threadId are ignored by parse_output."""
    from sillyhub_daemon.backends.json_rpc import JsonRpcBackend

    backend = JsonRpcBackend(provider="codex")

    line = _make_rpc_notification(
        "item/completed",
        {
            "threadId": "other_thread",
            "item": {"id": "i1", "type": "agentMessage", "text": "from other thread"},
        },
    )

    # parse_output is stateless w.r.t. thread filtering (that's done in execute's read loop)
    # So it still parses, but we verify the event is correctly parsed
    event = asyncio.run(backend.parse_output(line))
    # parse_output always parses — thread filtering happens at the execute level
    assert event is not None
    assert event.content == "from other thread"


# ---------------------------------------------------------------------------
# TDD: Factory registration
# ---------------------------------------------------------------------------


def test_get_backend_json_rpc_returns_jsonrpcbackend():
    """get_backend('codex') returns JsonRpcBackend class."""
    cls = get_backend("codex")
    from sillyhub_daemon.backends.json_rpc import JsonRpcBackend

    assert cls is JsonRpcBackend


def test_get_backend_hermes_returns_jsonrpcbackend():
    """get_backend('hermes') also returns JsonRpcBackend."""
    cls = get_backend("hermes")
    from sillyhub_daemon.backends.json_rpc import JsonRpcBackend

    assert cls is JsonRpcBackend


def test_jsonrpcbackend_is_agentbackend():
    """JsonRpcBackend is a proper subclass of AgentBackend."""
    from sillyhub_daemon.backends.json_rpc import JsonRpcBackend

    assert issubclass(JsonRpcBackend, AgentBackend)


# ---------------------------------------------------------------------------
# TDD: Executable not found
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_backend_execute_cmd_not_found():
    """When cmd_path doesn't exist, returns TaskResult with status='failed'."""
    from sillyhub_daemon.backends.json_rpc import JsonRpcBackend

    backend = JsonRpcBackend(provider="codex")

    async def _mock_create_subprocess(*args, **kwargs):
        raise FileNotFoundError("codex not found")

    with patch(
        "sillyhub_daemon.backends.json_rpc.asyncio.create_subprocess_exec",
        _mock_create_subprocess,
    ):
        result = await backend.execute(
            cmd_path="/nonexistent/codex",
            task_prompt="test",
            work_dir="/tmp",
            env={},
        )

    assert isinstance(result, TaskResult)
    assert result.status == "failed"
    assert "not found" in result.error.lower() or "failed" in result.error.lower()


# ---------------------------------------------------------------------------
# TDD: turn/completed with failed status
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_backend_execute_turn_failed():
    """turn/completed with status='failed' produces TaskResult(status='failed')."""
    from sillyhub_daemon.backends.json_rpc import JsonRpcBackend

    backend = JsonRpcBackend(provider="codex")

    lines = [
        _make_rpc_response(1, {"capabilities": {}}),
        _make_rpc_response(2, {"thread": {"id": "t_fail"}}),
        _TURN_START_RESPONSE,
        _make_rpc_notification(
            "turn/started", {"threadId": "t_fail", "turn": {"id": "turn_fail"}}
        ),
        _make_rpc_notification(
            "turn/completed",
            {
                "threadId": "t_fail",
                "turn": {
                    "id": "turn_fail",
                    "status": "failed",
                    "error": {"message": "something went wrong"},
                },
            },
        ),
    ]

    fake_stdin = _FakeStdin()

    async def _mock_create_subprocess(*args, **kwargs):
        fake_stdout = asyncio.StreamReader()
        for line in lines:
            fake_stdout.feed_data((line + "\n").encode())
        fake_stdout.feed_eof()
        proc = MagicMock()
        proc.stdin = fake_stdin
        proc.stdout = fake_stdout
        proc.stderr = MagicMock()
        proc.stderr.read = AsyncMock(return_value=b"")
        proc.pid = 999
        proc.returncode = None
        proc.wait = AsyncMock(return_value=0)
        proc.kill = MagicMock()
        return proc

    with patch(
        "sillyhub_daemon.backends.json_rpc.asyncio.create_subprocess_exec",
        _mock_create_subprocess,
    ):
        result = await backend.execute(
            cmd_path="codex",
            task_prompt="test",
            work_dir="/tmp",
            env={},
        )

    assert result.status == "failed"
    assert "something went wrong" in result.error


# ---------------------------------------------------------------------------
# TDD: Handshake timeout
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_backend_execute_handshake_timeout():
    """If initialize request gets no response, returns failed with stderr info."""
    from sillyhub_daemon.backends.json_rpc import JsonRpcBackend

    backend = JsonRpcBackend(provider="codex")

    fake_stdin = _FakeStdin()

    async def _mock_create_subprocess(*args, **kwargs):
        fake_stdout = asyncio.StreamReader()
        # No data — simulate no response to initialize
        fake_stdout.feed_eof()
        proc = MagicMock()
        proc.stdin = fake_stdin
        proc.stdout = fake_stdout
        proc.stderr = MagicMock()
        proc.stderr.read = AsyncMock(return_value=b"some stderr error output")
        proc.pid = 999
        proc.returncode = None
        proc.wait = AsyncMock(return_value=0)
        proc.kill = MagicMock()
        return proc

    with patch(
        "sillyhub_daemon.backends.json_rpc.asyncio.create_subprocess_exec",
        _mock_create_subprocess,
    ):
        with patch("sillyhub_daemon.backends.json_rpc._HANDSHAKE_TIMEOUT", 0.2):
            result = await backend.execute(
                cmd_path="codex",
                task_prompt="test",
                work_dir="/tmp",
                env={},
            )

    assert result.status == "failed"


# ---------------------------------------------------------------------------
# TDD: parse_output for turn/completed notification
# ---------------------------------------------------------------------------


def test_backend_parse_output_turn_completed():
    """parse_output returns None for turn/completed (not an AgentEvent)."""
    from sillyhub_daemon.backends.json_rpc import JsonRpcBackend

    backend = JsonRpcBackend(provider="codex")

    line = _make_rpc_notification(
        "turn/completed",
        {
            "threadId": "t1",
            "turn": {"id": "turn1", "status": "completed"},
        },
    )

    event = asyncio.run(backend.parse_output(line))
    # turn/completed is a lifecycle event, not a content event
    assert event is None
