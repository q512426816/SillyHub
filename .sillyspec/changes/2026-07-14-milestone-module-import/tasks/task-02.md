---
id: task-02
title: 前端 plan_type 类型 + moduleColumns 计划类型列
title_zh: 前端模块类型与列表计划类型列
author: WhaleFall
created_at: 2026-07-14 19:24:33
priority: P0
depends_on: []
blocks: [task-09]
requirement_ids: [FR-002]
decision_ids: []
allowed_paths:
  - frontend/src/lib/ppm/types.ts
  - frontend/src/app/(dashboard)/ppm/milestone-details/page.tsx

goal: >
  前端 PlanNodeModule 类型新增 plan_type 字段，并在「明细·模块」列表加「计划类型」列，用 AntD Tag 区分正常/临时计划。

implementation: |
  - "types.ts：PlanNodeModule 接口（约 L266）加 plan_type?: string | null；PlanNodeModuleUpdate（约 L288）同步加 plan_type?: string | null —— 编辑保存不丢字段（design §12 自审存疑项已确认必须同步）"
  - "milestone-details/page.tsx 的 moduleColumns（约 L816-908）：在「模块名称」列之后插入一列「计划类型」"
  - "列渲染用 AntD Tag：plan_type === '正常计划' → <Tag color='blue'>正常计划</Tag>；'临时计划' → <Tag color='orange'>临时计划</Tag>；null/空 → 「—」"

acceptance: |
  - PlanNodeModule / PlanNodeModuleUpdate 类型均含 plan_type 字段
  - 模块列表显示「计划类型」列，正常计划/临时计划/null 三种情况正确渲染
  - cd frontend && pnpm exec tsc --noEmit 通过

verify: |
  - cd frontend && pnpm exec tsc --noEmit

constraints: |
  - 不改导入逻辑（task-08/09 负责）
  - 列渲染须对 null 安全（旧数据 plan_type 为 NULL，design §9 兼容策略）
  - Tag 颜色与项目样式约定一致（blue=正常/blue-600，amber/orange=临时）
  - 新列置于「模块名称」之后、「责任人」之前
---
