---
author: qinyi
created_at: 2026-07-20 11:30:22
id: task-03
title: service 删审批旧方法 + 新增 start/execute_problem
wave: 1
blockedBy: [task-01, task-02]
allowed_paths: [backend/app/modules/ppm/problem/service.py]
acceptance: [FR-5, FR-7, FR-8, FR-9, FR-16]
---

## 目标
删审批/验证/驳回落 service 方法，新增 `start` + `execute_problem` 两段式（仿 `task/service.py:248 start` / `:292 execute_plan`），`create_problem` 去 submit 触发链。

## 实现步骤
1. 删方法：`submit_problem:445` / `next_process:519` / `reject_process:638` / `done_task:701` / `close_task:803` / `list_list_tasks` / `list_list_logs`。
2. **先改 `create_problem:286`**：去掉 `submit` 参数分支与对 `next_process` 的调用（G5 链式顺序，next_process 将被删）；新建统一 `status="新建"`，不再分配 `now_handle_user`。
3. 新增 `start(problem_id, execute_user_id=None, actual_start_time=None) -> TaskExecute`（仿 task service:248-290）：
   - 校验 `problem.status == "新建"` 否则 400；
   - 建 `TaskExecute(problem_task_id=problem.id, plan_task_id=None, status=STATUS_DOING="30", actual_start_time=actual_start_time or now, execute_user_id=execute_user_id or 当前用户)`；
   - `problem.status = "进行中"`；commit；返回 `TaskExecute`。
4. 新增 `execute_problem(req, current_user_id) -> TaskExecute`（仿 task service:292-380）：
   - 取 in-flight `TaskExecute`（`req.task_execute_id`），校验 `exc.problem_task_id == problem.id and exc.plan_task_id is None and exc.status == "30"`（D-002 互斥）；
   - 回填 `actual_end_time`（req 或 now）；**跨天校验** `actual_start_time.date() != actual_end_time.date()` → 422；
   - `exc.status = STATUS_END="90"`；
   - `action="complete"` → `problem.status="已完成"` + `real_end_time`；`action="submit"` → `problem.status="新建"`（可再 start）；commit；返回 exc。
5. `list_problems:216` 删 `_effective_status=7` 覆盖代码（`object.__setattr__(..., "_effective_status", "7")`）。

## 测试点
- `start` 仅新建态可调（进行中/已完成 → 400）；返回 TaskExecute.id；problem 变进行中。
- `execute_problem` submit 回新建（可再 start）；complete 进已完成；跨天 → 422；in-flight plan_task_id 非空 → 400。
- `create_problem` 不再调 next_process，status=新建。

## 验收
- service 无 `next_process/submit_problem/reject_process/done_task/close_task` 定义与引用；start/execute_problem 行为对齐 task；ruff/mypy 绿。
