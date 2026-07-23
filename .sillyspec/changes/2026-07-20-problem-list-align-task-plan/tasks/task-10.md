---
author: qinyi
created_at: 2026-07-20 11:30:22
id: task-10
title: _problem-drawer + _forms 清理废弃 mode/表单
wave: 2
blockedBy: [task-09]
allowed_paths: [frontend/src/app/(dashboard)/ppm/problem-list/_problem-drawer.tsx, frontend/src/app/(dashboard)/ppm/problem-list/_forms.tsx]
acceptance: [FR-14, FR-15]
---

## 目标
`_problem-drawer` 仅保留 create/edit mode；`_forms` 删废弃表单（Start/Audit/Done/Close/Detail），保留 `ProblemCreateForm`（新建+编辑共用）。

## 实现步骤
1. `_problem-drawer.tsx`：mode 联合类型从 8 个收敛为 `"create"|"edit"`；删 `done/change/start/audit/close` 分支；删 detail 模式的 `listProblemLogs` 懒加载（详情已并入 ProblemDetailModal）。
2. `_forms.tsx`：删 `ProblemStartForm` / `ProblemAuditForm` / `ProblemDoneForm` / `ProblemCloseForm` / `ProblemDetailForm`（含其 `listTaskExecutes` 拉取，已并入 ProblemDetailModal）；保留 `ProblemCreateForm`（create + edit 共用，去掉 submit 触发逻辑）+ 共用 `ProblemDescriptions`。
3. 删对 `doneTaskProblem` / `nextProcessProblem` / `rejectProcessProblem` / `closeTaskProblem` / `listProblemLogs` 的 import（task-11 已删这些 API）。
4. 删 problem-change 相关表单/入口（若有）。

## 测试点
- `_problem-drawer` 仅接受 create/edit；其他 mode 类型报错。
- `_forms` 无对已删 API 的引用。

## 验收
- 无 dead code 引用已删 API/类型；lint/typecheck 绿；新建/编辑表单功能正常。
