---
id: task-07
title: "plan-nodes 页重写 — 母表加「是否有模块」列；展开行条件渲染（无模块二层/有模块三层）；明细复用 PpmSubTable editable + 固定 scroll.x + DETAIL_COLUMNS 列宽压缩"
title_zh: 前端 plan-nodes 页重写：母表加列、二/三层条件展开、明细复用 PpmSubTable
author: WhaleFall
created_at: 2026-07-16 12:25:00
priority: P0
depends_on: [task-06]
blocks: [task-09]
requirement_ids: [FR-002, FR-003, FR-004]
decision_ids: [D-002, D-003]
allowed_paths:
  - frontend/src/app/(dashboard)/ppm/plan-nodes/page.tsx
goal: >
  重写 plan-nodes 页：母表加「是否有模块」列，按 has_module 条件渲染二层（挂 plan_node_id）或三层（模块子表→模块展开→明细挂 module_id）结构，明细复用 PpmSubTable editable。
implementation:
  - 母表加「是否有模块」列（Tag 是/否）。
  - 展开行条件渲染：has_module=false → DetailsSubTable(planNodeId) 二层；has_module=true → ModulesSubTable(planNodeId) antd Table，模块行 expandRender → DetailsSubTable(moduleId) 三层。
  - 明细子表复用 PpmSubTable editable 模式（不新写行内编辑，D-003）。
  - 明细固定 scroll.x + DETAIL_COLUMNS 列宽压缩（继承 plan-node-subtable-style 的 ql-008 教训，R-01/R-05）。
  - 有模块模板按模块按需拉明细（不全量）。
acceptance:
  - 无模块模板展开 → 明细子表（挂 plan_node_id），行内编辑可保存。
  - 有模块模板展开 → 模块子表 → 模块展开 → 明细子表（挂 module_id），行内编辑可保存。
  - 明细横向滚动正常，列宽不挤压。
verify:
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm lint
  - 浏览器手验：二层/三层展开 + 明细行内编辑保存
constraints:
  - 不新写明细行内编辑，复用 PpmSubTable（D-003）。
  - 明细固定 scroll.x（R-01），继承 plan-node-subtable-style 列宽成果（R-05）。
  - 不改 PlanNodeModule 共用查询逻辑（milestone-details 零回归）。
expects_from:
  - task-06: PlanNode/PlanNodeDetail 类型
  - plan-node-subtable-style（R-05 前置归档）：DETAIL_COLUMNS 列宽/scroll.x 成果
---

plan.md task-07：见 design §5.3（前端结构）、§10 R-01/R-05、decisions D-002/D-003。
