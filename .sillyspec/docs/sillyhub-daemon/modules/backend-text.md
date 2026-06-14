---
schema_version: 1
doc_type: module-card
module_id: backend-text
author: qinyi
created_at: 2026-06-10T16:55:00
---

# backend-text

## 定位
纯文本 stdout 协议 adapter，服务 antigravity (agy) provider。最简单的 adapter——Agent CLI 由 TaskRunner spawn，stdout 每行就是纯文本输出，无结构化事件。每行非空输出转为一个 `AgentEvent(type="text")`。

## 契约摘要
- `TextAdapter` implements `ProtocolAdapter` — provider="antigravity", binary="agy"
- `parse(line): AgentEvent[]` — 解析单行（每行非空即返回一个 text event，空行返回空数组）
- adapter 内部状态：output、finalStatus、finalError

## 关键逻辑
```
parse(line)
  text = line.trimEnd()
  if text is empty → return []
  state.output += text + "\n"
  return [AgentEvent(type="text", content=text)]
```

## 注意事项
- 本 adapter 无 tool_use/tool_result/thinking 事件，仅 text 和（异常时）error
- 无内置超时机制（由 TaskRunner 守护子进程退出）
- stdout 逐行累加时用 `\n` 分隔，最终 output 是完整文本
- binary 不存在的情况由 agent-detector 提前判定 unavailable，不会进入本 adapter
- agent-detector 中 antigravity 的 bin 名为 "agy"（非 "antigravity"）
- 依赖 backends（ProtocolAdapter 接口）

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
