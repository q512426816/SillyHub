---
schema_version: 1
doc_type: module-card
module_id: adapter-stream-json
source_commit: ba87eec
author: qinyi
created_at: 2026-06-24T01:10:13
---
# adapter-stream-json

## 定位
NDJSON stream-json 协议 adapter（`adapters/stream-json.ts`），服务 claude / gemini / cursor 三种 provider。1:1 翻译自 Python `stream_json.py` 的 parse_output 分支逻辑。Agent CLI 由 TaskRunner spawn 并传 `--output-format stream-json`，本 adapter 只逐行解析 stdout JSON 消息产出 AgentEvent IR。承载 R-01（解析翻译偏差）+ R-03（stdin control_request 应答不挂起）。

## 契约摘要
- `StreamJsonProvider`：`'claude'|'gemini'|'cursor'` 字面量联合。
- `StreamJsonAdapter implements ProtocolAdapter`：构造器接收 provider 注入。
- 核心方法：
  - `parse(line): AgentEvent[] | null`：解析单行 JSON，可产出多个事件。
  - `buildArgs(opts?)`：构造 spawn 参数（claude/cursor 分支不同）。
  - `attachStdin(stdin)` / `resetAccumulator()` / `getSessionId()` / `getLastResultInfo()`。
- 可解析消息类型：assistant / user / system / result / log / control_request / stream_event。
- `ControlResponse`：control_response 回写结构（subtype/request_id/updatedInput）。

## 关键逻辑
```
buildArgs(opts):           # cursor 与 claude 参数集不同
  claude: --output-format stream-json --input-format stream-json --verbose
          --permission-mode tc.mode||'bypassPermissions'
          [--allowedTools ...] [--max-turns N] [--model M] [--resume sid] <prompt>
  cursor: --output-format stream-json [--model M] [--resume sid] <prompt>   # 无 input-format/permission

parse(line):
  msg = JSON.parse(line)
  switch msg.type:
    assistant → 按 content block 分派：text/tool_use/tool_result/thinking → AgentEvent[]
    system    → 更新 session_id / init 信息
    result    → 记录 final status + usage，emit complete（含 stats）
    control_request → writeControlResponse(stdin, msg)   # 应答在 parse 内直接写 stdin（R-03）
    stream_event → message_delta/content_block_delta → 累积 usage（usage_update）
  return events

onControl(line, stdin): 空实现（契约保留，真实应答在 parse 内部完成）
```

## 注意事项
- **onControl 是空实现**：control_request 的应答不通过 onControl 钩子，而在 parse 内部识别到 control_request 行时直接 `writeControlResponse` 写 stdin（构造 control_response，含 request_id + 归一化后的 updatedInput）。stdin 保持开启直到 result 事件（由 TaskRunner 关闭，R-03）。
- adapter 内部维护跨行状态（assistant 文本累积缓冲、thinking 缓冲、最近 result 的 status/usage），TaskRunner 每次新任务前调 `resetAccumulator()`（重试时也调）。
- node 版 parse 升级为返回事件数组（Python 单值），多 content block 一次性产出全部 event。
- claude 与 cursor 参数集不同：cursor 无 `--input-format`/`--permission-mode`/`--allowedTools`/`--max-turns`。
- 子进程 spawn/stdin/stderr/超时均在 TaskRunner，本层不执行子进程。
- 依赖 adapters（ProtocolAdapter 接口 + AgentEvent IR）。

## 人工备注
<!-- MANUAL_NOTES_START -->
<!-- MANUAL_NOTES_END -->
