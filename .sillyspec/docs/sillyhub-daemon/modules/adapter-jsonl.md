---
schema_version: 1
doc_type: module-card
module_id: adapter-jsonl
author: qinyi
created_at: 2026-08-18 01:45:00
---

# JSONL 事件协议解析器（adapter-jsonl）

## 定位
copilot CLI 点分 JSONL 事件协议解析器（单 provider）。copilot 以 `--output-format json` 启动后 stdout 逐行 NDJSON，每行 `{"type":"dotted.event.name","data":{...},"sessionId"?}`；本 adapter 把点分 type 映射到统一 IR AgentEvent，并在实例字段维护 session 维度累积状态（output / sessionId / activeModel / finalStatus / finalError）。1:1 翻译自 Python jsonl.py（parse_output_multi + 8 个 _handle_* 子方法）。

## 契约摘要
- `JsonlAdapter implements ProtocolAdapter`：
  - `provider = 'copilot'`（硬编码单值）。
  - `buildArgs()` → `['--output-format', 'json']`：让 copilot 输出 NDJSON 事件流而非 ANSI 着色文本；缺此参数时 parse 全走 fallback 返回空数组，lease 看似完成但无内容。prompt 走默认 stdin。
  - `parse(line): AgentEvent[]` ——注意返回类型**不带 null**：空行/坏 JSON/未知 type 一律返回 `[]`（与 Python parse_output_multi 永远返回 list 的语义一致，消费端无需区分 null 与空数组）。
  - `getState()` ——只读 state 快照，供 TaskRunner 在子进程退出后读累积 output / session_id / finalStatus 拼装 TaskResult。
- 内部状态 `JsonlState`：{ output, sessionId, activeModel, finalStatus, finalError }。

## 关键逻辑
```text
parse: trim；空行 []；JSON.parse 失败 []（坏行吞掉不抛）；
  按 evtType 完整字符串 switch（不拆点分层级）：
    session.start            → 记 selectedModel/sessionId，返回 []
    assistant.message_delta  → [{type:'text', content:delta}]（累积 output）
    assistant.message        → reasoning(thinking) + 每个 toolRequests[] 一个 tool_use（唯一多事件 type）
    assistant.reasoning[_delta] → text + metadata.thinking:true
    tool.execution_complete  → tool_result（success 取 result.content，失败拼 'Error: '+msg）
    assistant.turn_start     → text + metadata.status:'running'（IR 收敛）
    session.error            → error + finalStatus='failed'；session.warning → text + level:'warn'
    result                   → 记 sessionId/exitCode（非 0 → finalStatus='failed'），返回 []
    default                  → []（未知 type 静默丢弃）
```

## 注意事项
- 有状态 adapter：每个 lease 一个新实例，状态隔离无需 reset；状态只在实例字段，不发 I/O、无 stdin 应答需求。
- `assistant.message` 的 content 有防双计逻辑：若 output 已 endsWith(content)（delta 先到），先截掉尾部再加分隔符 append（对齐 Python B-07）。
- toolRequests[].arguments 可为 string / dict：string 先 JSON.parse，失败保留 `{raw: 原值}`。
- complete 事件不在此产出——终态由 TaskRunner 据子进程 exit code 合成。
- IR 收敛：status/warning/thinking 全合入 text + metadata（metadata 字段名沿用 snake_case）。

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
