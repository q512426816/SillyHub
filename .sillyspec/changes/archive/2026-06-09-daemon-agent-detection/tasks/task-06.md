---
id: task-06
title: "JsonlBackend + NdjsonBackend + TextBackend"
author: qinyi
created_at: "2026-06-09 23:25:05"
priority: P1
estimated_hours: 2
depends_on:
  - task-03
blocks:
  - task-10
allowed_paths:
  - sillyhub-daemon/sillyhub_daemon/backends/jsonl.py
  - sillyhub-daemon/sillyhub_daemon/backends/ndjson.py
  - sillyhub-daemon/sillyhub_daemon/backends/text.py
  - sillyhub-daemon/sillyhub_daemon/backends/__init__.py
  - sillyhub-daemon/tests/test_jsonl_backend.py
  - sillyhub-daemon/tests/test_ndjson_backend.py
  - sillyhub-daemon/tests/test_text_backend.py
---

# Task-06: JsonlBackend + NdjsonBackend + TextBackend

## 修改文件

| 操作 | 文件路径 | 说明 |
|------|---------|------|
| 新增 | `sillyhub-daemon/sillyhub_daemon/backends/jsonl.py` | copilot JSONL 点分事件协议 backend |
| 新增 | `sillyhub-daemon/sillyhub_daemon/backends/ndjson.py` | opencode/openclaw/pi NDJSON 协议 backend |
| 新增 | `sillyhub-daemon/sillyhub_daemon/backends/text.py` | antigravity 纯文本 stdout 协议 backend |
| 修改 | `sillyhub-daemon/sillyhub_daemon/backends/__init__.py` | 注册 jsonl/ndjson/text protocol 到工厂 |

## 实现要求

### 1. JsonlBackend（copilot）

参考 multica `copilot.go`，copilot CLI 使用 `--output-format json` 输出 JSONL 事件流。

**启动命令**：
```
copilot -p "<prompt>" --output-format json --allow-all --no-ask-user [--model <m>] [--resume <session-id>]
```

**协议格式**：每行是一个 JSON 对象，包含 `type`（点分事件名）和 `data` 字段：
```json
{"type": "dotted.event.name", "data": {...}, "id": "...", "timestamp": "..."}
```

**事件处理**（参考 `copilot.go` 的 `handleCopilotEvent`）：

| 事件类型 | 处理 |
|---------|------|
| `session.start` | 提取 `sessionId`、`selectedModel` |
| `assistant.message_delta` | 提取 `deltaContent`，发出 TextEvent（流式增量） |
| `assistant.message` | 提取完整 `content`（重置 output 防止重复计数）、`toolRequests`（发出 ToolUseEvent）、`reasoningText`（发出 ThinkingEvent） |
| `assistant.reasoning` / `assistant.reasoning_delta` | 提取 `content`/`deltaContent`，发出 ThinkingEvent |
| `tool.execution_complete` | 提取 `result.content` 或 `error.message`，发出 ToolResultEvent |
| `assistant.turn_start` | 发出 StatusEvent("running") |
| `session.error` | 设置 failed 状态，发出 ErrorEvent |
| `session.warning` | 发出 WarningEvent |
| `result` | 最后一行，提取 `sessionId`、`exitCode` |

**状态管理**：参考 `copilotEventState` 结构，维护 `output`（完整文本累积）、`sessionID`、`activeModel`、`finalStatus`、`finalError`、`usage`。

### 2. NdjsonBackend（opencode/openclaw/pi）

参考 multica `opencode.go`，使用 `run --format json` 子命令输出 NDJSON 事件流。

**启动命令**（以 opencode 为例）：
```
opencode run --format json --dangerously-skip-permissions [--dir <cwd>] [--model <m>] [--session <id>] <prompt>
```

**协议格式**：每行是一个 JSON 对象：
```json
{"type": "text", "part": {"text": "..."}, "sessionID": "...", "timestamp": ...}
```

**事件处理**（参考 `opencode.go` 的 `processEvents`）：

| 事件类型 | 处理 |
|---------|------|
| `text` | 提取 `part.text`，发出 TextEvent |
| `tool_use` | 提取 `part.tool`、`part.callID`、`part.state.input`（发出 ToolUseEvent），如果 `part.state.status == "completed"` 则同时发出 ToolResultEvent |
| `error` | 提取 `error.data.message`，设置 failed 状态，发出 ErrorEvent |
| `step_start` | 发出 StatusEvent("running") |
| `step_finish` | 累积 token usage（`part.tokens.input`、`part.tokens.output`、`part.tokens.cache.read/write`） |

**provider 差异**：

| Provider | 二进制名 | 启动命令模板 |
|----------|---------|------------|
| opencode | `opencode` | `run --format json --dangerously-skip-permissions [--dir <cwd>] <prompt>` |
| openclaw | `openclaw` | 类似 opencode 的 `run --format json` 模式 |
| pi | `pi` | 类似 opencode 的 NDJSON 模式 |

对于 openclaw 和 pi，如果实际 CLI 不完全支持 `--format json` 参数，则 fallback 到逐行读取 stdout 作为纯文本。

### 3. TextBackend（antigravity）

参考 multica `antigravity.go`，antigravity CLI 使用纯文本 stdout 输出。

**启动命令**：
```
agy -p "<prompt>" --dangerously-skip-permissions [--model <m>] [--add-dir <cwd>]
```

**协议格式**：stdout 逐行输出纯文本，无结构化事件。

**处理方式**（参考 `antigravity.go` 的 Execute 方法）：
- 每行非空文本发出一个 TextEvent
- 累积所有行到 output（用 `\n` 分隔）
- 进程退出后根据退出码和 context 错误确定 final status

**session 恢复**：通过 `--conversation <id>` 参数（V2 功能，当前仅预留参数位置）。

## 接口定义

```python
from sillyhub_daemon.backends import AgentBackend, TaskResult, AgentEvent

class JsonlBackend(AgentBackend):
    """JSONL dotted-event protocol backend for copilot."""

    provider: str  # "copilot"

    async def execute(
        self,
        cmd_path: str,
        task_prompt: str,
        work_dir: str,
        env: dict[str, str],
        *,
        timeout: float = 0,
        model: str = "",
        session_id: str = "",
    ) -> TaskResult: ...

    async def parse_output(self, line: str) -> AgentEvent | None: ...


class NdjsonBackend(AgentBackend):
    """NDJSON streaming protocol backend for opencode/openclaw/pi."""

    provider: str  # "opencode" | "openclaw" | "pi"

    async def execute(
        self,
        cmd_path: str,
        task_prompt: str,
        work_dir: str,
        env: dict[str, str],
        *,
        timeout: float = 0,
        model: str = "",
        session_id: str = "",
    ) -> TaskResult: ...

    async def parse_output(self, line: str) -> AgentEvent | None: ...


class TextBackend(AgentBackend):
    """Plain text stdout protocol backend for antigravity."""

    provider: str  # "antigravity"

    async def execute(
        self,
        cmd_path: str,
        task_prompt: str,
        work_dir: str,
        env: dict[str, str],
        *,
        timeout: float = 0,
        model: str = "",
        session_id: str = "",
    ) -> TaskResult: ...

    async def parse_output(self, line: str) -> AgentEvent | None:
        """For TextBackend, every non-empty line becomes a TextEvent."""
        ...
```

## 边界处理

1. **子进程启动失败**：二进制不存在 -> 返回 `TaskResult(success=False, error="...executable not found...")`。
2. **空行跳过**：JSONL/NDJSON 模式下，空行直接跳过，不尝试 JSON 解析。TextBackend 模式下空行也跳过（不发出 TextEvent）。
3. **JSON 解析失败**：JSONL/NDJSON 中某行不是合法 JSON -> 跳过该行，记录 warning 日志，不中断会话。
4. **copilot message_delta 与 message 的重复计数**：`assistant.message_delta` 先增量写入 output，`assistant.message` 到达时重写权威内容（参考 copilot.go 的 output reset 逻辑），避免 delta + full 导致文本翻倍。
5. **opencode tool_use 合并 call+result**：一个 `tool_use` 事件可能同时包含 `state.status == "completed"` 和 `state.output`，需要同时发出 ToolUseEvent 和 ToolResultEvent（参考 opencode.go 的 `handleToolUseEvent`）。
6. **进程退出码语义不一致**：某些 agent 正常完成后退出码非 0（如超时信号），最终状态由 context 错误（DeadlineExceeded / Cancelled）优先决定，不单看退出码。
7. **session 恢复参数缺失**：如果传入 `session_id` 但 agent CLI 不支持 `--resume`/`--session`/`--conversation` 参数 -> 忽略 session_id，从头开始新会话，记录 warning。

## 非目标

- 不实现 copilot 的 `--acp` 模式切换（block `--acp` 参数）。
- 不实现 copilot 的 `codeChanges` 统计。
- 不实现 opencode 的 Windows shim 解析（`resolveOpenCodeNativeFromShim`）。
- 不实现 opencode 的 `OPENCODE_CONFIG_CONTENT` MCP 注入。
- 不实现 antigravity 的 `--log-file` session ID 捕获。
- 不实现 antigravity 的 `agy models` 校验。
- 不实现 token usage 扫描（copilot 的 `premiumRequests`，opencode 的 `step_finish` token 只做累积不外传）。

## 参考

- `multica/server/pkg/agent/copilot.go`：copilot JSONL 协议，`handleCopilotEvent`、`copilotEventState`、`buildCopilotArgs`。
- `multica/server/pkg/agent/opencode.go`：opencode NDJSON 协议，`processEvents`、`handleTextEvent`、`handleToolUseEvent`、`handleErrorEvent`、`opencodeEvent` 类型定义。
- `multica/server/pkg/agent/antigravity.go`：antigravity 纯文本协议，`Execute`、`buildAntigravityArgs`。
- Design 文档 `.sillyspec/changes/2026-06-09-daemon-agent-detection/design.md` Phase 3。
- Plan 文档 `.sillyspec/changes/2026-06-09-daemon-agent-detection/plan.md` Wave 2。

## TDD步骤

1. **写测试 `_testJsonlBackend_build_args`**：验证 copilot 启动命令包含 `-p`、`--output-format json`、`--allow-all`、`--no-ask-user`。
2. **写测试 `_testJsonlBackend_parse_session_start`**：模拟 `session.start` 事件，验证提取 `sessionId` 和 `selectedModel`。
3. **写测试 `_testJsonlBackend_parse_message_delta`**：模拟 `assistant.message_delta` 事件，验证发出 TextEvent。
4. **写测试 `_testJsonlBackend_parse_message_full`**：模拟 `assistant.message` 事件（含 toolRequests），验证 ToolUseEvent 发出 + output 重置。
5. **写测试 `_testJsonlBackend_parse_tool_complete`**：模拟 `tool.execution_complete` 事件，验证 ToolResultEvent。
6. **写测试 `_testJsonlBackend_parse_result`**：模拟最终 `result` 事件，验证 sessionID 和 exitCode 提取。
7. **实现 `JsonlBackend`**：使测试 1-6 通过。
8. **写测试 `_testNdjsonBackend_build_args_opencode`**：验证 opencode 启动命令包含 `run --format json --dangerously-skip-permissions`。
9. **写测试 `_testNdjsonBackend_parse_text_event`**：模拟 `text` 事件，验证 TextEvent。
10. **写测试 `_testNdjsonBackend_parse_tool_use_event`**：模拟 `tool_use` 事件，验证 ToolUseEvent + ToolResultEvent（state.status == completed）。
11. **写测试 `_testNdjsonBackend_parse_error_event`**：模拟 `error` 事件，验证 failed 状态。
12. **写测试 `_testNdjsonBackend_parse_step_finish`**：模拟 `step_finish` 事件，验证 token usage 累积。
13. **实现 `NdjsonBackend`**：使测试 8-12 通过。
14. **写测试 `_testTextBackend_build_args`**：验证 agy 启动命令包含 `-p`、`--dangerously-skip-permissions`。
15. **写测试 `_testTextBackend_execute`**：模拟多行 stdout 输出，验证每行发出 TextEvent，最终 output 是完整文本。
16. **实现 `TextBackend`**：使测试 14-15 通过。
17. **注册到工厂**：在 `backends/__init__.py` 中注册 `"jsonl"` -> JsonlBackend、`"ndjson"` -> NdjsonBackend、`"text"` -> TextBackend。

## 验收标准

| 编号 | 验收条件 | 验证方式 |
|------|---------|---------|
| A-01 | `JsonlBackend` 继承 `AgentBackend`，provider="copilot" | 代码审查 |
| A-02 | `NdjsonBackend` 继承 `AgentBackend`，支持 opencode/openclaw/pi | 代码审查 |
| A-03 | `TextBackend` 继承 `AgentBackend`，provider="antigravity" | 代码审查 |
| A-04 | JsonlBackend 正确解析 copilot 的点分事件类型（`session.start`、`assistant.message_delta`、`assistant.message`、`tool.execution_complete`、`result`） | 单元测试 |
| A-05 | NdjsonBackend 正确解析 opencode 事件（`text`、`tool_use`、`error`、`step_start`、`step_finish`） | 单元测试 |
| A-06 | TextBackend 将 stdout 每行非空文本转为 TextEvent | 单元测试 |
| A-07 | copilot `assistant.message` 到达时正确重置 output 避免 delta 重复计数 | 单元测试 |
| A-08 | opencode `tool_use` 事件在 `state.status=="completed"` 时同时发出 ToolUseEvent 和 ToolResultEvent | 单元测试 |
| A-09 | 三种 Backend 在工厂中正确注册：`"jsonl"`、`"ndjson"`、`"text"` | 导入测试 |
| A-10 | 非法 JSON 行不导致崩溃 | 单元测试 |
| A-11 | 所有测试通过 `pytest sillyhub-daemon/tests/test_jsonl_backend.py sillyhub-daemon/tests/test_ndjson_backend.py sillyhub-daemon/tests/test_text_backend.py` | CI |
