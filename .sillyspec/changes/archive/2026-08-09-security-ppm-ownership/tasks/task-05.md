---
id: task-05
title: problem/service.py execute_problem 加 required *, actor + else actor.id 零漂移
title_zh: Problem execute_problem 注入 actor
priority: P0
depends_on: [task-01]
blocks: [task-06, task-09]
requirement_ids: [FR-03]
decision_ids: [D-002@v1]
allowed_paths:
  - backend/app/modules/ppm/problem/service.py
created_at: 2026-08-10 00:22:00
author: qinyi
goal: >
  ProblemService.execute_problem（service.py:568）加 required *, actor: User。router 传原始 body.execute_user_id（None 可）+ actor；service `resolved = resolve_owner(...)`，`final = resolved if resolved is not None else actor.id`（复刻旧 router:504 `or user.id` 折叠，零漂移），写 exc.execute_user_id = exc.current_user_id = final。驳回 Grill 的 if-guard（启动者≠执行者且 omit 时会漂移）。
provides:
  - contract: problem-service-actor
    fields: [ProblemService.execute_problem.actor]
expect_from:
  - contract: ownership-helper
    from: task-01
    fields: [resolve_owner, PpmOwnershipDenied]
related_tests: []
implementation:
  - execute_problem(..., execute_user_id, *, actor: User, ...) 签名加 keyword-only actor
  - 原 service.py:639-641 `if execute_user_id is not None: exc.execute_user_id = execute_user_id; exc.current_user_id = execute_user_id` 改为：`resolved = resolve_owner(actor=actor, requested=execute_user_id, field="execute_user_id")`；`final = resolved if resolved is not None else actor.id`；`exc.execute_user_id = final; exc.current_user_id = final`
  - 注意：旧守卫恒真（router 折叠），新 final 逻辑对所有非冒名路径与旧等价（omit→actor.id==旧 user.id / self→self / admin+other→other）
acceptance:
  - AC-1 非管理员在 execute_problem 把 execute_user_id 填他人 → 403
  - AC-5 execute_user_id 为 None → final=actor.id（与旧 `or user.id` 等价，零漂移）
verify:
  - cd backend && uv run pytest app/modules/ppm/problem/tests/test_problem_flow.py -q --no-cov（task-09 同 Wave3 补 admin stub；9 处 execute_problem 均 omit execute_user_id 且不断言该字段→两种写法皆过）
constraints:
  - actor required keyword-only（*, actor）
  - 取 else actor.id 而非 if-guard（design §7.2 #7 + 自审/Grill/复审三方核实：if-guard 在启动者≠执行者且 omit 时保留启动者 id=漂移）
  - 不改 execute_problem 其他参数与返回类型
---
