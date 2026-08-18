---
schema_version: 1
doc_type: module-card
module_id: adapter-ndjson
author: qinyi
created_at: 2026-08-18 01:45:00
---

# NDJSON 流式协议解析器（adapter-ndjson）

## 定位
opencode / openclaw 共用的 NDJSON 流式协议解析器（pi 曾在此列、后因字段结构完全不同拆出独立 pi_json 协议）。子进程 `run --format json --dangerously-skip-permissions <prompt>` 的 stdout 每行一个 JSON `{"type":"text"|"tool_use"|"error"|"step_start"|"step_finish","part":{...},"sessionID"?}`。两 provider 字段结构完全相同（Python _BINARY_MAP 仅区分 binary 名），解析逻辑无 provider 分支，构造器校验合法值。

## 契约摘要
- `NdjsonProvider = 'opencode' | 'openclaw'`（构造注入，非法值 throw）。
- `NdjsonAdapter implements ProtocolAdapter`：
  - `buildArgs(opts)` → `['run','--format','json','--dangerously-skip-permissions']` + 可选 `--model` + **prompt 作末尾位置参数**（不走 stdin，buildInput 不会被调用）。
  - `parse(line): AgentEvent[] | null`：空行/坏 JSON/step_finish/未知 type 返回 null。
  - `resetState()`：重置累积状态（对照 Python _reset_state）。
  - 状态读取（TaskRunner 在子进程退出后调用）：`getOutput()` / `getSessionId()` / `getFinalStatus()` / `getFinalError()` / `getUsage()`。
- `NdjsonUsage`：基础 4 字段（input/output/cache_read/cache_write tokens）+ `cache_creation_tokens` 别名（= cache_write_tokens，见注意事项）。

## 关键逻辑
```text
parse: trim；空行 null；JSON.parse 失败 warn + null；非 object null；
  任意事件可携带 sessionID（后到覆盖）；handleEvent 按 type 分派：
    text        → part.text 非空 → [{type:'text'}]（累积 output）；空 text → null
    tool_use    → 必产 tool_use；part.state.status==='completed' 时同事件补 tool_result
    error       → error 事件 + finalStatus='failed'（msg 取 error.data.message > error.name > 'unknown error'）
    step_start  → [{type:'text',content:'',metadata:{status:'running'}}]（IR 收敛，无 status 类型）
    step_finish → 累加 usage（tokens.input/output + tokens.cache.read/write），返回 null
    default     → null
```

## 注意事项
- **resetState 名字与 TaskRunner 实际调用不匹配**：task-runner 重试时鸭子类型只调 `resetAccumulator`（pi-json 的注释明确记载此事实），本类的 resetState 不会被触发——跨 attempt 状态不重置。改重试语义时注意此差异（现工厂每次 lease new 新实例，正常路径无影响）。
- usage 命名双轨：内部存 opencode 原始 `cache_write_tokens`，`getUsage()` 出口额外吐 `cache_creation_tokens` 同值别名，对齐 backend agent_runs 列名 / `_METADATA_FIELDS`，任一字段名都能命中，避免 cache 统计丢失。
- tool_input 解析：state.input 为 string 时先 JSON.parse，失败保留 `{raw}`；tool_use 事件的 content 是 JSON.stringify 后的 toolInput。
- Python `step_start` 原 event_type="status"，Node 收敛为 text + metadata.status（与各 adapter 全局一致）。

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
