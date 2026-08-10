---
id: task-02
title: task/service.py PlanTaskService.start + execute_plan 加 required *, actor + resolve_owner
title_zh: PlanTask 服务注入 actor
priority: P0
depends_on: [task-01]
blocks: [task-06, task-08]
requirement_ids: [FR-04]
decision_ids: [D-002@v1]
allowed_paths:
  - backend/app/modules/ppm/task/service.py
created_at: 2026-08-10 00:22:00
author: qinyi
goal: >
  PlanTaskService.start（service.py:248）与 execute_plan（service.py:301）加 required keyword-only *, actor: User，execute_user_id 经 resolve_owner 校验，None 保留既有默认（start→actor.id，execute_plan→不覆盖 execute_user_id / current_user_id 用 current_user_id 兜底）。零行为漂移。
provides:
  - contract: task-service-actor
    fields: [PlanTaskService.start.actor, PlanTaskService.execute_plan.actor]
expect_from:
  - contract: ownership-helper
    from: task-01
    fields: [resolve_owner, PpmOwnershipDenied]
related_tests: []
implementation:
  - start(plan_task_id, execute_user_id, actual_start_time, *, actor: User)：resolved = resolve_owner(actor=actor, requested=execute_user_id, field="execute_user_id")；原 `actor_id = execute_user_id or plan.user_id` 改为 `actor_id = resolved if resolved is not None else actor.id`（用 actor.id 而非旧死代码 plan.user_id，避免 live 漂移——design §7.2 #1）；execute_user_id=actor_id、current_user_id=actor_id 落库不变
  - execute_plan(req, current_user_id, *, actor: User)：resolved = resolve_owner(actor=actor, requested=req.execute_user_id)；`if resolved is not None: exc.execute_user_id = resolved`（原 :362-363）；`exc.current_user_id = resolved or current_user_id`（原 :366，resolved None→current_user_id 兜底，零漂移）
acceptance:
  - AC-1 非管理员在 start/execute_plan 把 execute_user_id 填他人 → PpmOwnershipDenied→403
  - AC-5 execute_user_id 为 None → start 用 actor.id、execute_plan 不覆盖 execute_user_id（保留 start 写入值）+ current_user_id 用 current_user_id 兜底
verify:
  - cd backend && uv run pytest app/modules/ppm/task/tests/test_task.py -q --no-cov（task-08 补 admin stub 后全绿；本 task 改签名，task-08 同 Wave3 补 stub）
constraints:
  - actor 必须 required keyword-only（*, actor），勿设默认值——保纵深防御（D-002，Design Grill 警告）
  - 不改 start/execute_plan 的其他参数顺序与返回类型
  - None 路径行为与旧逻辑逐字段等价（零漂移）
---
