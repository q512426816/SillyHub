---
id: task-07
title: agent-log-viewer 工具卡片合并折叠渲染 + SYSTEM/thinking 折叠 UI
author: qinyi
created_at: 2026-07-09 06:17:11
priority: P0
depends_on: [task-05, task-06]
blocks: [task-08]
requirement_ids: [FR-04, FR-05]
decision_ids: [D-001@v1, D-002@v2]
allowed_paths:
  - frontend/src/components/agent-log-viewer.tsx
---

## 目标

agent-log-viewer.tsx 渲染：(1) tool_call 卡片合并折叠结果区（工具徽标 + 工具名标签 + 调用参数 + 默认收起的执行结果，点击展开 mergedToolResult）；(2) SYSTEM/thinking 折叠摘要行（foldedSummary）+ 展开交互（foldedDetail）。消费 task-05 的 mergedToolResult 与 task-06 的折叠分类结构。

## 实现步骤

1. 定位 `frontend/src/components/agent-log-viewer.tsx`（tool_call 卡片渲染 + 日志行渲染）。
2. tool_call 卡片：渲染工具徽标 + 工具名标签（tool_kind 映射）+ 参数；结果区默认收起（▸执行结果），点击展开 mergedToolResult（来自 task-05 配对）。
3. 折叠 UI：SYSTEM/thinking 类渲染折叠摘要行（foldedSummary），点击展开原始内容（foldedDetail，来自 task-06）。
4. 交互态用 useState 管理展开/收起，默认收起。

## 测试

见 task-08：卡片折叠展开 + SYSTEM 折叠展开交互组件测试。

## 验收标准

- AC-04：组件测试 tool_call 卡片渲染徽标+标签+参数+折叠结果，点击展开
- AC-05：组件测试 [SYSTEM:*]/[THINKING] 折叠摘要可展开

## 依赖说明

- depends_on task-05：消费 mergedToolResult（tool_result 按 id 合并进 tool_call 卡片）。
- depends_on task-06：消费 foldedSummary/foldedDetail（SYSTEM/thinking 折叠分类结构）。
- 两者产出不到位则 UI 无数据可渲染。
