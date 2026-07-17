---
author: WhaleFall
created_at: 2026-07-16T11:30:00
---

# 提案书（Proposal）— 计划节点模板模块结构改造

> 变更 `2026-07-16-plan-node-module-restructure` · scale: large · 方案 A · 原型 `prototype-plan-node-module-restructure.html`

## 动机

`/ppm/plan-nodes` 计划节点模板页当前强制每个模板都显示「模块子表」，且模板明细与模块是**并列**两个子表（都挂 plan_node_id），不符合业务直觉——用户期望：有的模板需要按模块拆分（此时明细应挂在模块下，模板→模块→明细），有的不需要（模板→明细即可）。同时页面表单抽屉仍用原生 input，与其他页 antd 风格不统一。

## 目标

1. 新建模板时可选「是否有模块子表」（保存后不可改）。
2. 有模块：模板 → 模块 → 明细（三层），明细挂 `module_id`。
3. 无模块：模板 → 明细（二层，现状），明细挂 `plan_node_id`。
4. plan-nodes 页所有原生输入控件改 antd。

## 不在范围内（Non-Goals）

- 不改 PlanNodeModule 模块表结构（milestone-details 共用方零回归）。
- 不改 ps 簇（PsPlanNodeDetail 已有 module_id）、importer（不建 PlanNodeDetail）。
- 不做模板→项目计划生成（现状不存在）。
- 不允许 has_module 创建后切换。
- 不改其他 ppm 页面。

## 方案（方案 A）

- **后端**：PlanNode + `has_module`（bool，新建必填不可改）；PlanNodeDetail + `module_id`（可选）；1 个 alembic migration；schema/service/router 透传 + 归属校验。
- **前端**：plan-nodes 页重写——母表加「是否有模块」列；展开行条件渲染（无模块→明细二层 / 有模块→模块子表→模块展开→明细三层）；模板/模块抽屉 antd Form 化；明细复用 PpmSubTable editable（固定 scroll.x）。

## 影响范围

后端 `ppm/plan`（model/schema/service/router）+ 1 migration + 测试；前端 `lib/ppm/types.ts` + `plan-nodes/page.tsx`。共 8 文件。PlanNodeModule 表、importer、ps 簇、PpmSubTable 组件均不动。

## 风险

见 `design.md` §10：R-01 三层滚动（固定 scroll.x）/ R-02 has_module 不可改强制 / R-03 module_id 归属校验 / R-04 现有数据（可重置）/ R-05 前置变更 plan-node-subtable-style 需先归档。
