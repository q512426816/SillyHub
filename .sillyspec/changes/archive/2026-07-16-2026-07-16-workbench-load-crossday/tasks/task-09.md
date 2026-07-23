---
id: task-09
title: problem 测试（done_task 创建 TaskExecute 断言 + router）
phase: W3
priority: P0
status: draft
owner: qinyi
estimated_hours: 2
affected_components: [backend]
allowed_paths:
  - backend/app/modules/ppm/problem/tests/test_problem_flow.py
  - backend/app/modules/ppm/problem/tests/test_router.py
depends_on: [task-08]
blocks: []
goal: "problem 测试：done_task 创建 TaskExecute 断言 + router"
implementation:
  - "test_problem_flow.py：done_task(completed=true/false) 后断言 TaskExecute 创建"
  - "problem/tests/test_router.py：POST /done 落库 TaskExecute"
acceptance:
  - "cd backend && uv run pytest app/modules/ppm/problem -q 全绿"
  - "现有 done_task 用例（handle_info/time_spent）不破坏"
verify:
  - "cd backend && uv run pytest app/modules/ppm/problem -q"
constraints:
  - "断言 TaskExchange 字段（problem_task_id/actual单点/time_spent/execute_info）"
---

## 目标
test_problem_flow.py 加 done_task 创建 TaskExecute 断言；补 problem test_router。

## 依据
design §5.3；D-007。

## steps
1. test_problem_flow.py：done_task（completed=true/false，test_problem_flow.py:185/361）后断言 TaskExecute 创建（problem_task_id + actual 单点 now + time_spent + execute_info=handle_info）
2. problem/tests/test_router.py（若不存在则新建）：POST /problem-list/{id}/done 落库 TaskExecute 断言

## 验收标准
- `cd backend && uv run pytest app/modules/ppm/problem -q` 全绿
- 现有 done_task 用例（handle_info/time_spent）不破坏
