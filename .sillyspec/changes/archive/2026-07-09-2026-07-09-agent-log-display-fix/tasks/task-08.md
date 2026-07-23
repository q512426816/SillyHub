---
id: task-08
title: normalize/viewer 单测——id 配对三场景 + 折叠展开 + [TOOL_USE] 降级
author: qinyi
created_at: 2026-07-09 06:17:11
priority: P0
depends_on: [task-05, task-06, task-07]
blocks: []
requirement_ids: [FR-03, FR-04, FR-05, FR-10]
decision_ids: [D-007@v1, D-001@v1, D-002@v2, D-006@v1]
allowed_paths:
  - frontend/src/components/agent-log/__tests__/normalize.test.ts
  - frontend/src/components/agent-log-viewer.test.tsx
---

## 目标

为 task-05/06/07 的前端改造补单测/组件测试，覆盖 id 配对三场景、折叠展开、[TOOL_USE] 降级分类。守住"不回归"。

## 实现步骤

1. 新增 `frontend/src/components/agent-log/__tests__/normalize.test.ts`（normalize 纯逻辑测试）。
2. 新增/扩展 `frontend/src/components/agent-log-viewer.test.tsx`（组件渲染 + 交互测试）。
3. case 覆盖（见"测试"段）。
4. 跑 `pnpm --filter frontend test`，确认全绿。

## 测试

normalize 单测（task-05 / task-06）：
1. id 命中：stdout [TOOL_RESULT] + parent_tool_use_id → 合并进 tool_call 卡片 hidden（AC-03）
2. id 缺失：parent_tool_use_id 为空 → 退化 lastToolSourceIdx 启发式（AC-03b）
3. 乱序：tool_result 行出现在 tool_call 之前 → 仍能按 id 配对合并
4. [TOOL_USE] 降级：classifyLog stdout [TOOL_USE] → tool_call 分类（AC-10）

viewer 组件测试（task-07）：
5. 折叠展开：[SYSTEM:*]/[THINKING] 渲染折叠摘要行，点击展开原始内容（AC-05）
6. 卡片折叠：tool_call 卡片渲染徽标+标签+参数+折叠结果，点击展开 mergedToolResult（AC-04）

## 验收标准

- AC-03：id 命中合并 hidden（case 1）
- AC-04：卡片折叠展开（case 6）
- AC-05：SYSTEM 折叠展开（case 5）
- AC-10：[TOOL_USE] 降级归 tool_call（case 4）
- 6 case 全绿（plan.md task-08 验收"5 case 全绿"，本卡列 6 含乱序细化）

## 依赖说明

- depends_on task-05/06/07：被测代码必须先落地。
- 注意 MarkdownText jsdom 渲染 null 坑（vi.mock 成纯文本渲染，测父组件逻辑而非 markdown 库）。
