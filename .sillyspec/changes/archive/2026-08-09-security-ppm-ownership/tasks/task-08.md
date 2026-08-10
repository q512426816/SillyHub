---
id: task-08
title: task/tests/test_task.py 补 actor=admin stub（~13 直调 + _seed_work_hour/_seed_task_execute 两 helper）
title_zh: test_task 补 admin stub
priority: P0
depends_on: [task-02, task-03, task-04]
blocks: [task-10]
requirement_ids: [FR-10]
decision_ids: [D-006@v1]
allowed_paths:
  - backend/app/modules/ppm/task/tests/test_task.py
created_at: 2026-08-10 00:22:00
author: qinyi
goal: >
  task/tests/test_task.py 所有直接调 service 方法处（签名加 required *, actor 后会 TypeError）补 actor=admin stub，不改断言语义（规则 9）。修 _seed_work_hour/_seed_task_execute 两 helper 定义即覆盖其全部下游复用（stat_by_user/stat_by_project/page_date_range 等 ~4 测试 ~8 调用点）。复审 NIT#1/#3 校正：直调共 11 处（start ×4 :242/:295/:321/:368 + execute_plan ×4 :254/:278/:328/:387 + TaskExecuteService.create ×2 :406/:416 + WorkHourService.update :439）+ 2 helper（_seed_work_hour:73 / _seed_task_execute:113）。
provides:
  - contract: task-tests-patched
    fields: [test_task.py actor stub]
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
related_tests: []
implementation:
  - 模块级 admin stub：`import types; _ADMIN = types.SimpleNamespace(id=uuid.uuid4(), is_platform_admin=True)`（或 pytest fixture），resolve_owner 鸭子类型读 is_platform_admin/id 放行
  - _seed_work_hour（:64-80）：WorkHourService.create(..., actor=_ADMIN)（admin 放行，既有随机 user_id 造数仍 OK）
  - _seed_task_execute（:86-130）：TaskExecuteService.create(..., actor=_ADMIN) + plan_svc.start/execute_plan 若有也补（核对 helper 内是否调 start）
  - 直调点逐处补 actor=_ADMIN：start(:242/:295/:321/:368)、execute_plan(:254/:278/:328/:387)、TaskExecuteService.create(:406/:416)、WorkHourService.update(:439)
  - 运行测试，任何遗漏的 service 直调（TypeError: missing actor）即刻暴露并补上——以 pytest 全绿为准，不局限于上列行号
acceptance:
  - AC-6 test_task.py 全绿，断言语义不变（仅补 actor 参数模拟合法 admin 调用）
verify:
  - cd backend && uv run pytest app/modules/ppm/task/tests/test_task.py -q --no-cov
constraints:
  - 只补 actor 参数，不改任何断言（规则 9：测试本身模拟了合法 admin 直调，非改测试逻辑掩盖 bug）
  - admin stub 用 SimpleNamespace（不必建 User ORM 行，resolve_owner 不查库）
  - 不动 PlanTaskService.create（建计划 user_id，不在范围）的调用
---
