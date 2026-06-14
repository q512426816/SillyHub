---
schema_version: 1
doc_type: module-card
module_id: backend-jsonl
author: qinyi
created_at: 2026-06-10T16:55:00
---

# backend-jsonl

## 定位
Copilot JSONL 点分事件协议 adapter。copilot CLI 由 TaskRunner spawn 并传入 `--output-format json`，输出换行分隔的 JSON 事件流，每行为 `{"type": "dotted.event.name", "data": {...}}`。本 adapter 只负责解析。

## 契约摘要
- `JsonlAdapter` implements `ProtocolAdapter` — provider="copilot"
- `parse(line): AgentEvent[]` — 解析单行返回多事件
- adapter 内部状态：output（累加）、sessionId、activeModel、finalStatus、finalError、usage

## 关键逻辑
```
parse(line)
  obj = JSON.parse(line)  // { type, data }
  switch obj.type:
    session.start → 记录 sessionId, activeModel
    assistant.message_delta → 累加 delta content，emit text
    assistant.message → 重置 output（去重 delta），提取 reasoning + toolRequests
    assistant.reasoning / reasoning_delta → text(thinking)
    tool.execution_complete → tool_result
    result → 设置 finalStatus
  return events
```

## 注意事项
- `assistant.message` 会重置 output 避免与 message_delta 重复计数（参考 copilot.go 逻辑）
- `--allow-all` 和 `--no-ask-user` 标志由 TaskRunner 在 spawn 时传入，意味着自动跳过所有权限确认
- adapter 内部状态在每次任务前需重置（TaskRunner 启动新任务会取新 adapter 实例）
- 事件类型使用点分命名（如 `session.start`, `assistant.message_delta`）
- 依赖 backends（ProtocolAdapter 接口）

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
