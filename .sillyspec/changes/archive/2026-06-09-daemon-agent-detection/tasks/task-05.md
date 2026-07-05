---
id: task-05
title: "JsonRpcBackend（codex/hermes/kimi/kiro）"
author: qinyi
created_at: "2026-06-09 23:25:05"
priority: P0
estimated_hours: 2
depends_on:
  - task-03
blocks:
  - task-10
allowed_paths:
  - sillyhub-daemon/sillyhub_daemon/backends/json_rpc.py
  - sillyhub-daemon/sillyhub_daemon/backends/__init__.py
  - sillyhub-daemon/tests/test_json_rpc.py
---

# Task-05: JsonRpcBackend（codex/hermes/kimi/kiro）

## 修改文件

| 操作 | 文件路径 | 说明 |
|------|---------|------|
| 新增 | `sillyhub-daemon/sillyhub_daemon/backends/json_rpc.py` | JSON-RPC 2.0 over stdio 协议 backend |
| 修改 | `sillyhub-daemon/sillyhub_daemon/backends/__init__.py` | 注册 json_rpc protocol 到工厂 |

## 实现要求

### JsonRpcBackend 类

继承 `AgentBackend`（task-03 定义的抽象基类），实现 JSON-RPC 2.0 over stdio 协议。

核心流程（参考 multica `codex.go` 的 `codexBackend.Execute`）：

1. **启动子进程**：`codex` 使用 `codex app-server --listen stdio://` 子命令；hermes/kimi/kiro 使用 ACP 协议（简化为 JSON-RPC 基础支持，启动方式类似但不一定需要 `app-server` 子命令）。
2. **JSON-RPC 握手**：发送 `initialize` 请求，包含 `clientInfo`（name: "sillyhub-daemon", version: "0.1.0"），收到响应后发送 `notifications/initialized` 通知。
3. **创建/恢复会话**：
   - 新建：发送 `thread/start` 请求，传入 `model`、`cwd`、`developerInstructions` 等参数。
   - 恢复：发送 `thread/resume` 请求，传入 `threadId`、`cwd`、`model`。
4. **发送任务**：发送 `turn/start` 请求，传入 `threadId` 和 `input`（`[{"type": "text", "text": prompt}]`）。
5. **读取响应**：从 stdout 逐行读取 JSON-RPC 消息，按 `method` 分发处理：
   - `turn/started` -> 发出 StatusEvent("running")
   - `turn/completed` -> 结束任务，提取 token usage
   - `item/completed` + `itemType=agentMessage` -> 提取文本内容，发出 TextEvent
   - `item/started` + `itemType=commandExecution` -> 发出 ToolUseEvent
   - `item/completed` + `itemType=commandExecution` -> 发出 ToolResultEvent
   - `item/started` + `itemType=fileChange` -> 发出 ToolUseEvent("patch_apply")
   - `item/completed` + `itemType=fileChange` -> 发出 ToolResultEvent("patch_apply")
   - 服务端请求（带 id + method）如 `item/commandExecution/requestApproval` -> 自动回复 `{"decision": "accept"}`
6. **超时处理**：支持 wall-time 超时和 semantic inactivity 超时（默认 10 分钟无进展则超时）。

### JSON-RPC 传输层

实现内部 `_JsonRpcTransport` 类，封装：

- `request(method, params)` -> 发送请求，等待对应 id 的响应（通过 asyncio.Queue 匹配）
- `notify(method)` -> 发送通知（无 id，不等响应）
- `respond(id, result)` -> 回复服务端请求
- `_read_loop()` -> 后台协程，从 stdout 逐行读取，按是否有 `id`/`method`/`result`/`error` 分发到对应处理器

每条消息是单行 JSON + `\n`。

### provider 差异

| Provider | 启动命令 | 子命令 | 备注 |
|----------|---------|--------|------|
| codex | `codex` | `app-server --listen stdio://` | 完整 JSON-RPC |
| hermes | `hermes` | 无子命令（直接启动） | ACP 简化 |
| kimi | `kimi` | 无子命令（直接启动） | ACP 简化 |
| kiro | `kiro-cli` | 无子命令（直接启动） | ACP 简化 |

对于 hermes/kimi/kiro，握手流程简化为：仅发送 `initialize` + `notifications/initialized`，然后直接发送 prompt。如果这些 agent 的实际协议与 JSON-RPC 不完全兼容，则 fallback 到发送 prompt 到 stdin 并读取 stdout 文本。

## 接口定义

```python
from sillyhub_daemon.backends import AgentBackend, TaskResult, AgentEvent

class JsonRpcBackend(AgentBackend):
    """JSON-RPC 2.0 over stdio protocol backend for codex/hermes/kimi/kiro."""

    provider: str  # "codex" | "hermes" | "kimi" | "kiro"

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
    ) -> TaskResult:
        """Execute agent via JSON-RPC protocol.

        Spawns the agent process, performs handshake, sends the task,
        streams events, and returns the final result.
        """

    async def parse_output(self, line: str) -> AgentEvent | None:
        """Parse a JSON-RPC response/notification line into an AgentEvent."""
```

## 边界处理

1. **子进程启动失败**：`exec_path` 不存在或权限不足 -> 捕获 `OSError`/`FileNotFoundError`，返回 `TaskResult(success=False, error="...")`，不抛异常。
2. **JSON-RPC 握手超时**：`initialize` 请求 30 秒内无响应 -> 标记 `status="failed"`，附带 stderr 尾部信息（参考 codex.go 的 `codexStderrTailBytes` 模式，保留最后 2048 字节 stderr）。
3. **stdout 非期望格式**：某行不是合法 JSON，或缺少 `jsonrpc` 字段 -> 跳过该行，记录 warning 日志，不中断整个会话。
4. **turn/completed 带错误状态**：`status="failed"` 时提取 `error.message`，设置 `TaskResult.error`，但 `success=False` 而非抛异常。
5. **semantic inactivity 超时**：默认 10 分钟无进展（无 agent message、无 tool use、无 tool result），主动关闭 stdin 结束进程，返回 `TaskResult(success=False, error="codex semantic inactivity timeout...")`。
6. **进程退出码非 0**：在 turn/completed 正常结束后进程仍返回非 0 -> 保留 TaskResult 的 success 状态由 turn/completed 决定（因为 codex 可能在正常完成后返回非 0 退出码用于信号关闭）。
7. **并发线程过滤**：codex app-server 在同一 stdio pipe 上多路复用子 agent 线程，只处理与当前 `thread_id` 匹配的通知，忽略其他线程的消息。

## 非目标

- 不实现 codex 的 MCP config.toml 写入（`ensureCodexMcpConfig`），这是 V2 功能。
- 不实现 codex session JSONL 日志扫描提取 token usage（`scanCodexSessionUsage`），这是 fallback 机制，V2 再说。
- 不实现 thinking level / reasoning effort 注入（`applyCodexReasoningEffort`），V2 再说。
- 不实现 thread 命名（`thread/name/set`），V2 再说。
- hermes/kimi/kiro 的 ACP 协议完整实现不做，仅支持 JSON-RPC 基础交互。如果这些 agent 的协议不兼容，fallback 到纯文本 stdin/stdout。

## 参考

- `multica/server/pkg/agent/codex.go`：codex JSON-RPC 协议完整实现，包括 `codexClient`、`handleLine`、`handleNotification`、`handleRawNotification`、`handleItemNotification`、`handleServerRequest`。
- `multica/server/pkg/agent/agent.go`：Backend 抽象接口、Config 结构。
- Design 文档 `.sillyspec/changes/2026-06-09-daemon-agent-detection/design.md` Phase 3。
- Plan 文档 `.sillyspec/changes/2026-06-09-daemon-agent-detection/plan.md` Wave 2。

## TDD步骤

1. **写测试 `_testJsonRpcTransport_request_response`**：mock stdin/stdout pipe，发送 request 并验证写入的 JSON 格式（`jsonrpc: "2.0"`, `id`, `method`, `params`），模拟响应返回后验证结果解析。
2. **写测试 `_testJsonRpcTransport_notification`**：验证 notify 不带 id，不等响应。
3. **写测试 `_testJsonRpcTransport_server_request_auto_approval`**：模拟收到 `item/commandExecution/requestApproval`，验证自动回复 `{"decision": "accept"}`。
4. **写测试 `_testJsonRpcBackend_execute_handshake`**：mock 完整握手流程（initialize -> initialized -> thread/start -> turn/start），验证每步发送的消息格式。
5. **写测试 `_testJsonRpcBackend_execute_item_events`**：模拟 `item/completed agentMessage` 事件，验证提取文本内容并生成 TextEvent。
6. **写测试 `_testJsonRpcBackend_execute_turn_completed`**：模拟 `turn/completed` 事件，验证生成最终 TaskResult。
7. **写测试 `_testJsonRpcBackend_execute_timeout`**：模拟超时场景，验证 semantic inactivity 超时后正确关闭进程。
8. **写测试 `_testJsonRpcBackend_execute_malformed_line`**：stdout 中混入非 JSON 行，验证跳过不崩溃。
9. **写测试 `_testJsonRpcBackend_parse_output`**：各种 JSON-RPC 行格式的解析。
10. **实现 `_JsonRpcTransport`**：使测试 1-3 通过。
11. **实现 `JsonRpcBackend.execute`**：使测试 4-9 通过。
12. **注册到工厂**：在 `backends/__init__.py` 中将 `"json_rpc"` protocol 映射到 `JsonRpcBackend`。

## 验收标准

| 编号 | 验收条件 | 验证方式 |
|------|---------|---------|
| A-01 | `JsonRpcBackend` 类存在，继承 `AgentBackend`，包含 `execute` 和 `parse_output` 方法 | 代码审查 |
| A-02 | `execute` 方法对 codex provider 生成 `codex app-server --listen stdio://` 命令 | 单元测试 mock |
| A-03 | `execute` 方法对 hermes/kimi/kiro provider 不使用 `app-server` 子命令 | 单元测试 mock |
| A-04 | JSON-RPC 握手正确发送 `initialize` 请求并等待响应 | 单元测试 |
| A-05 | 收到 `turn/completed` 通知后正确生成 `TaskResult`，提取 token usage | 单元测试 |
| A-06 | 服务端审批请求（`requestApproval`）自动回复 accept | 单元测试 |
| A-07 | 非当前 thread_id 的通知被过滤忽略 | 单元测试 |
| A-08 | stdout 非法 JSON 行不导致崩溃，仅记录 warning | 单元测试 |
| A-09 | `backends/__init__.py` 中 `"json_rpc"` protocol 映射到 `JsonRpcBackend` | 导入测试 |
| A-10 | 所有测试通过 `pytest sillyhub-daemon/tests/test_json_rpc.py` | CI |
