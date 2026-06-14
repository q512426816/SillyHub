---
schema_version: 1
doc_type: module-card
module_id: backend-ndjson
author: qinyi
created_at: 2026-06-10T16:55:00
---

# backend-ndjson

## 定位
NDJSON streaming 协议 adapter，服务 opencode / openclaw / pi 三种 provider。Agent CLI 由 TaskRunner spawn 并传入 `run --format json`，输出换行分隔的 JSON 事件，每行为 `{"type": "text|tool_use|error|step_start|step_finish", "part": {...}}`。本 adapter 只负责解析。

## 契约摘要
- `NdjsonAdapter` implements `ProtocolAdapter` — provider 运行时确定（opencode/openclaw/pi）
- `parse(line): AgentEvent[]` — 解析单行返回多事件
- adapter 内部状态：output、sessionId、finalStatus、finalError、usage（含 token 统计）
- provider 到二进制名映射常量（opencode/openclaw/pi）

## 关键逻辑
```
parse(line)
  obj = JSON.parse(line)  // { type, part }
  switch obj.type:
    text → 累加 output，emit AgentEvent(text)
    tool_use → emit AgentEvent(tool_use) [+ tool_result 当状态为 completed]
    error → finalStatus = failed，emit AgentEvent(error)
    step_start → emit AgentEvent(text, level=status)
    step_finish → 累加 token usage（inputTokens, outputTokens, cache*）
  return events
```

## 注意事项
- `--dangerously-skip-permissions` 标志由 TaskRunner 在 spawn 时传入，跳过所有权限检查
- 不在 `_BINARY_MAP` 中的 provider 由 TaskRunner 提前拒绝
- `tool_use` 事件在 `state.status === "completed"` 时同时产出 `tool_result` 事件
- token usage 在 `step_finish` 事件中累积，最终存入 `state.usage`
- adapter 内部状态在每次任务前需重置（TaskRunner 启动新任务会取新 adapter 实例）
- 依赖 backends（ProtocolAdapter 接口）

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
