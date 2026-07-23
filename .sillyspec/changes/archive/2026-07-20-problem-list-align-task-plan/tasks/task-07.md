---
author: qinyi
created_at: 2026-07-20 11:30:22
id: task-07
title: 后端测试 start/execute + 删审批测试
wave: 1
blockedBy: [task-03, task-04, task-05]
allowed_paths: [backend/tests/ppm/test_problem_service.py, backend/tests/ppm/test_problem_router.py]
acceptance: [FR-5, FR-7, FR-8, FR-9, FR-12]
---

## 目标
为 start/execute_problem 写单测，删/改现有 problem 审批流测试。

## 实现步骤
1. 新增 `test_problem_start_execute.py`（或并入现有 problem 测试文件）：
   - `test_start_only_from_new`：进行中/已完成态 start → 400；新建态 → 返回 TaskExecute + problem 进行中。
   - `test_execute_submit_back_to_new`：action=submit → problem 回新建，可再次 start（重复执行）。
   - `test_execute_complete_terminal`：action=complete → problem 已完成 + real_end_time；已完成态再 start → 400。
   - `test_execute_crossday_rejected`：actual_start 与 actual_end 跨天 → 422。
   - `test_inflight_exclusion`：in-flight 的 `plan_task_id` 非空 → execute 400（D-002）。
   - `test_start_creates_problem_task_execute`：TaskExecute.problem_task_id == problem.id 且 plan_task_id is None 且 status=30。
2. 删/改现有审批流测试：grep `submit_problem|next_process|reject_process|done_task|close_task|ProblemStatus.AUDITING|BACK|WAIT_CHECK` 的测试，删除或改写。
3. `test_router`（problem）：新增 start/execute 路由可达性；废弃端点 404。

## 测试点
- 上述 6 个 case 全绿；审批流旧测试已清。

## 验收
- `cd backend && uv run pytest -q app/modules/ppm/problem` 全绿（含新测试）；无对已删方法的引用。
