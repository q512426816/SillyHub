---
id: task-08
title: "Drawer antd 化 — NodeFormDrawer 原生 input→antd Form/Input/InputNumber+Switch（has_module 编辑态 disabled）；ModuleFormDrawer 原生 input→antd Form/Input/DatePicker"
title_zh: 抽屉 antd 化：模板抽屉与模块抽屉原生 input 改 antd Form 控件
author: WhaleFall
created_at: 2026-07-16 12:25:00
priority: P1
depends_on: [task-06]
blocks: [task-09]
requirement_ids: [FR-001, FR-005]
decision_ids: [D-001]
allowed_paths:
  - frontend/src/app/(dashboard)/ppm/plan-nodes/page.tsx
goal: >
  将 NodeFormDrawer / ModuleFormDrawer 的原生 input + tailwind 改为 antd Form/Input/InputNumber/DatePicker/Switch，has_module 编辑态 disabled。
implementation:
  - NodeFormDrawer：总阶段/项目类型/编号 → antd Form + Input/InputNumber；has_module → antd Switch，编辑态 disabled（D-001，不可改）。
  - ModuleFormDrawer：模块名/工时/开始/完成 → antd Form + Input/InputNumber/DatePicker；责任人沿用 PpmUserSelect。
  - 项目类型沿用 PpmDictSelect。
  - 去除原生 input + inputCls tailwind 写法。
acceptance:
  - 两个抽屉全 antd 控件，无原生 input。
  - has_module 编辑态 Switch disabled（不可改）。
  - 新建模板可选 has_module 并正确提交。
verify:
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm lint
  - 浏览器手验：新建/编辑模板与模块抽屉表单提交正常
constraints:
  - has_module 仅新建可选，编辑 disabled（D-001）。
  - 与 plan-nodes 页其余 antd 风格一致（CLAUDE.md 规则 17）。
  - 不引入新依赖，用既有 antd。
expects_from:
  - task-06: PlanNodeCreate/Update + 模块类型
---

plan.md task-08：见 design §5.4（antd 化范围表）、decisions D-001。
