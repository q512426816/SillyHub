---
schema_version: 1
doc_type: module-card
module_id: adapter-pi-json
author: qinyi
created_at: 2026-08-18 01:45:00
---

# Pi JSON 事件流解析器（adapter-pi-json）

## 定位
Pi CLI 的 JSON 事件流协议解析器（单 provider pi）。独立成协议的根因：Pi 无 `run` 子命令、用 `--mode json`（非 `--format json`）、无 `--dangerously-skip-permissions`；事件字段结构与 opencode 完全不同——流式文本走 `message_update.assistantMessageEvent.delta`、工具走 start/end 两段式、usage 在 `turn_end.message.usage`、session id 在 `session.id`。

## 契约摘要
- `PiJsonProvider = 'pi'`（构造注入，非法值 throw）。
- `PiJsonAdapter implements ProtocolAdapter`：
  - `buildArgs(opts)` → `['--mode','json']` + 可选 model + `['-p', prompt]`（prompt 位置参数，不走 stdin）。model 约定：形如 `"zai/glm-5.2"` 拆成 `--provider zai --model glm-5.2`，无斜杠整体作 `--model`（TaskRunner 不透传 LLM provider 字段，靠此约定让 --provider 可用且零接口改动）。
  - `parse(line)`：空行/坏 JSON/非对象/纯生命周期事件 → null。
  - `resetAccumulator()`：重置累积状态——方法名刻意对齐 task-runner 的实际调用（ndjson 的 resetState 因名字不匹配在重试时不会被调用，此处修正）。
  - 状态读取：`getOutput()` / `getSessionId()` / `getFinalStatus()` / `getFinalError()` / `getUsage(): PiJsonUsage`。
- `PiJsonUsage`：基础 4 字段 + `cache_creation_tokens` 别名（= cache_write_tokens）。

## 关键逻辑
```text
parse 按 evtType 分派：
  session             → 记 sessionId，null
  message_update      → assistantMessageEvent.type==='text_delta' → text 事件（累积 output）；其余 null
  tool_execution_start→ tool_use（args 恒对象，整体进 tool_input）
  tool_execution_end  → tool_result（isError 只写 metadata.is_error，不改终态）
  turn_end            → 累积 usage（input/output/cacheRead/cacheWrite）且 emit usage_update 事件
                        （text + metadata.status='usage_update' + metadata.usage 累计 snapshot）
  error               → error 事件 + finalStatus='failed'
  agent_start/end、turn_start、message_start/end → null（纯生命周期）
  default             → ignoredCount++ + warn（不 crash，可观测）
```

## 注意事项
- 终态约定：finalStatus 默认 completed，仅 error 事件置 failed；工具执行错误（tool_execution_end.isError）不改终态，仅 metadata.is_error 保留信息。
- text_end 不重复产出完整文本——text_delta 已逐字累积 output，再 append 会双计。
- turn_end 无 usage 时返回 null，避免产出空 token 噪声事件；usage_update 事件格式对齐 stream-json 的 `_buildUsageUpdateEvent()`，让 task-runner `_eventToMessages` 透传 backend 写库（否则 pi 的 agent_runs.input_tokens 永远为空）。
- 工具结果文本提取：`result.content[].text` 拼接 > string 原值 > JSON.stringify 兜底。

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
