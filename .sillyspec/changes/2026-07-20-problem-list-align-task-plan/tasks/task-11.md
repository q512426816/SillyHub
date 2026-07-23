---
author: qinyi
created_at: 2026-07-20 11:30:22
id: task-11
title: lib/ppm/problem.ts + types.ts 删审批 API + 新增 start/execute
wave: 2
blockedBy: [task-04, task-05]
allowed_paths: [frontend/src/lib/ppm/problem.ts, frontend/src/lib/ppm/types.ts]
acceptance: [FR-14]
---

## 目标
前端 API client 对齐后端：删审批流 API/类型，新增 `startProblem`/`executeProblem`。

## 实现步骤
1. `problem.ts` 删函数：`nextProcessProblem:108` / `submitProblem:119` / `rejectProcessProblem:130` / `doneTaskProblem:141` / `closeTaskProblem:152` / `listProblemTasks:163` / `listProblemLogs:172`。
2. `problem.ts` 新增：
   - `startProblem(problemId, body?: ProblemStartReq): Promise<TaskExecute>` → `POST /api/ppm/problem-list/{id}/start`；
   - `executeProblem(problemId, body: ProblemExecuteReq): Promise<ProblemList>` → `PUT /api/ppm/problem-list/{id}/execute`。
3. `problem.ts` **保留** problem-change 相关函数（D-005 deprecated）。
4. `types.ts` 删：`ProblemNextProcessReq` / `ProblemRejectProcessReq` / `ProblemDoneTaskReq` / `ProblemCloseTaskReq` / `ProblemProcessTask` / `ProblemProcessLog`。
5. `types.ts` 新增：`ProblemStartReq { actual_start_time?: string }` / `ProblemExecuteReq { task_execute_id: string; action: "submit"|"complete"; execute_info?: string; time_spent?: number; actual_end_time?: string }`。
6. `ProblemList.status` 注释改中文 3 态；`ProblemListCreate` 删 `submit` 字段（对齐后端 task-05）。

## 测试点
- `startProblem`/`executeProblem` 类型正确；无对已删函数的引用。

## 验收
- lint/typecheck 绿；API 路径对齐后端 task-04。
