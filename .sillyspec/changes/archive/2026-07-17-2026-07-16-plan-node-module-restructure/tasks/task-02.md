---
id: task-02
title: "schema — PlanNodeCreate 加 has_module（必填）、Update 不含、Resp 加；PlanNodeDetailBase/Create/Update/Resp 加 module_id"
title_zh: Pydantic schema：PlanNode 加 has_module（新建必填不可改），PlanNodeDetail 加 module_id
author: WhaleFall
created_at: 2026-07-16 12:25:00
priority: P0
depends_on: [task-01]
blocks: [task-03, task-04, task-06]
requirement_ids: [FR-001, FR-004]
decision_ids: [D-001, D-002]
allowed_paths:
  - backend/app/modules/ppm/plan/schema.py
goal: >
  在 schema 层定义 has_module（Create 必填、Update 不含、Resp 返回）和 PlanNodeDetail 的 module_id（Create/Update/Resp 透传）。
implementation:
  - PlanNodeBase 加 has_module: bool = False。
  - PlanNodeCreate 覆盖为 has_module: bool（必填，无默认）。
  - PlanNodeUpdate 不含 has_module（不可改，D-001）。
  - PlanNodeResp 返回 has_module: bool。
  - PlanNodeDetailBase 加 module_id: uuid.UUID | None = None；Create/Update/Resp 继承透传 module_id。
acceptance:
  - PlanNodeCreate 未传 has_module 时校验失败（必填）。
  - PlanNodeUpdate 无 has_module 字段（序列化/反序列化不含）。
  - PlanNodeResp 序列化含 has_module。
  - PlanNodeDetail 各 schema 透传 module_id（可空）。
verify:
  - cd backend && ruff check app/modules/ppm/plan/schema.py
  - cd backend && mypy app/modules/ppm/plan/schema.py
constraints:
  - has_module 仅 Create 必填、Update 不可改（D-001）。
  - module_id 可空，不在 schema 层做归属校验（归属校验留 service 层，D-004）。
provides:
  - PlanNodeCreate[has_module]（必填）
  - PlanNodeUpdate（不含 has_module）
  - PlanNodeResp[has_module]
  - PlanNodeDetailBase/Create/Update/Resp[module_id]
expects_from:
  - task-01: PlanNode/PlanNodeDetail model 字段
---

plan.md task-02：见 design §7.1（后端 schema 变更）。为 service/router/前端 types 提供契约。
