---
author: WhaleFall
created_at: 2026-07-16T11:31:00
---

# 需求（Requirements）— 计划节点模板模块结构改造

> 变更 `2026-07-16-plan-node-module-restructure` · scale: large

## FR-001 模板「是否有模块」标志

`PlanNode` 加 `has_module: bool`。新建模板时必填（表单开关），**保存后不可改**（`PlanNodeUpdate` 不含该字段，service 层强制忽略）。母表显示「是否有模块」列（是/否 Tag）。

## FR-002 有模块时三层结构

`has_module=true` 的模板：展开行显示**模块子表**（antd Table）；模块行可再展开，显示该模块下的**明细子表**（明细挂 `module_id`）。层级：模板 → 模块 → 明细。

## FR-003 无模块时二层结构

`has_module=false` 的模板：展开行直接显示**明细子表**（明细挂 `plan_node_id`，现状）。层级：模板 → 明细。

## FR-004 明细归属一致性

- `has_module=true`：明细 `module_id` 必填，且必须属于同一 `plan_node_id` 下的模块；违例 400。
- `has_module=false`：明细 `module_id` 必须为 null。
- `GET /plan-node/{id}/details` 支持可选 `module_id` 过滤（三层按模块拉明细）。

## FR-005 全页 antd 化

模板抽屉（NodeFormDrawer）、模块抽屉（ModuleFormDrawer）的原生 `<input>` 改 antd `Form` / `Input` / `InputNumber` / `DatePicker` / `Switch`（has_module）。母表、模块表用 antd Table；明细用 PpmSubTable（已 antd Form）。

## FR-006 零回归

PlanNodeModule 模块表结构不变（milestone-details 共用方行为不变）；importer 不受影响；ps 簇不动；PpmSubTable 组件不改。

## 验收标准

- 新建模板可选有/无模块，保存后编辑态开关禁用、后端拒绝改 has_module。
- 有模块模板展开 → 模块子表 → 模块展开 → 明细子表（明细挂 module_id，行内编辑保存）。
- 无模块模板展开 → 明细子表（明细挂 plan_node_id，行内编辑保存）。
- 明细 module_id 归属违例被后端拒绝（400）。
- 抽屉表单全 antd 控件，无原生 input。
- milestone-details 页模块 CRUD 行为不变。
- 后端 ruff/mypy/pytest 过；前端 tsc/vitest/lint 过。
