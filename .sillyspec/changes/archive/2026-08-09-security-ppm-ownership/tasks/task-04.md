---
id: task-04
title: task/service.py WorkHourService.create + update 加 required *, actor + user_id resolve_owner
title_zh: WorkHour 服务注入 actor
priority: P0
depends_on: [task-01]
blocks: [task-06, task-08]
requirement_ids: [FR-06]
decision_ids: [D-002@v1]
allowed_paths:
  - backend/app/modules/ppm/task/service.py
created_at: 2026-08-10 00:22:00
author: qinyi
goal: >
  WorkHourService.create（service.py:529）与 update（service.py:542）加 required *, actor: User，user_id 过 resolve_owner（create 必填字段，update 可选）。注：复审 NIT#2 的 :439 指 test_task.py 中 update 调用点（task-08），非此 service.py。
provides:
  - contract: workhour-service-actor
    fields: [WorkHourService.create.actor, WorkHourService.update.actor]
expect_from:
  - contract: ownership-helper
    from: task-01
    fields: [resolve_owner, PpmOwnershipDenied]
related_tests: []
implementation:
  - create(data: WorkHourCreate, *, actor: User)：data.user_id（schema 必填，非 None）= resolve_owner(actor=actor, requested=data.user_id, field="user_id")；非管理员填他人→403，填自己→放行
  - update(wh_id, data: WorkHourUpdate, *, actor: User)：`if data.user_id is not None: data.user_id = resolve_owner(actor=actor, requested=data.user_id, field="user_id")`（update 可选，仅提供时校验）
acceptance:
  - AC-2 非管理员在 work-hour create/update 把 user_id 填他人 → 403
  - AC-4 自填（user_id==actor.id）→ 放行，行为不变
verify:
  - cd backend && uv run pytest app/modules/ppm/task/tests/test_task.py -q --no-cov（task-08 同 Wave3 补 admin stub）
constraints:
  - actor required keyword-only（*, actor）
  - create 的 user_id 是必填字段（schema.py:330），resolve_owner 不会收到 None（但仍兼容 None 分支）
  - 不改 create/update 其他参数与返回类型
---
