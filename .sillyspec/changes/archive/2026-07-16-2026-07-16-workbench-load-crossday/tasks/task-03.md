---
id: task-03
title: task/router.py 新增 POST /start + execute 适配 action + page 加 problem_task_id
phase: W1
priority: P0
status: draft
owner: qinyi
estimated_hours: 2
affected_components: [backend]
allowed_paths:
  - backend/app/modules/ppm/task/router.py
depends_on: [task-02]
blocks: [task-04, task-07, task-10]
goal: "task/router.py 新增 POST /start + execute 适配 action + page 加 problem_task_id"
implementation:
  - "新增 POST /api/ppm/task-plan/{id}/start（body: execute_user_id 可选）→ service.start → 201"
  - "execute_plan_task 端点适配 action（删 submit）"
  - "task-execute/page 端点 query 加 problem_task_id"
acceptance:
  - "POST /start 返回 201 + task_execute_id"
  - "/execute 接 action=submit/complete"
  - "/task-execute/page?problem_task_id 可过滤"
verify:
  - "cd backend && uv run pytest app/modules/ppm/task/tests/test_router.py"
constraints:
  - "改 router 必跑 test_router（记忆 backend-router-change-run-router-tests）"
---

## 目标
新增 `POST /api/ppm/task-plan/{id}/start`；execute 端点适配 action；/task-execute/page 加 problem_task_id query。

## 依据
design §5.1 / §7.6；D-002 / D-008。

## steps
1. 新增 `POST /task-plan/{id}/start`（body: execute_user_id 可选，默认当前用户）→ 调 TaskPlanService.start → 201 TaskExecuteResponse
2. execute_plan_task 端点（router.py:175）：ExecutePlanReq 已改 action，透传即可（删 submit 相关）
3. task-execute/page 端点（router.py:348）：query 加 `problem_task_id: uuid | None`，透传 service

## 验收标准
- POST /start 返回 201 + task_execute_id
- /execute 接 action=submit/complete
- /task-execute/page?problem_task_id 可过滤
- 改 router 必跑 test_router（记忆 backend-router-change-run-router-tests）
