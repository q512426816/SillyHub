---
id: task-04
title: daemon 单测——tool_use 不双写 + tool_result 带 id
author: qinyi
created_at: 2026-07-09 06:17:11
priority: P0
depends_on: [task-02, task-03]
blocks: []
requirement_ids: [FR-01, FR-02]
decision_ids: [D-006@v1]
allowed_paths:
  - sillyhub-daemon/src/__tests__/task-runner-event-to-messages.test.ts
---

## 目标

新增 daemon 单测，钉死 task-02/03 的行为：tool_use event 不再双写 stdout [TOOL_USE]，tool_result event 按 metadata 携带 tool_use_id。

## 实现步骤

1. 新建 `sillyhub-daemon/src/__tests__/task-runner-event-to-messages.test.ts`。
2. 直接调用 `_eventToMessages`（或等价导出入口），构造 tool_use / tool_result 事件喂入。
3. 断言三条 case（见下）。

## 测试

3 个单测 case：

1. **tool_use event → 仅 1 条 tool_call**：喂 tool_use 事件，断言产出的 messages 长度 = 1，channel === 'tool_call'，不存在 stdout `[TOOL_USE]` 文本行（AC-01）。
2. **tool_result event + metadata.call_id → message 带 tool_use_id**：喂 tool_result 事件且 metadata 含 call_id，断言对应 message 有 `tool_use_id` 字段且值匹配（AC-02）。
3. **tool_result event 无 id → 不带 tool_use_id 字段**：喂 tool_result 事件但 metadata 无 tool_use_id/id/call_id，断言 message 不含 `tool_use_id` 键（兼容降级）。

## 验收标准

- AC-01（tool_use 只 1 条 tool_call）
- AC-02（tool_result 带 tool_use_id 当有 id）
- 3 case 全绿

## 依赖说明

依赖 task-02（删 stdout [TOOL_USE]）+ task-03（tool_result 补 id）先落地，否则断言不成立。
