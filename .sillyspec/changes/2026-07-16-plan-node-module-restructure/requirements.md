---
author: WhaleFall
created_at: 2026-07-16T11:31:00
---

# 需求（Requirements）— 计划节点模板模块结构改造

> 变更 `2026-07-16-plan-node-module-restructure` · scale: large
> v1 = brainstorm 初始需求；v2/v3 = execute 后需求迭代（见 design §13）。
> **当前生效**：FR-001（v3 可编辑）/ FR-002（v2 取消）/ FR-003（v2 统一二层）/ FR-004（v2 简化）/ FR-005（v2 移除模块抽屉）/ FR-006。

## FR-001 模板「是否有模块」标志（v3：可编辑）

`PlanNode` 加 `has_module: bool`。新建模板时必填（表单开关），**编辑时可改**（v3 取消 v1 的不可改约束：`PlanNodeUpdate` 含 has_module，service 正常透传）。母表显示「是否有模块」列（是/否 Tag）。**has_module 仅作记录字段，不驱动展开结构**（v2）。

## FR-002 ~~有模块时三层结构~~（v2 取消 superseded）

~~has_module=true 的模板展开模块子表→模块展开→明细三层~~。**v2 取消**：计划节点模板页展开统一只显示模板明细一个子表（不论 has_module）。has_module 降为纯记录字段。module_id 字段保留作防御性归属约束承载（见 FR-004）。

## FR-003 统一二层明细（v2）

无论 has_module 取值，计划节点模板页展开行统一显示**模板明细子表**（明细挂 `plan_node_id`，二层）。层级：模板 → 明细。明细复用 PpmSubTable editable 行内编辑。

## FR-004 明细归属一致性（v2 简化防御）

- `module_id=null`：一律放行（UI 统一二层）。
- `module_id` 非 null：必须属于同一 `plan_node_id` 下的模块（防脏数据），违例 400。
- has_module 不参与校验（v2 简化；v1 的 has_module=true 必填 / false 必须 null 取消）。
- `GET /plan-node/{id}/details` 支持可选 `module_id` 过滤（保留）。

## FR-005 antd 化（v2：NodeFormDrawer 保留，ModuleFormDrawer 移除）

NodeFormDrawer 原生 input 改 antd Form/Input/InputNumber/Switch（has_module，v3 始终可改）。~~ModuleFormDrawer~~（v2 模块子表从计划节点模板页移除，该抽屉已删）。母表 antd Table；明细 PpmSubTable（已 antd Form）。

## FR-006 零回归

PlanNodeModule 模块表结构不变（milestone-details 共用方行为不变）；importer 不受影响；ps 簇不动；PpmSubTable 组件不改。

## 验收标准（v2/v3/v4 调整后）

- 新建/编辑模板「是否有模块」开关可切换并保存（v3 可改）。
- 展开**任意**模板 → 只显示模板明细一个子表（v2 统一二层，挂 plan_node_id，行内编辑保存）。
- 明细 module_id 非 null 跨模板归属违例被后端拒绝（400，v2 防御）；module_id=null 一律放行。
- NodeFormDrawer 全 antd 控件，无原生 input。
- milestone-details 页模块 CRUD 行为不变。
- 后端 ruff/mypy/pytest 过；前端 tsc/vitest/lint 过。
- 列表按编号正序（v4）。
