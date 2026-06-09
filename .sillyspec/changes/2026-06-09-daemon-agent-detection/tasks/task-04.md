---
id: task-04
title: "StreamJsonBackend（claude/gemini/cursor）"
priority: P0
estimated_hours: 2
depends_on: [task-03]
blocks: [task-10]
allowed_paths:
  - sillyhub-daemon/sillyhub_daemon/backends/stream_json.py
  - sillyhub-daemon/tests/test_stream_json_backend.py
author: qinyi
created_at: "2026-06-09 23:25:05"
---

# task-04: StreamJsonBackend（claude/gemini/cursor）

## 修改文件

| 操作 | 文件路径 |
|------|---------|
| 新增 | `sillyhub-daemon/sillyhub_daemon/backends/stream_json.py` |
| 新增 | `sillyhub-daemon/tests/test_stream_json_backend.py` |
| 修改 | `sillyhub-daemon/sillyhub_daemon/backends/__init__.py`（注册 StreamJsonBackend） |

## 实现要求

1. 实现 `StreamJsonBackend(AgentBackend)`，处理 NDJSON stream-json 协议
2. 适用 provider：claude, gemini, cursor
3. `execute()` 方法流程：
   a. 构建 CLI 参数：`[cmd_path, "-p", "--output-format", "stream-json", "--input-format", "stream-json", "--verbose", "--permission-mode", "bypassPermissions"]`
   b. 使用 `asyncio.create_subprocess_exec` 启动进程，设置 stdin=PIPE, stdout=PIPE, stderr=PIPE
   c. 写入 prompt JSON 到 stdin：

      ```python
      {"type": "user", "message": {"role": "user", "content": [{"type": "text", "text": task_prompt}]}}
      ```

   d. 逐行读取 stdout，每行调用 `parse_output()` 解析
   e. 累积文本输出到 TaskResult.output
   f. 进程结束后构建 TaskResult 返回
   g. 设置 10 秒超时（`asyncio.wait_for`）

4. `parse_output(line: str) -> AgentEvent | None` 方法：
   - 空行返回 `None`
   - JSON 解析失败返回 `None`（不抛异常）
   - 解析 `type` 字段分发处理：

   | type | 生成 AgentEvent |
   |------|----------------|
   | `assistant` | 解析 `message.content` 数组：text→text event, thinking→thinking event, tool_use→tool_use event |
   | `user` | 解析 `message.content` 数组：tool_result→tool_result event |
   | `system` | status event，提取 session_id |
   | `result` | 不产生 event（用于最终结果），提取 session_id、is_error |
   | `log` | log event，提取 level + message |
   | `control_request` | 自动回复 `control_response`（allow），不产生外部 event |

5. 注册到 `backends/__init__.py` 的 `get_backend()` 工厂中：
   - claude → `StreamJsonBackend`
   - gemini → `StreamJsonBackend`
   - cursor → `StreamJsonBackend`

6. claude 特有的版本输出格式：`--version` 输出 `"Claude Code 2.1.5"` 等，但此任务只需处理 stream-json 输出解析

## 接口定义

```python
"""StreamJsonBackend: NDJSON stream-json protocol for claude/gemini/cursor."""

from __future__ import annotations

import asyncio
import json
import logging
import time
from dataclasses import dataclass

from . import AgentBackend, AgentEvent, TaskResult

logger = logging.getLogger(__name__)

class StreamJsonBackend(AgentBackend):
    provider: str = "claude"  # overridden by caller or factory

    async def execute(
        self,
        cmd_path: str,
        task_prompt: str,
        work_dir: str,
        env: dict | None = None,
    ) -> TaskResult: ...

    async def parse_output(self, line: str) -> AgentEvent | None: ...

    # 内部方法
    def _build_args(self) -> list[str]: ...
    def _build_input(self, prompt: str) -> bytes: ...
    def _handle_control_request(self, request: dict, stdin) -> None: ...
```

### Claude stream-json 协议消息类型（参考 claude.go）

```python
# Claude SDK 消息结构
@dataclass
class _SDKMessage:
    type: str                      # "assistant", "user", "system", "result", "log", "control_request"
    message: dict | None = None    # nested message object
    session_id: str = ""
    result: str = ""               # for type="result"
    is_error: bool = False
    log: dict | None = None        # {"level": "info", "message": "..."}
    request_id: str = ""           # for control_request
    request: dict | None = None    # for control_request

# message.content 数组中 block 类型
# {"type": "text", "text": "..."}
# {"type": "thinking", "text": "..."}
# {"type": "tool_use", "id": "...", "name": "...", "input": {...}}
# {"type": "tool_result", "tool_use_id": "...", "content": "..."}
```

## 边界处理

1. **stdout 行非合法 JSON**：`json.loads` 失败时 logger.debug 记录并返回 None，不中断解析循环
2. **空行或仅空白字符**：`line.strip()` 为空时跳过，返回 None
3. **未知 message type**：不匹配任何已知的 `type` 字段时，logger.debug 记录并跳过
4. **进程启动失败（FileNotFoundError）**：捕获异常，返回 `TaskResult(status="failed", error=str(e))`
5. **进程超时**：`asyncio.wait_for` 超时后 kill 进程，返回 `TaskResult(status="timeout")`
6. **stdin 写入失败（broken pipe）**：捕获 `BrokenPipeError`，记录日志，继续读取 stdout 已有输出
7. **stderr 输出**：捕获 stderr 内容，失败时附加到 `TaskResult.error`
8. **assistant message 无 content 数组**：跳过，不崩溃
9. **tool_use block 的 input 字段为 null**：解析为空 dict `{}`
10. **result 消息带 is_error=True**：设置 `TaskResult.status="failed"`, `TaskResult.error` 设为 result 文本

## 非目标

- 不实现 JSON-RPC 协议（task-05 负责）
- 不实现 JSONL 协议（task-06 负责）
- 不实现 MCP 配置注入
- 不实现 model 选择参数透传
- 不实现 session resume（--resume）
- 不实现 max-turns 限制

## 参考

- design.md Phase 3 StreamJsonBackend 描述
- multica `server/pkg/agent/claude.go` 完整实现：
  - `claudeSDKMessage` 结构体（第 361-382 行）— 消息类型定义
  - `handleAssistant()` （第 258-298 行）— assistant 消息解析
  - `handleUser()` （第 300-319 行）— user/tool_result 解析
  - `handleControlRequest()` （第 321-357 行）— 自动 approve 逻辑
  - `buildClaudeArgs()` （第 500-538 行）— CLI 参数构建
  - `buildClaudeInput()` （第 551-569 行）— stdin 输入格式
- multica `server/pkg/agent/agent.go` `Message` / `Result` 类型定义

## TDD步骤

1. 写测试：`test_parse_output_empty_line` — 空行/空白行返回 None
2. 写测试：`test_parse_output_invalid_json` — 非 JSON 字符串返回 None
3. 写测试：`test_parse_output_unknown_type` — `{"type":"custom"}` 返回 None
4. 写测试：`test_parse_output_system_event` — system 类型解析出 session_id
5. 写测试：`test_parse_output_assistant_text` — assistant.content[text] → AgentEvent(event_type="text")
6. 写测试：`test_parse_output_assistant_thinking` — assistant.content[thinking] → AgentEvent(event_type="thinking")
7. 写测试：`test_parse_output_assistant_tool_use` — assistant.content[tool_use] → AgentEvent(event_type="tool_use", tool_name, call_id)
8. 写测试：`test_parse_output_user_tool_result` — user.content[tool_result] → AgentEvent(event_type="tool_result")
9. 写测试：`test_parse_output_result_event` — result 类型不产生 event（或产生 terminal event）
10. 写测试：`test_parse_output_log_event` — log 类型解析 level + message
11. 写测试：`test_execute_success` — mock subprocess，验证 TaskResult(status="completed")
12. 写测试：`test_execute_process_not_found` — cmd_path 不存在，验证 TaskResult(status="failed")
13. 写测试：`test_execute_timeout` — mock 长时间运行，验证 TaskResult(status="timeout")
14. 写测试：`test_execute_accumulates_text` — mock 多行 assistant text 输出，验证 output 拼接
15. 写测试：`test_control_request_auto_approved` — mock control_request + stdin，验证自动回复
16. 写测试：`test_build_args_contains_stream_json` — 验证参数含 --output-format stream-json
17. 写测试：`test_build_input_valid_json` — 验证 stdin 输入为合法 JSON
18. 写测试：`test_register_in_factory` — get_backend("claude") 返回 StreamJsonBackend
19. 实现所有代码使测试通过

## 验收标准

| 编号 | 验收条件 | 验证方式 |
|------|---------|---------|
| AC-01 | StreamJsonBackend 继承 AgentBackend | isinstance 检查 |
| AC-02 | parse_output 正确解析 assistant text 事件 | 单元测试 |
| AC-03 | parse_output 正确解析 tool_use 事件（含 name/call_id/input） | 单元测试 |
| AC-04 | parse_output 正确解析 tool_result 事件 | 单元测试 |
| AC-05 | parse_output 对空行/无效 JSON/未知 type 返回 None | 单元测试 |
| AC-06 | execute 正常流程返回 TaskResult(status="completed") | mock subprocess 测试 |
| AC-07 | execute 进程不存在时返回 TaskResult(status="failed") | mock 测试 |
| AC-08 | execute 超时时返回 TaskResult(status="timeout") | mock 测试 |
| AC-09 | control_request 自动回复 control_response | mock stdin 测试 |
| AC-10 | get_backend("claude"/"gemini"/"cursor") 均返回 StreamJsonBackend | 工厂测试 |
| AC-11 | result 消息 is_error=True 时 TaskResult.status="failed" | 单元测试 |
