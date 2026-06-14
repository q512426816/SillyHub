---
schema_version: 1
doc_type: module-card
module_id: backend-json-rpc
author: qinyi
created_at: 2026-06-10T16:55:00
---

# backend-json-rpc

## 定位
JSON-RPC 2.0 over stdio 协议 adapter，服务 codex / hermes / kimi / kiro 四种 provider。Agent CLI 由 TaskRunner spawn，本 adapter 只负责按 codex app-server 协议流程解析双向 JSON-RPC 消息：initialize → initialized → thread/start → turn/start → stream items → turn/completed。底层消息收发（request/notify/respond）由 TaskRunner 通过 stdin/stdout 调度，本 adapter 提供解析与自动应答决策。

## 契约摘要
- `JsonRpcAdapter` implements `ProtocolAdapter` — provider 运行时确定（codex/hermes/kimi/kiro）
- `parse(line): AgentEvent[]` — 解析 stdout 单行 JSON-RPC 消息
- 自动应答决策：commandExecution、fileChange、mcpServer/elicitation 等 approval 请求（返回 `decision: "accept"`）
- 解析的请求方法：initialize / thread/start / turn/start / notifications/initialized / turn/completed / events.*

## 关键逻辑
```
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
- Node 版只做解析和应答决策；JSON-RPC 传输（request/notify/respond、early_responses 竞态处理）下沉到 TaskRunner
- 自动审批所有 commandExecution 和 fileChange 请求（`decision: "accept"`）
- 各 provider 的启动参数差异（codex 需 `app-server --listen stdio://`）由 TaskRunner 调度
- adapter 内部跨行维护 session_id、final_status、final_error 状态，每次任务前需重置
- 握手与不活跃超时由 TaskRunner 守护
- 依赖 backends（ProtocolAdapter 接口）

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
