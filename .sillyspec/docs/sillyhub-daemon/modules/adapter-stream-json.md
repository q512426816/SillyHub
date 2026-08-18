---
schema_version: 1
doc_type: module-card
module_id: adapter-stream-json
author: qinyi
created_at: 2026-08-18 01:45:00
---

# stream-json 流式适配器（adapter-stream-json）

## 定位
claude / gemini / cursor 三 provider 共用的 NDJSON stream-json 协议 adapter（1:1 翻译自 Python stream_json.py 的 parse_output 分支）。TaskRunner spawn agent CLI 时传 `--output-format stream-json`，本 adapter 逐行解析 stdout JSON 产出 AgentEvent IR。承载两个关键风险点：R-01（解析翻译偏差）与 R-03（control_request 不应答子进程会 hang）。

## 契约摘要
- `StreamJsonProvider = 'claude' | 'gemini' | 'cursor'`（构造注入）。
- `StreamJsonAdapter implements ProtocolAdapter`：
  - `parse(line): AgentEvent[] | null`：按 msg.type 分派 assistant / user / system / result / log / control_request / stream_event 七类。
  - `buildArgs(opts)`：claude/gemini 与 cursor 参数集不同（见关键逻辑）；opts 含 allowedRoots（CC 写沙箱）与 toolConfig（mode/allowed_tools/max_turns）。
  - `buildInput(prompt)`：claude/gemini 把 prompt 包成一条 user message NDJSON（JSON + \n）；cursor 返回空串（prompt 走 args 位置参数）。
  - `attachStdin(stdin)` / `resetAccumulator()` / `getSessionId()` / `getLastResultInfo()`。
- `ResultInfo`：{ sessionId, resultText, isError, modelError }——result 事件存档，TaskRunner 读取。
- `ControlResponse`：control_response 回写结构（subtype:'success' + request_id + behavior:'allow' + updatedInput）。

## 关键逻辑
```text
buildArgs:
  cursor:  -p --output-format stream-json --force --trust [--model] [--resume] <prompt 位置参数>
  claude/gemini:
    -p --output-format stream-json --input-format stream-json --verbose
    --permission-mode tc.mode||'bypassPermissions' --include-partial-messages
    [--settings buildCcSettingsJson(allowedRoots)] [--allowedTools ...] [--max-turns N]
    [--model M] [--resume sid]          # prompt 走 stdin（buildInput）

parse(line) 按 msg.type：
  assistant        → 遍历 content blocks：text / tool_use / thinking(收敛 text+metadata.thinking)
  user             → tool_result block → tool_result 事件
  system           → 累积 sessionId + text+status 事件
  result           → is_error=true ? error 事件 : complete 事件（含 stats）；
                     is_error 时调 classifyModelError 产 ModelError 存 lastResultInfo
  log              → text + metadata.level/log
  control_request  → writeControlResponse 直接回写 stdin（自动 allow），返回 []
  stream_event     → message_delta 带真实 usage → 累积 + 定期 emit usage_update
```

## 注意事项
- **onControl 是空实现**：control_request 的真实应答在 parse 内部识别该行时直接 `writeControlResponse` 写 stdin（需 msg 上下文构造 request_id / 归一化 updatedInput）；stdin 未注入时跳过回写（子进程会 hang 但 parse 不崩），stdin 保持开启直到 result 事件由 TaskRunner 关闭（R-03）。
- `--settings buildCcSettingsJson(allowedRoots)`（permission-rules 模块）：把 allowedRoots 注入 CC 写白名单 allow + 写通配 deny + 读自由的 settings JSON，仅 claude/gemini 分支（cursor 走自己的权限模型）。
- `--include-partial-messages`：开启后 stream_event 的 message_delta 才带真实 usage；不开启时 assistant 事件 message.usage 恒 {0,0}，只能等最终 result。
- cursor 刻意不加 `--stream-partial-output`：partial 会高频重发累积全文，submit_messages 拖慢执行。
- usage 累积双保险：assistant 事件逐次累加 `_accumulatedUsage`，parseResult 时与 result.usage 求和（result 优先）；resetAccumulator 在 TaskRunner 每次 attempt 前调，防跨 lease 污染。
- modelError 归类（task-03 FR-01）：result is_error=true 时组装 {agent: this.provider, isError, subtype, resultText, apiRetryError, assistantStdout} 调 classifyModelError；成功路径不调（D-008 不回归）；gemini/cursor 由 classifier 兜底 unknown。stderr 文本在 task-runner 层，adapter 拿不到。
- Python 差异：assistant 多 content block 全部产出（Python 取最后一个）；result 升级为产出 complete/error 事件（Python 只存档）。

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
