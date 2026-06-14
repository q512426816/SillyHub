---
schema_version: 1
doc_type: module-card
module_id: types
author: qinyi
created_at: 2026-06-14T10:40:45+08:00
---

# types

## 定位
统一中间表示（Intermediate Representation, IR）层。定义 daemon 内部跨模块共享的类型——AgentEvent / TaskResult / DaemonMessage / LeasePayload 等。是 Python 版散落在 backends.py 内的 `AgentEvent`/`TaskResult` 的归并升级：Node 版独立成 `types.ts`，被 adapters / task-runner / daemon / hub-client 共同引用，避免重复定义。

## 契约摘要
- `AgentEventType` — 事件类型字面量联合：`"text" | "tool_use" | "tool_result" | "error" | "complete"`
- `AgentEvent` — adapter 解析产出的标准事件
  - `type: AgentEventType`
  - `content?: string` — 文本内容（text/error）
  - `toolName?: string` — 工具名（tool_use/tool_result）
  - `callId?: string` — 工具调用 ID
  - `toolInput?: unknown` — 工具入参（tool_use）
  - `toolOutput?: unknown` — 工具出参（tool_result）
  - `level?: "info" | "warning" | "error" | "thinking" | "status"` — 事件级别
  - `sessionId?: string`
- `TaskState` — 任务状态字面量联合（与 lease 状态对齐）
- `BackendTaskResult` — adapter 层产出的执行结果（含 events 数组）
- `TaskResult` — daemon 对外提交的执行结果（含 patch/filesChanged 等字段）
- `DaemonMessage` — submitMessages 提交到 server 的单条消息体（过滤空字段后的 AgentEvent 投影）
- `LeasePayload` — lease 相关消息载荷类型（task_available 推送 + lease claim/start/complete 参数）

## 关键逻辑
```
// 纯类型定义模块，编译后不产生运行时逻辑
// AgentEvent.type 值域：
//   text       - 普通文本输出 / thinking / status（通过 level 区分）
//   tool_use   - 工具调用开始
//   tool_result - 工具调用结果
//   error      - 错误输出
//   complete   - 任务结束标记（携带 final status / usage）
```

## 注意事项
- 修改 AgentEvent 字段需同时检查：5 个 adapter、task-runner（eventToMessage）、daemon
- `AgentEvent.type` 值域比 Python 版收敛：thinking/status 不再是独立 type，而是 text + level
- 本模块只导出类型与必要的常量（如枚举字符串集合），不放可执行函数
- 被 backends、task-runner、daemon、client 引用（IR 层）
- 修改对外类型形状需评估是否破坏 G-02 对外契约（DaemonMessage/LeasePayload 影响通信）

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
