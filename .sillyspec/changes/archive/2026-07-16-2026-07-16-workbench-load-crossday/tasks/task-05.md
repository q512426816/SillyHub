---
id: task-05
title: ExecuteTaskDialog 双按钮（提交/完成）+ 跨天拆分 UI + 循环单条提交
phase: W2
priority: P0
status: draft
owner: qinyi
estimated_hours: 4
affected_components: [frontend]
allowed_paths:
  - frontend/src/app/(dashboard)/ppm/_components/execute-task-dialog.tsx
depends_on: [task-07]
blocks: [task-06]
goal: "ExecuteTaskDialog 双按钮（提交/完成）+ 跨天拆分 UI + 循环单条提交"
implementation:
  - "移除 submit checkbox；加提交/完成双按钮（onConfirm 带 action）"
  - "跨天检测：in-flight actual_start 与 now 不同天 → 多行（每天日期+耗时+说明输入，留空单独填）"
  - "循环单条调 startTask→executeTask；失败提示成功N/失败M 不回滚（R-03）"
acceptance:
  - "vitest：双按钮渲染、跨天拆分行数=跨天数、提交循环调用"
  - "单日（不跨天）走单条"
verify:
  - "cd frontend && pnpm test execute-task-dialog"
constraints:
  - "循环单条（D-006），不做批量端点（YAGNI）"
---

## 目标
执行弹窗改双按钮（提交/完成）；跨天检测拆分多行（每天单独填）；循环单条提交。

## 依据
design §5.2；D-006（跨天前端拆分每天单独填 + 循环单条）；R-03（失败不回滚）。

## steps
1. 移除 submit checkbox；加「提交」「完成」双按钮（onConfirm 带 action）
2. 跨天检测：若 in-flight actual_start_time（start 返回）与 now 不同天 → 渲染多行（每天：日期标签 + 耗时 input + 说明 input，留空让用户单独填）
3. 提交：循环单条调 startTask→executeTask（每条构造单日 actual）；失败提示「成功 N/失败 M」不自动回滚（R-03）

## 验收标准
- vitest：双按钮渲染、跨天拆分行数=跨天数、提交循环调用 API
- 单日（不跨天）走单条
