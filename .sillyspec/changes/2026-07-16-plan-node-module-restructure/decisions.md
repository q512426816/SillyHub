---
author: WhaleFall
created_at: 2026-07-16T11:27:00
---

# 决策台账 — 计划节点模板模块结构改造

> 变更 `2026-07-16-plan-node-module-restructure` 决策台账，仅记录有实现/验收影响的决策。

## D-001@v1
- **type**: boundary
- **status**: accepted
- **source**: 用户（brainstorm Step 6 AskUserQuestion）
- **question**: 已创建的模板能否后来修改「是否有模块子表」？
- **answer**: 新建时确定，保存后不可改。
- **normalized_requirement**: `PlanNode.has_module` 在 `PlanNodeCreate` 必填；`PlanNodeUpdate` 不含 `has_module`；service.update_plan_node 强制忽略该字段。
- **impacts**: schema（Create 必填、Update 不含）、service（update 忽略）、前端（编辑抽屉 Switch disabled）、R-02。覆盖 design §2/§5.1/§7。
- **evidence**: 用户 AskUserQuestion 选「新建时定，之后不可改（推荐）」。
- **priority**: P0

## D-002@v1
- **type**: architecture
- **status**: accepted
- **source**: 用户（brainstorm Step 6 + 原始需求）
- **question**: 有模块时模板明细的归属与编辑方式？
- **answer**: 明细挂 `module_id`（模板→模块→明细 三层），用行内表格批量编辑。
- **normalized_requirement**: `PlanNodeDetail` 加 `module_id`；有模块模板展开 → 模块子表 → 模块展开 → 明细子表（挂 module_id）；明细复用 PpmSubTable editable 行内编辑 + 批量保存。
- **impacts**: model（PlanNodeDetail + module_id）、前端三层结构、design §5.1/§5.3。
- **evidence**: 用户 AskUserQuestion 选「行内表格批量编辑（推荐）」+ 原始需求「明细应是模块的子表」。
- **priority**: P0

## D-003@v1
- **type**: approach
- **status**: accepted
- **source**: 用户（brainstorm Step 8 AskUserQuestion）
- **question**: 明细行内编辑的实现路径？
- **answer**: 方案 A——复用 `PpmSubTable` editable 组件（不在本页新写）。
- **normalized_requirement**: 明细子表用 `PpmSubTable` editable 模式（内部已 antd Form），固定 `scroll.x`；不在 plan-nodes 页从零写行内编辑。
- **impacts**: 前端实现（复用组件）、R-01（三层滚动）、design §5.3。淘汰方案 B（新写，代码量大）。
- **evidence**: 用户 AskUserQuestion 选「方案 A：复用 PpmSubTable（推荐）」。
- **priority**: P1

## D-004@v1
- **type**: consistency
- **status**: accepted
- **source**: 架构分析（brainstorm Step 9）
- **question**: 明细 `module_id` 归属一致性如何保证？
- **answer**: 后端 service 层校验（has_module=true 时 module_id 必填且属于同 plan_node；has_module=false 时 module_id 必须为 null）。
- **normalized_requirement**: `create_plan_node_detail` / `update_plan_node_detail` 校验 module_id 归属，违例抛 400。
- **impacts**: service 校验逻辑、测试用例、R-03、design §5.1/§10。
- **evidence**: design §5.1/§10 R-03（防数据不一致）。
- **priority**: P1
