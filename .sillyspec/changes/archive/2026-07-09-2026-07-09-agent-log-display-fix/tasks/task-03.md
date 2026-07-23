---
id: task-03
title: task-runner _eventToMessages tool_result 补 tool_use_id
author: qinyi
created_at: 2026-07-09 06:17:11
priority: P0
depends_on: []
blocks: [task-04, task-05]
requirement_ids: [FR-02]
decision_ids: [D-006@v1]
provides:
  fields: [tool_use_id]
allowed_paths:
  - sillyhub-daemon/src/task-runner.ts
---

## 目标

在 `_eventToMessages` tool_result 分支补 `tool_use_id` 字段（从 ev.metadata 取，与 tool_use 分支同源解析），为前端 task-05 按 parent_tool_use_id 精确配对提供依据。

## 实现步骤

1. 复用 tool_use 分支的 `toolUseId` 解析逻辑（task-runner.ts:1825-1829，从 `ev.metadata.tool_use_id / id / call_id` 取）。
2. 在 tool_result case（task-runner.ts ~1890）的 message 上加 `...(toolUseId ? { tool_use_id: toolUseId } : {})`。
3. 保持 content / channel / preview 等其余字段不变。

## 测试

由 task-04 单测覆盖（tool_result event + metadata.call_id → message 带 tool_use_id；无 id → 不带字段）。

## 验收标准

- AC-02（`_eventToMessages(tool_result)` 带 tool_use_id，当 metadata 有 id 时）

## 依赖说明

无前置依赖（Wave 1 内可并行）。provides `tool_use_id` 字段供 task-05（前端 normalize 按 parent_tool_use_id 配对）消费；阻塞 task-04 单测。
