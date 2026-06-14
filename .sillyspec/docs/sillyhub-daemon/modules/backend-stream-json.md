---
schema_version: 1
doc_type: module-card
module_id: backend-stream-json
author: qinyi
created_at: 2026-06-10T16:55:00
---

# backend-stream-json

## 定位
NDJSON stream-json 协议 adapter，服务 claude / gemini / cursor 三种 provider。Agent CLI 由 TaskRunner spawn 并传入 `--output-format stream-json`，本 adapter 只负责逐行解析 stdout JSON 消息（不再自己 spawn）。支持 control_request 自动应答（通过 onControl 钩子由 TaskRunner 写 stdin）。

## 契约摘要
- `StreamJsonAdapter` implements `ProtocolAdapter` — provider 运行时确定（claude/gemini/cursor）
- `provider` — getter 返回当前 provider 名
- `parse(line): AgentEvent[]` — 解析单行 JSON，可能产出多个事件
- `onControl(message)` — 接收 control_request 的应答钩子
- 可解析的消息类型：assistant / user / system / result / control_request

## 关键逻辑
```
parse(line)
  obj = JSON.parse(line)
  switch obj.type:
    assistant → 按 content block 类型分派：
      text → AgentEvent(text)
      tool_use → AgentEvent(tool_use)
      tool_result → AgentEvent(tool_result)
      thinking → AgentEvent(text, level=thinking)
    system → state 更新（session_id / init 信息）
    result → 记录 final status / usage，emit complete
    control_request → onControl 钩子（由 TaskRunner 写 stdin 应答）
  return events
```

## 注意事项
- Node 版只做解析，子进程 spawn 与 stdin/stderr 处理在 TaskRunner
- control_request 的自动应答通过 onControl 回调上抛，由 TaskRunner 写 stdin（解耦）
- adapter 内部维护跨行状态（如最近一次 result 的 status/usage 元数据），每次 TaskRunner 启动新任务前需 `reset()`
- 解析逻辑区分 assistant content block 类型：text / tool_use / tool_result / thinking
- 依赖 backends（ProtocolAdapter 接口 + AgentEvent IR）

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
