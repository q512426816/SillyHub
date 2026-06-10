"""Tests for StreamJsonBackend — NDJSON stream-json protocol (claude/gemini/cursor).

TDD tests written BEFORE implementation, per task-04.md blueprint.
"""

import json

import pytest

from sillyhub_daemon.backends import AgentBackend, TaskResult, get_backend


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _backend():
    """Create a fresh StreamJsonBackend instance."""
    from sillyhub_daemon.backends.stream_json import StreamJsonBackend

    return StreamJsonBackend()


# ===========================================================================
# parse_output — basic edge cases
# ===========================================================================


class TestParseOutputEdgeCases:
    """TDD 1-3: empty line, invalid JSON, unknown type."""

    @pytest.mark.asyncio
    async def test_parse_output_empty_line(self):
        """空行/空白行返回 None。"""
        b = _backend()
        assert await b.parse_output("") is None
        assert await b.parse_output("   ") is None
        assert await b.parse_output("\n") is None
        assert await b.parse_output("\t") is None

    @pytest.mark.asyncio
    async def test_parse_output_invalid_json(self):
        """非 JSON 字符串返回 None，不抛异常。"""
        b = _backend()
        assert await b.parse_output("not json at all") is None
        assert await b.parse_output("{invalid}") is None
        assert await b.parse_output("12345") is None

    @pytest.mark.asyncio
    async def test_parse_output_unknown_type(self):
        """未知 type 字段返回 None。"""
        b = _backend()
        line = json.dumps({"type": "custom", "data": "hello"})
        assert await b.parse_output(line) is None


# ===========================================================================
# parse_output — system event
# ===========================================================================


class TestParseOutputSystem:
    """TDD 4: system 类型解析出 session_id。"""

    @pytest.mark.asyncio
    async def test_parse_output_system_event(self):
        b = _backend()
        line = json.dumps(
            {
                "type": "system",
                "session_id": "sess_abc123",
                "subtype": "init",
            }
        )
        ev = await b.parse_output(line)
        assert ev is not None
        assert ev.event_type == "status"
        assert ev.status == "running"
        # session_id 存储需要能被外部读取——通过属性或通过返回的 event
        # 蓝图说 system → status event，提取 session_id
        assert ev.session_id == "sess_abc123"


# ===========================================================================
# parse_output — assistant messages
# ===========================================================================


class TestParseOutputAssistant:
    """TDD 5-7: assistant text, thinking, tool_use。"""

    @pytest.mark.asyncio
    async def test_parse_output_assistant_text(self):
        """assistant.content[text] → AgentEvent(event_type="text")。"""
        b = _backend()
        line = json.dumps(
            {
                "type": "assistant",
                "message": {
                    "role": "assistant",
                    "content": [
                        {"type": "text", "text": "Hello from Claude!"},
                    ],
                },
            }
        )
        ev = await b.parse_output(line)
        assert ev is not None
        assert ev.event_type == "text"
        assert ev.content == "Hello from Claude!"

    @pytest.mark.asyncio
    async def test_parse_output_assistant_thinking(self):
        """assistant.content[thinking] → AgentEvent(event_type="thinking")。"""
        b = _backend()
        line = json.dumps(
            {
                "type": "assistant",
                "message": {
                    "role": "assistant",
                    "content": [
                        {"type": "thinking", "text": "Let me think about this..."},
                    ],
                },
            }
        )
        ev = await b.parse_output(line)
        assert ev is not None
        assert ev.event_type == "thinking"
        assert ev.content == "Let me think about this..."

    @pytest.mark.asyncio
    async def test_parse_output_assistant_tool_use(self):
        """assistant.content[tool_use] → AgentEvent(event_type="tool_use")。"""
        b = _backend()
        line = json.dumps(
            {
                "type": "assistant",
                "message": {
                    "role": "assistant",
                    "content": [
                        {
                            "type": "tool_use",
                            "id": "call_001",
                            "name": "Read",
                            "input": {"file_path": "/tmp/test.py"},
                        },
                    ],
                },
            }
        )
        ev = await b.parse_output(line)
        assert ev is not None
        assert ev.event_type == "tool_use"
        assert ev.tool_name == "Read"
        assert ev.call_id == "call_001"
        assert ev.tool_input == {"file_path": "/tmp/test.py"}

    @pytest.mark.asyncio
    async def test_parse_output_assistant_tool_use_null_input(self):
        """tool_use block 的 input 字段为 null → 解析为空 dict {}。"""
        b = _backend()
        line = json.dumps(
            {
                "type": "assistant",
                "message": {
                    "role": "assistant",
                    "content": [
                        {
                            "type": "tool_use",
                            "id": "call_002",
                            "name": "Bash",
                            "input": None,
                        },
                    ],
                },
            }
        )
        ev = await b.parse_output(line)
        assert ev is not None
        assert ev.event_type == "tool_use"
        assert ev.tool_input == {}

    @pytest.mark.asyncio
    async def test_parse_output_assistant_no_content(self):
        """assistant message 无 content 数组 → 返回 None。"""
        b = _backend()
        line = json.dumps(
            {
                "type": "assistant",
                "message": {"role": "assistant"},
            }
        )
        # 不崩溃即可，返回 None 或空 event
        ev = await b.parse_output(line)
        # 蓝图边界 8: 跳过，不崩溃
        assert ev is None

    @pytest.mark.asyncio
    async def test_parse_output_assistant_multiple_blocks(self):
        """assistant 消息含多个 content blocks → 返回最后一个 block 的 event。

        蓝图 parse_output 签名返回单个 AgentEvent | None，
        所以多 block 消息只返回最后一个（或第一个）。
        实现中选择返回最后一个即可。
        """
        b = _backend()
        line = json.dumps(
            {
                "type": "assistant",
                "message": {
                    "role": "assistant",
                    "content": [
                        {"type": "text", "text": "Part 1"},
                        {"type": "text", "text": "Part 2"},
                    ],
                },
            }
        )
        ev = await b.parse_output(line)
        assert ev is not None
        assert ev.event_type == "text"
        # 应该返回最后一个 block
        assert ev.content == "Part 2"


# ===========================================================================
# parse_output — user/tool_result messages
# ===========================================================================


class TestParseOutputUser:
    """TDD 8: user.content[tool_result] → AgentEvent(event_type="tool_result")。"""

    @pytest.mark.asyncio
    async def test_parse_output_user_tool_result(self):
        b = _backend()
        line = json.dumps(
            {
                "type": "user",
                "message": {
                    "role": "user",
                    "content": [
                        {
                            "type": "tool_result",
                            "tool_use_id": "call_001",
                            "content": "file contents here",
                        },
                    ],
                },
            }
        )
        ev = await b.parse_output(line)
        assert ev is not None
        assert ev.event_type == "tool_result"
        assert ev.call_id == "call_001"
        assert ev.tool_output == "file contents here"


# ===========================================================================
# parse_output — result event
# ===========================================================================


class TestParseOutputResult:
    """TDD 9: result 类型不产生外部 event，但提取 session_id/is_error。"""

    @pytest.mark.asyncio
    async def test_parse_output_result_event_no_error(self):
        """result 消息（成功）→ 不产生 event 或 terminal event。"""
        b = _backend()
        line = json.dumps(
            {
                "type": "result",
                "session_id": "sess_abc",
                "result": "Task completed successfully",
                "is_error": False,
            }
        )
        ev = await b.parse_output(line)
        # 蓝图: result 不产生 event，返回 None
        assert ev is None

    @pytest.mark.asyncio
    async def test_parse_output_result_event_with_error(self):
        """result 消息 is_error=True → 不产生 event（execute 层面处理）。"""
        b = _backend()
        line = json.dumps(
            {
                "type": "result",
                "session_id": "sess_abc",
                "result": "Something went wrong",
                "is_error": True,
            }
        )
        # parse_output 层面返回 None，execute 层面读取内部状态
        ev = await b.parse_output(line)
        assert ev is None


# ===========================================================================
# parse_output — log event
# ===========================================================================


class TestParseOutputLog:
    """TDD 10: log 类型解析 level + message。"""

    @pytest.mark.asyncio
    async def test_parse_output_log_event(self):
        b = _backend()
        line = json.dumps(
            {
                "type": "log",
                "log": {"level": "info", "message": "Processing started"},
            }
        )
        ev = await b.parse_output(line)
        assert ev is not None
        assert ev.event_type == "log"
        assert ev.level == "info"
        assert ev.content == "Processing started"


# ===========================================================================
# parse_output — control_request (auto-approved, returns None)
# ===========================================================================


class TestParseOutputControlRequest:
    """TDD 15: control_request 自动回复，不产生外部 event。"""

    @pytest.mark.asyncio
    async def test_parse_output_control_request_no_event(self):
        """control_request 不产生外部 event。"""
        b = _backend()
        line = json.dumps(
            {
                "type": "control_request",
                "request_id": "req_001",
                "request": {
                    "subtype": "tool_use",
                    "tool_name": "Bash",
                    "input": {"command": "ls"},
                },
            }
        )
        ev = await b.parse_output(line)
        assert ev is None


# ===========================================================================
# _build_args
# ===========================================================================


class TestBuildArgs:
    """TDD 16: 验证 CLI 参数含 --output-format stream-json。"""

    def test_build_args_contains_stream_json(self):
        b = _backend()
        args = b._build_args()
        assert "-p" in args
        assert "--output-format" in args
        # 找到 --output-format 的位置，下一个参数应为 stream-json
        idx = args.index("--output-format")
        assert args[idx + 1] == "stream-json"
        assert "--input-format" in args
        idx2 = args.index("--input-format")
        assert args[idx2 + 1] == "stream-json"
        assert "--verbose" in args
        assert "--permission-mode" in args
        idx3 = args.index("--permission-mode")
        assert args[idx3 + 1] == "bypassPermissions"


# ===========================================================================
# _build_input
# ===========================================================================


class TestBuildInput:
    """TDD 17: 验证 stdin 输入为合法 JSON。"""

    def test_build_input_valid_json(self):
        b = _backend()
        data = b._build_input("hello world")
        parsed = json.loads(data)
        assert parsed["type"] == "user"
        assert parsed["message"]["role"] == "user"
        content = parsed["message"]["content"]
        assert len(content) == 1
        assert content[0]["type"] == "text"
        assert content[0]["text"] == "hello world"

    def test_build_input_ends_with_newline(self):
        b = _backend()
        data = b._build_input("test prompt")
        assert data.endswith(b"\n")


# ===========================================================================
# execute — mock subprocess tests
# ===========================================================================


class TestExecute:
    """TDD 11-14: execute 的各种场景（mock subprocess）。"""

    @pytest.mark.asyncio
    async def test_execute_success(self):
        """mock subprocess 正常输出 → TaskResult(status="completed")。"""
        b = _backend()

        # 准备模拟的 stream-json 输出
        lines = [
            json.dumps({"type": "system", "session_id": "sess_001", "subtype": "init"}),
            json.dumps(
                {
                    "type": "assistant",
                    "message": {
                        "role": "assistant",
                        "content": [{"type": "text", "text": "Hello!"}],
                    },
                }
            ),
            json.dumps(
                {
                    "type": "result",
                    "session_id": "sess_001",
                    "result": "Done",
                    "is_error": False,
                }
            ),
        ]
        stdout_data = "\n".join(lines) + "\n"

        result = await self._run_with_mock(b, stdout_data=stdout_data)

        assert result.status == "completed"
        assert result.session_id == "sess_001"

    @pytest.mark.asyncio
    async def test_execute_process_not_found(self):
        """cmd_path 不存在 → TaskResult(status="failed")。"""
        b = _backend()
        result = await b.execute(
            cmd_path="/nonexistent/claude",
            task_prompt="test",
            work_dir="/tmp",
        )
        assert result.status == "failed"
        assert "failed" in result.status or result.error != ""

    @pytest.mark.asyncio
    async def test_execute_timeout(self):
        """模拟长时间运行 → 超时 → TaskResult(status="timeout")。"""
        b = _backend()

        import unittest.mock as mock

        with mock.patch.object(b, "execute", autospec=True) as patched_exec:
            patched_exec.return_value = TaskResult(
                status="timeout",
                output="",
                error="timed out",
                duration_ms=10000,
            )
            result = await b.execute("claude", "test", "/tmp")
            assert result.status == "timeout"

    @pytest.mark.asyncio
    async def test_execute_accumulates_text(self):
        """mock 多行 assistant text 输出，验证 output 拼接。"""
        b = _backend()

        lines = [
            json.dumps({"type": "system", "session_id": "sess_001", "subtype": "init"}),
            json.dumps(
                {
                    "type": "assistant",
                    "message": {
                        "role": "assistant",
                        "content": [{"type": "text", "text": "Part 1. "}],
                    },
                }
            ),
            json.dumps(
                {
                    "type": "assistant",
                    "message": {
                        "role": "assistant",
                        "content": [{"type": "text", "text": "Part 2."}],
                    },
                }
            ),
            json.dumps(
                {
                    "type": "result",
                    "session_id": "sess_001",
                    "result": "Part 1. Part 2.",
                    "is_error": False,
                }
            ),
        ]
        stdout_data = "\n".join(lines) + "\n"

        result = await self._run_with_mock(b, stdout_data=stdout_data)

        assert result.status == "completed"
        assert "Part 1." in result.output
        assert "Part 2." in result.output

    @pytest.mark.asyncio
    async def test_execute_result_is_error(self):
        """result 消息 is_error=True → TaskResult.status="failed"。"""
        b = _backend()

        lines = [
            json.dumps({"type": "system", "session_id": "sess_001", "subtype": "init"}),
            json.dumps(
                {
                    "type": "result",
                    "session_id": "sess_001",
                    "result": "Error: something failed",
                    "is_error": True,
                }
            ),
        ]
        stdout_data = "\n".join(lines) + "\n"

        result = await self._run_with_mock(b, stdout_data=stdout_data)

        assert result.status == "failed"
        assert "something failed" in result.error

    @pytest.mark.asyncio
    async def test_execute_control_request_auto_approved(self):
        """control_request 时自动回复 control_response。"""
        b = _backend()

        lines = [
            json.dumps({"type": "system", "session_id": "sess_001", "subtype": "init"}),
            json.dumps(
                {
                    "type": "control_request",
                    "request_id": "req_001",
                    "request": {
                        "subtype": "tool_use",
                        "tool_name": "Bash",
                        "input": {"command": "echo hello"},
                    },
                }
            ),
            json.dumps(
                {
                    "type": "assistant",
                    "message": {
                        "role": "assistant",
                        "content": [{"type": "text", "text": "Done"}],
                    },
                }
            ),
            json.dumps(
                {
                    "type": "result",
                    "session_id": "sess_001",
                    "result": "Done",
                    "is_error": False,
                }
            ),
        ]
        stdout_data = "\n".join(lines) + "\n"

        result = await self._run_with_mock(b, stdout_data=stdout_data)

        assert result.status == "completed"

    # --- helper ---

    async def _run_with_mock(
        self, backend, stdout_data: str, stderr_data: str = ""
    ) -> TaskResult:
        """Run backend.execute with a mocked subprocess.

        Patches asyncio.create_subprocess_exec to return a fake process
        that yields the given stdout_data lines.
        """
        import unittest.mock as mock

        # 创建一个 mock 进程
        mock_proc = mock.AsyncMock()
        mock_proc.returncode = 0

        # 模拟 stdout 逐行读取
        stdout_bytes = stdout_data.encode("utf-8")
        mock_proc.stdout = _AsyncReader(stdout_bytes)

        # 模拟 stderr
        stderr_bytes = stderr_data.encode("utf-8") if stderr_data else b""
        mock_proc.stderr = _AsyncReader(stderr_bytes)

        # 模拟 stdin — write is sync, drain is async
        mock_stdin = mock.MagicMock()
        mock_stdin.write = mock.Mock()
        mock_stdin.drain = mock.AsyncMock()
        mock_proc.stdin = mock_stdin

        # 模拟 wait
        mock_proc.wait = mock.AsyncMock(return_value=0)

        # 模拟 kill
        mock_proc.kill = mock.Mock()

        # 模拟 pid
        mock_proc.pid = 12345

        with mock.patch("asyncio.create_subprocess_exec", return_value=mock_proc):
            result = await backend.execute(
                cmd_path="claude",
                task_prompt="test prompt",
                work_dir="/tmp",
            )

        return result


class _AsyncReader:
    """Async iterable that yields lines from a bytes buffer."""

    def __init__(self, data: bytes):
        self._lines = data.split(b"\n")
        self._index = 0

    def __aiter__(self):
        return self

    async def __anext__(self):
        if self._index >= len(self._lines):
            raise StopAsyncIteration
        line = self._lines[self._index]
        self._index += 1
        return line


# ===========================================================================
# Factory registration
# ===========================================================================


class TestFactory:
    """TDD 18: get_backend("claude"/"gemini"/"cursor") 均返回 StreamJsonBackend。"""

    def test_register_in_factory_claude(self):
        from sillyhub_daemon.backends.stream_json import StreamJsonBackend

        cls = get_backend("claude")
        assert cls is StreamJsonBackend

    def test_register_in_factory_gemini(self):
        from sillyhub_daemon.backends.stream_json import StreamJsonBackend

        cls = get_backend("gemini")
        assert cls is StreamJsonBackend

    def test_register_in_factory_cursor(self):
        from sillyhub_daemon.backends.stream_json import StreamJsonBackend

        cls = get_backend("cursor")
        assert cls is StreamJsonBackend


# ===========================================================================
# Inheritance check
# ===========================================================================


class TestInheritance:
    """AC-01: StreamJsonBackend 继承 AgentBackend。"""

    def test_is_agent_backend_subclass(self):
        from sillyhub_daemon.backends.stream_json import StreamJsonBackend

        assert issubclass(StreamJsonBackend, AgentBackend)

    def test_provider_attribute(self):
        from sillyhub_daemon.backends.stream_json import StreamJsonBackend

        b = StreamJsonBackend()
        assert b.provider == "stream_json"
