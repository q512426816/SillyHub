---
schema_version: 1
doc_type: module-card
module_id: adapter-ndjson
source_commit: ba87eec
author: qinyi
created_at: 2026-06-24T01:10:50
---
# adapter-ndjson

## 定位
opencode / openclaw / pi 三 provider 共享的 NDJSON 流式协议解析器（`src/adapters/ndjson.ts`）。子进程 `run --format json --dangerously-skip-permissions <prompt>` 的 stdout 每行一个 JSON `{"type":"text"|"tool_use"|"error"|"step_start"|"step_finish","part":{...},"sessionID"?}`。三 provider 字段结构完全相同（Python _BINARY_MAP 仅区分 binary 名，解析无差异），本 adapter 不引入 provider 分支但保留 provider 字段标识。方案B：只做纯解析，执行下沉 task-runner。

## 契约摘要
- `NdjsonProvider`、`NdjsonState`（output/sessionId/finalStatus/finalError/usage{input/output/cache.read/write}）。
- `NdjsonAdapter implements ProtocolAdapter`：
  - `provider: NdjsonProvider`（构造注入）。
  - `buildArgs()` ——`['run','--format','json','--dangerously-skip-permissions']` + 可选 `--model` + prompt。
  - `resetState()` ——新 lease 复用实例时调用（对照 Python _reset_state）。
  - `parse(line): AgentEvent[] | null`。
- private handler：handleTextEvent/handleToolUseEvent/handleErrorEvent/handleStepFinish/extractToolOutput。

## 关键逻辑
```
parse: trim；空行 null；JSON.parse 失败 warn + null（不抛，B-02）；
  非 object null；提取 type/part，任意事件可携带 sessionID（后到覆盖）；
  handleEvent 按 type 分派：
    text → handleTextEvent（空 text 返回 null 避免无意义消息）
    tool_use → handleToolUseEvent（tool_use + tool_result 配对）
    error → handleErrorEvent → error 事件 + finalStatus=failed
    step_start → [{type:'text',content:'',metadata:{status:'running'}}]（IR 收敛）
    step_finish → 累积 usage，返回 null（无事件产出）
    default → null（未知 type，对照 Python 默认空数组）
```

## 注意事项
- **有状态 adapter**：跨行累积 output/usage/sessionId/finalStatus/finalError，由 task-runner 在子进程退出后通过 getter 读取拼装 TaskResult。新 lease 复用实例须先 resetState。
- IR 收敛：Python `step_start` 原 event_type="status"，Node 收敛为 text + metadata.status='running'（对齐 task-06/07/08 全局收敛，IR 无 status 类型）。
- 返回 null 的场景：空行/坏 JSON/step_finish/未知 type/空 text（B-01 统一用 null 表达 Python 返回空 list）。
- 三 provider 共享同一解析逻辑，无 provider 分支；provider 字段标识为未来协议漂移留扩展点。
- metadata 字段名沿用 snake_case（types.ts 约定，便于对照 Python 调试）。

## 人工备注
<!-- MANUAL_NOTES_START -->
<!-- MANUAL_NOTES_END -->
