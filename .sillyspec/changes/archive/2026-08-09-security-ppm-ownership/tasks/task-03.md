---
id: task-03
title: task/service.py TaskExecuteService.create + update 加 required *, actor + 三字段 resolve_owner
title_zh: TaskExecute 服务注入 actor
priority: P0
depends_on: [task-01]
blocks: [task-06, task-08]
requirement_ids: [FR-05]
decision_ids: [D-002@v1]
allowed_paths:
  - backend/app/modules/ppm/task/service.py
created_at: 2026-08-10 00:22:00
author: qinyi
goal: >
  TaskExecuteService.create（service.py:410）与 update（service.py:425）加 required *, actor: User，execute_user_id/check_user_id/current_user_id 三字段各过 resolve_owner（仅 data 提供的校验，None 保留默认）。
provides:
  - contract: task-execute-service-actor
    fields: [TaskExecuteService.create.actor, TaskExecuteService.update.actor]
expect_from:
  - contract: ownership-helper
    from: task-01
    fields: [resolve_owner, PpmOwnershipDenied]
related_tests: []
implementation:
  - create(data: TaskExecuteCreate, *, actor: User)：在 `TaskExecute(**data.model_dump())` 落库前，对三字段各 resolve：data.execute_user_id = resolve_owner(actor=actor, requested=data.execute_user_id, field="execute_user_id")；同理 check_user_id / current_user_id（None→resolve_owner 返 None 保留 TaskExecute 默认）
  - update(exec_id, data: TaskExecuteUpdate, *, actor: User)：仅 data 提供的字段（非 None）才校验；execute_user_id/check_user_id/current_user_id 各 `if getattr(data, field) is not None: resolve_owner(...)` 后赋值
acceptance:
  - AC-1 非管理员在 task-execute create/update 把 execute/check/current_user_id 填他人 → 403
  - AC-5 三字段 None → 保留既有默认，不 403
verify:
  - cd backend && uv run pytest app/modules/ppm/task/tests/test_task.py -q --no-cov（task-08 同 Wave3 补 admin stub）
constraints:
  - actor required keyword-only（*, actor）
  - 三字段独立校验，None 各自保留默认（不互相影响）
  - 不改 create/update 其他参数与返回类型
---
