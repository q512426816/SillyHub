---
author: qinyi
created_at: 2026-07-20 11:30:22
id: task-13
title: 前端测试 problem-detail-modal + page 操作列
wave: 2
blockedBy: [task-08, task-09]
allowed_paths: [frontend/src/app/(dashboard)/ppm/_components/__tests__/problem-detail-modal.test.tsx, frontend/src/app/(dashboard)/ppm/problem-list/__tests__/page.test.tsx]
acceptance: [FR-10, FR-11, FR-3]
---

## 目标
为 `problem-detail-modal` 与 problem-list 操作列写组件测试。

## 实现步骤
1. `problem-detail-modal.test.tsx`：
   - detail 模式渲染信息卡 + 处置记录表，无填报区；
   - execute 模式 + 进行中 + mock `listTaskExecutes` 返回 in-flight → 显示跨天填报区；
   - mock `startProblem`/`executeProblem`，点「完成」→ 调 executeProblem(action=complete)；点「提交」→ executeProblem(action=submit)。
   - 注意：若用到 markdown 渲染按 MEMORY `frontend-markdown-text-jsdom-null` mock；`vi.mock` API 模块。
2. `page.test.tsx`（problem-list）：操作列三态按钮渲染（新建态有开始无执行；进行中有执行；已完成无开始/执行）；权限（非本人非管理员无开始/执行/删除）；点开始 → startProblem → 刷新。
3. 改现有依赖废弃 API（submitProblem/doneTaskProblem）的测试为 start/execute。

## 测试点
- 弹窗双模式 + 跨天 + 提交/完成 mock 调用正确；
- 操作列三态 + 权限。

## 验收
- `cd frontend && pnpm test`（problem 相关）全绿。
