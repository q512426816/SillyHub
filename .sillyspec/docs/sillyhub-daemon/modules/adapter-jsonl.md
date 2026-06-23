---
schema_version: 1
doc_type: module-card
module_id: adapter-jsonl
source_commit: ba87eec
author: qinyi
created_at: 2026-06-24T01:10:50
---
# adapter-jsonl

## 定位
copilot CLI 点分 JSONL 事件协议解析器（`src/adapters/jsonl.ts`）。copilot 启动 `--output-format json` 后 stdout 逐行 NDJSON，每行 `{"type":"dotted.event.name","data":{...},"sessionId"?}`。把点分 type 映射到统一 IR AgentEvent，并在实例字段维护 session 维度累积状态（output/sessionId/finalStatus/finalError）。1:1 翻译自 Python jsonl.py。方案B：只做纯解析，执行下沉 task-runner。

## 契约摘要
- `JsonlState`（output/sessionId/activeModel/finalStatus/finalError）。
- `JsonlAdapter implements ProtocolAdapter`：
  - `provider = 'copilot'`。
  - `buildArgs()` ——copilot 启动参数。
  - `parse(line): AgentEvent[]` ——一行可产 0..N 事件（assistant.message 是唯一多 event 的 type）。
  - 只读 state 快照供 task-runner 读累积 output/session_id。
- 8 个 private handler 对应 Python `_handle_*` 方法。

## 关键逻辑
```
parse: trim；空行返回 []；JSON.parse 失败返回 []（不抛）；
  按 evtType 完整字符串 switch（不拆点分层级，B-04）：
    session.start → handleSessionStart（记 model/sessionId）返回 []
    assistant.message_delta → [{type:'text', content:delta}]
    assistant.message → reasoning(thinking) + 多个 tool_use（唯一多事件 type）
    assistant.reasoning[_delta] → text + metadata.thinking:true
    tool.execution_complete → tool_result（含 tool_name/call_id/input/output）
    assistant.turn_start → text + metadata.status:'running'
    session.error → error；session.warning → text + metadata.level:'warn'
    result → 记 finalStatus 返回 []
    default → []（未知 type 静默丢弃，B-01）
```

## 注意事项
- **有状态 adapter**（B-03 允许）：每个 lease 一个新实例，状态隔离，无需 reset。状态只在实例字段，不改全局。
- IR 收敛：status/warning/thinking 全合入 text + metadata（对齐 task-06 parseSystem/parseLog 收敛方式）；metadata 字段名沿用 snake_case。
- `assistant.message` 一行可产 reasoning + 多个 tool_use 多事件，其余 type 多为 0 或 1 事件。
- 坏行不抛异常返回 []（B-02/B-04），TaskRunner 另包 try-catch 兜底。
- complete 事件不在此 adapter 产出——终态由 task-runner 据子进程 exit code 合成。
- state 快照（output/sessionId）由 task-runner 在子进程退出后读取拼装最终 TaskResult。

## 人工备注
<!-- MANUAL_NOTES_START -->
<!-- MANUAL_NOTES_END -->
