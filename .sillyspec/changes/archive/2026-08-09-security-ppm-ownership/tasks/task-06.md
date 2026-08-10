---
id: task-06
title: problem/router.py + task/router.py 7 端点透传 actor=user 移除 router 内 or user.id 折叠
title_zh: Router 7 端点透传 actor
priority: P0
depends_on: [task-02, task-03, task-04, task-05]
blocks: [task-07]
requirement_ids: [FR-07]
decision_ids: [D-002@v1, D-005@v1]
allowed_paths:
  - backend/app/modules/ppm/problem/router.py
  - backend/app/modules/ppm/task/router.py
created_at: 2026-08-10 00:22:00
author: qinyi
goal: >
  7 写端点把当前登录 user 作为 actor 透传进 service，移除 router 内 `or user.id` 折叠（折叠下移 service 保零漂移）。覆盖 execute_problem(problem/router.py:484) + start_plan_task/execute_plan_task/create_task_execute/update_task_execute/create_work_hour/update_work_hour(task/router.py)。
provides:
  - contract: router-actor-wired
    fields: [execute_problem, start_plan_task, execute_plan_task, create_task_execute, update_task_execute, create_work_hour, update_work_hour]
expect_from:
  - contract: task-service-actor
    from: task-02
    fields: [PlanTaskService.start.actor, PlanTaskService.execute_plan.actor]
  - contract: task-execute-service-actor
    from: task-03
    fields: [TaskExecuteService.create.actor, TaskExecuteService.update.actor]
  - contract: workhour-service-actor
    from: task-04
    fields: [WorkHourService.create.actor, WorkHourService.update.actor]
  - contract: problem-service-actor
    from: task-05
    fields: [ProblemService.execute_problem.actor]
related_tests: []
implementation:
  - problem/router.py:484 execute_problem：删 `execute_user_id=body.execute_user_id or user.id`，改传 `execute_user_id=body.execute_user_id`（原始 None 可）+ `actor=user`
  - task/router.py start_plan_task：`svc.start(body.plan_task_id, body.execute_user_id, body.actual_start_time, actor=user)`
  - task/router.py execute_plan_task：`svc.execute_plan(body, user.id, actor=user)`
  - task/router.py create_task_execute：`svc.create(body, actor=user)`
  - task/router.py update_task_execute：`svc.update(execute_id, body, actor=user)`
  - task/router.py create_work_hour：`svc.create(body, actor=user)`
  - task/router.py update_work_hour：`svc.update(work_hour_id, body, actor=user)`
acceptance:
  - 7 端点均透传 actor=user，无 `or user.id` 残留在 router
  - AC-1/AC-2/AC-3/AC-4 经 router→service 链路生效（端点级测试在 task-07）
verify:
  - cd backend && uv run pytest app/modules/ppm/task/tests/test_router.py -q --no-cov（admin 路径回归网，预期零改动全绿）
constraints:
  - 不改端点签名/返回类型/OpenAPI
  - 不动 start_problem（router:478 硬编码 user.id，非冒名面）
  - 折叠逻辑（omit→登录用户 id）下移到 service（task-02 start 用 actor.id / task-05 execute_problem 用 else actor.id），不在 router 留折叠
---
