---
id: task-06
title: "types — PlanNode+has_module；Create+has_module；Update 不含；Detail/Create/Update+module_id"
title_zh: 前端类型：PlanNode 加 has_module，PlanNodeDetail 加 module_id，对齐后端 schema
author: WhaleFall
created_at: 2026-07-16 12:25:00
priority: P0
depends_on: [task-02]
blocks: [task-07, task-08, task-09]
requirement_ids: [FR-001, FR-004]
decision_ids: [D-001, D-002]
allowed_paths:
  - frontend/src/lib/ppm/types.ts
goal: >
  在 types.ts 对齐后端：PlanNode/Create 加 has_module，Update 不含，PlanNodeDetail/Create/Update 加可空 module_id。
implementation:
  - PlanNode 接口加 has_module: boolean。
  - PlanNodeCreate 加 has_module: boolean（必填）。
  - PlanNodeUpdate 不含 has_module（对齐后端不可改）。
  - PlanNodeDetail 加 module_id?: string | null；PlanNodeDetailCreate/Update 对齐加 module_id?: string | null。
acceptance:
  - types.ts 编译通过（tsc --noEmit）。
  - 类型与后端 schema 一致（has_module 必填/不可改语义、module_id 可空）。
verify:
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - 严格对齐后端 schema（task-02 契约）。
  - has_module 不进 Update 类型（D-001）。
provides:
  - PlanNode[has_module]、PlanNodeCreate[has_module]、PlanNodeUpdate（无 has_module）
  - PlanNodeDetail/Create/Update[module_id?]
expects_from:
  - task-02: 后端 schema 字段定义（对齐依据）
---

plan.md task-06：见 design §7.3（前端类型）。为 plan-nodes 页重写与 Drawer 改造提供类型基础。
