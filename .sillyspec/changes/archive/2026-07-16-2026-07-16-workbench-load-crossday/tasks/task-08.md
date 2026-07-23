---
id: task-08
title: problem/service.py done_task 额外创建 TaskExecute（actual 单点 now）
phase: W3
priority: P0
status: draft
owner: qinyi
estimated_hours: 2
affected_components: [backend]
allowed_paths:
  - backend/app/modules/ppm/problem/service.py
depends_on: []
blocks: [task-09, task-10]
goal: "problem/service.py done_task 额外创建 TaskExecute（actual 单点 now）"
implementation:
  - "done_task 同事务创建 TaskExecute(problem_task_id, execute_user_id, actual_start=now, actual_end=now, time_spent, execute_info=handle_info, status=90)"
  - "保留 handle_info 追加 + time_spent 累加 + 状态推进 + _replace_list_task + _write_list_log"
acceptance:
  - "done_task(completed=true/false) 后 DB 有 TaskExecute(problem_task_id 匹配 + actual 单点 + time_spent + execute_info)"
  - "handle_info 追加 + 状态推进不破坏"
verify:
  - "cd backend && uv run pytest app/modules/ppm/problem -q"
constraints:
  - "actual 单点 now（D-007），不取不存在的 real_start_time（P0-1）"
---

## 目标
done_task 在现有「追加 handle_info + 累加 time_spent + 状态推进」基础上，额外创建一条 TaskExecute（problem_task_id 关联，actual 单点 now）。

## 依据
design §5.3 / §7.5；D-007（problem 创建 TaskExecute，actual 单点 now）；P0-1 修正（PpmProblemList 无 real_start_time，不取，用单点 now）。

## steps
1. done_task（service.py:580）在 commit 前，同事务创建 TaskExecute：`problem_task_id=problem.id, execute_user_id=actor_id, actual_start_time=now, actual_end_time=now, time_spent=time_spent, execute_info=handle_info, status=STATUS_END(90)`
2. 保留现有 handle_info 追加（service.py:621-627）+ time_spent 累加（628-631）+ 状态推进（598-614）+ _replace_list_task + _write_list_log 不变
3. actual 单点（start=end=now）→ 跨天校验天然不触发（同日）

## 验收标准
- done_task（completed=true/false）后 DB 有对应 TaskExecute（problem_task_id 匹配 + actual 单点 + time_spent + execute_info）
- handle_info 追加 + 状态推进不破坏
