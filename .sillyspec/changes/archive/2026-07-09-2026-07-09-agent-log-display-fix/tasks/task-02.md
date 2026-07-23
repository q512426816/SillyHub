---
id: task-02
title: task-runner _eventToMessages tool_use 删 stdout [TOOL_USE] 文本行
author: qinyi
created_at: 2026-07-09 06:17:11
priority: P0
depends_on: []
blocks: [task-04]
requirement_ids: [FR-01]
decision_ids: [D-006@v1]
allowed_paths:
  - sillyhub-daemon/src/task-runner.ts
---

## 目标

删除 `_eventToMessages` tool_use 分支对 stdout `[TOOL_USE] ${name}: ${argsLine}` 的 push，消除"一次工具调用被记三遍"中的第①行；只保留结构化 tool_call JSON（已带 tool_kind + tool_use_id）。

## 实现步骤

1. 定位 task-runner.ts:1843-1848 tool_use 分支中 stdout `[TOOL_USE]` 的 `messages.push`（含 1849-1850 的 C-02 决策注释），整段删除。
2. 保留 1862+ 的 tool_call JSON push（结构化行不动）。
3. 更新 task-runner.ts:1700 附近注释（tool_use → 由"2 条"改为"1 条"）。
4. 确认不动 `renderAgentEvent`（task-runner.ts:2590-2651 terminal 回显独立路径，CC-05 已确认）。

## 测试

由 task-04 单测覆盖（tool_use event → 只产 1 条 tool_call，无 stdout [TOOL_USE]）。

## 验收标准

- AC-01（`_eventToMessages(tool_use)` 只产 1 条 tool_call，无 stdout [TOOL_USE]）

## 依赖说明

无前置依赖（Wave 1 内可并行）。阻塞 task-04 单测。
