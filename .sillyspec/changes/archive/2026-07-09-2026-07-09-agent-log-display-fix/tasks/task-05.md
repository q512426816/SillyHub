---
id: task-05
title: normalize stdout [TOOL_RESULT] 按 parent_tool_use_id 精确配对（全新逻辑）
author: qinyi
created_at: 2026-07-09 06:17:11
priority: P0
depends_on: [task-03]
blocks: [task-07, task-08]
requirement_ids: [FR-03]
decision_ids: [D-007@v1, D-001@v1]
expects_from:
  task-03:
    - contract: "AgentRunLogEntry.parent_tool_use_id"
      needs: [parent_tool_use_id]
allowed_paths:
  - frontend/src/components/agent-log/normalize.ts
---

## 目标

normalize.ts 处理 stdout `[TOOL_RESULT]` 行时，按 `current.log.parent_tool_use_id` 精确配对到 tool_call 卡片并合并（mergeToolResult + hidden），消除"一个工具三行分裂"。旧日志无 id 时退化到 lastToolSourceIdx 启发式。这是全新逻辑，非对现有 toolUseIdIndex 的"扩展"。

## 实现步骤

1. 定位 `frontend/src/components/agent-log/normalize.ts:596-612`（stdout TOOL_RESULT 分支）+ `400-413`（toolUseIdIndex 构建处）。
2. 单遍处理 stdout `[TOOL_RESULT]` 行时，读 `current.log.parent_tool_use_id`。
3. 非空 → 回查 toolUseIdIndex（命中则 mergeToolResult + hidden，将该 result 合并进对应 tool_call 卡片）。
4. 未命中 / 无 id → 退化到 lastToolSourceIdx 启发式最近邻（兼容旧日志，保留原行为）。
5. 配对 key 必须用 `current.log.parent_tool_use_id`（AgentRunLogEntry 字段），不解析 content（result 行 content 是 `[TOOL_RESULT] ...` 文本，无 id JSON）。

## 测试

见 task-08：id 命中合并 hidden / id 缺失退化 / 乱序三场景单测。

## 验收标准

- AC-03：前端单测 stdout [TOOL_RESULT] + parent_tool_use_id → 合并进卡片 hidden
- AC-03b：id 缺失场景退化到 lastToolSourceIdx（隐含在 task-08 "id 缺失退化" case）

## 依赖说明

- depends_on task-03：消费 daemon 新写入的 tool_use_id（透传到 `AgentRunLogEntry.parent_tool_use_id`）。**仅新日志精确配对依赖 task-03**；旧日志无 id 走降级路径，不影响兼容。
- 配对 key 是 `current.log.parent_tool_use_id`（backend service.py:472 透传字段），非 content 解析。
