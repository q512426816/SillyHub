---
id: task-04
title: "router — GET /plan-node/{id}/details 加可选 module_id query；其余端点签名不变"
title_zh: router 层：明细列表端点加 module_id 可选查询参数
author: WhaleFall
created_at: 2026-07-16 12:25:00
priority: P1
depends_on: [task-02, task-03]
blocks: [task-05]
requirement_ids: [FR-004]
decision_ids: []
allowed_paths:
  - backend/app/modules/ppm/plan/router.py
goal: >
  在 GET /plan-node/{plan_node_id}/details 端点加可选 module_id query 参数，透传给 service 层过滤。
implementation:
  - 该 GET 端点签名加 module_id: uuid.UUID | None = Query(default=None)。
  - 调用 list_plan_node_details_by_node 时透传 module_id。
  - 其余模板/明细/模块端点签名不变（body schema 变更由 task-02 自动生效，无需改 router）。
acceptance:
  - GET /plan-node/{id}/details?module_id=<uuid> 返回该模块下明细。
  - GET /plan-node/{id}/details 不带 module_id 行为不变（返回全部/挂模板明细）。
  - 其余端点签名未变。
verify:
  - cd backend && ruff check app/modules/ppm/plan/router.py
  - cd backend && mypy app/modules/ppm/plan/router.py
  - cd backend && pytest app/modules/ppm/plan/tests/test_router.py
constraints:
  - module_id 为可选 query，不破坏旧调用。
  - 不新增/删除端点，只加 query 参数。
expects_from:
  - task-02: PlanNodeDetail schema（响应模型）
  - task-03: list_plan_node_details_by_node 支持 module_id
---

plan.md task-04：见 design §7.2（端点变更）。
