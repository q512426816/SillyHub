---
schema_version: 1
doc_type: module-card
module_id: backend-json-rpc
author: qinyi
created_at: 2026-06-10T16:55:00
---

# backend-json-rpc

## 定位
JSON-RPC 2.0 over stdio 协议 adapter，服务 codex / hermes / kimi / kiro 四种 provider。Agent CLI 由 TaskRunner spawn，本 adapter 负责按 codex app-server 协议流程构造握手 request（`buildHandshake` / `buildTurnStart`）+ 解析双向 JSON-RPC 消息（`parse`）：initialize → notifications/initialized → thread/start → turn/start → stream items → turn/completed。底层消息收发（request/notify/respond）由 TaskRunner 通过 stdin/stdout 调度，本 adapter 提供协议构造、解析与自动应答决策。

## 契约摘要
- `JsonRpcAdapter` implements `ProtocolAdapter` — provider 运行时确定（codex/hermes/kimi/kiro）
- `parse(line): AgentEvent[]` — 解析 stdout 单行 JSON-RPC 消息
- `buildArgs(opts?): string[]` — 返回启动参数（codex `['app-server', '--listen', 'stdio://']`；其他 provider 空数组）
- `buildHandshake(opts): string[]` — 返回 3 行 JSON-RPC 握手序列（initialize / notifications/initialized / thread.start）
- `buildTurnStart(opts): string` — 用真实 threadId 构造 turn/start request（params.threadId + instructions[] + model?）
- 自动应答决策：commandExecution、fileChange、mcpServer/elicitation 等 approval 请求（返回 `decision: "accept"`）
- 解析的请求方法：initialize / thread/start / turn/start / notifications/initialized / turn/completed / events.*

## 关键逻辑
```
buildHandshake({ cwd, prompt, model? })
  return [
    { id:1, method:'initialize', params:{ clientInfo:{name,version} } },
    { method:'notifications/initialized' },
    { id:2, method:'thread/start', params:{ cwd } },
  ]

buildTurnStart({ threadId, prompt, model? })
  params = { threadId, instructions:[prompt] }
  if model: params.model = model
  return { id:3, method:'turn/start', params }

parse(line)
  msg = JSON.parse(line)  // JSON-RPC 2.0
  if msg.method starts with "approval/":
    return [AgentEvent(...), { respond: { id: msg.id, decision: "accept" } }]
  switch msg.method:
    events/turn/message → text/tool_use/tool_result events
    events/turn/started → session 记录
    events/turn/completed → final status
  return events + controlMsgs（如需写 stdin）
```

## 注意事项
- Node 版只做协议构造、解析和应答决策；JSON-RPC 传输（request/notify/respond、early_responses 竞态处理）下沉到 TaskRunner
- **codex 字段名陷阱**：必须是 `clientInfo`（不是 `client`）、`threadId`（不是 `thread_id`），否则 codex 直接返回 -32600 Invalid Request
- **codex 启动模式必须 `app-server --listen stdio://`**：缺 `--listen` codex CLI 会进入交互式 TUI，stdin 非 terminal 立即 exit 1（"stdin is not a terminal"）
- **prompt 走 turn/start.instructions**，不走 stdin 文本：JSON-RPC 协议 adapter 实现 buildHandshake 时，TaskRunner 跳过 buildInput，避免 codex 收到非法 JSON 文本
- **threadId 时序**：thread/start response (id=2) 含 result.thread.id，TaskRunner._handleLine 检测到后立即调 buildTurnStart 写 turn/start（spawn 时 threadId 未知）
- 自动审批所有 commandExecution 和 fileChange 请求（`decision: "accept"`）
- hermes/kimi/kiro 共享 codex 的 buildHandshake/buildTurnStart 实现（同 JSON-RPC 协议）
- adapter 内部跨行维护 session_id、final_status、final_error 状态，每次任务前需重置
- 依赖 backends（ProtocolAdapter 接口）

## 人工备注

<!-- MANUAL_NOTES_START -->
ql-20260617-008：buildHandshake / buildTurnStart 实现完成。codex app-server 实测可用。
关键修复：(1) 字段名 clientInfo/threadId 而非 client/thread_id；(2) buildArgs 返回 `app-server --listen stdio://` 解决 "stdin is not a terminal"；(3) TaskRunner 跳过 buildInput，prompt 通过 turn/start.instructions 传递避免 -32600。
<!-- MANUAL_NOTES_END -->
