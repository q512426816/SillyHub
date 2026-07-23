---
id: task-04
title: task 测试（重写 execute_plan submit→action + 新建 test_router.py）
phase: W1
priority: P0
status: draft
owner: qinyi
estimated_hours: 3
affected_components: [backend]
allowed_paths:
  - backend/app/modules/ppm/task/tests/test_task.py
  - backend/app/modules/ppm/task/tests/test_router.py
depends_on: [task-03]
blocks: []
goal: "task 测试：重写 execute_plan submit→action + 新建 test_router.py"
implementation:
  - "test_task.py 现有 submit=True/False 用例改 action=complete/submit；加 start/多次填报1:N/强制回填/跨天TaskError"
  - "新建 test_router.py：POST /start、/execute action、跨天 422、problem_task_id 过滤"
acceptance:
  - "cd backend && uv run pytest app/modules/ppm/task -q 全绿"
  - "test_router.py 覆盖 HTTP 层契约（非仅 service）"
verify:
  - "cd backend && uv run pytest app/modules/ppm/task -q"
constraints:
  - "不破坏现有 execute_plan 用例（重写非删除语义）"
---

## 目标
重写 execute_plan 用例（submit bool → action）；新建 test_router.py 覆盖 start/action/跨天/problem_task_id。

## 依据
design §5.1；D-003（submit→action）；记忆 backend-router-change-run-router-tests（改 router 必跑 router 测）。

## steps
1. test_task.py：现有 `test_execute_plan_creates_execute_and_advances_status`（test_task.py:185）等用 `submit=True/False` 的用例改 `action="complete"/"submit"`；加 start 单测、多次填报 1:N（start→submit→start→complete 产生 2 条 TaskExecute）、强制回填 actual_end、跨天 TaskError
2. 新建 test_router.py：POST /start（201 + 返回 task_execute_id）、/execute action=submit（plan→未开始）/ complete（plan→已完成）、跨天 422、/task-execute/page?problem_task_id 过滤

## 验收标准
- `cd backend && uv run pytest app/modules/ppm/task -q` 全绿
- test_router.py 覆盖 HTTP 层契约（非仅 service）
