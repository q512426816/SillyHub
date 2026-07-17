---
author: WhaleFall
created_at: 2026-07-16T11:27:00
---

# 决策台账 — 计划节点模板模块结构改造

> 变更 `2026-07-16-plan-node-module-restructure` 决策台账。
> v1 = brainstorm 初始决策；v2/v3 = execute 后需求迭代（见 design §13）。
> **当前生效版本**：D-001@v3、D-002@v2、D-003@v1、D-004@v2。

## D-001@v1（superseded → v3）

- **type**: boundary
- **status**: superseded（v3 取消，见 D-001@v3）
- **source**: 用户（brainstorm Step 6 AskUserQuestion）
- **question**: 已创建的模板能否后来修改「是否有模块子表」？
- **answer**: ~~新建时确定，保存后不可改~~。
- **normalized_requirement**: ~~PlanNodeUpdate 不含 has_module；service.update_plan_node 强制忽略~~。
- **演进**: v3 取消「不可改」约束，has_module 编辑时可改。

## D-001@v3（current）

- **type**: boundary
- **status**: accepted
- **source**: 用户（2026-07-17 需求变更）
- **question**: 已创建的模板能否后来修改「是否有模块子表」？
- **answer**: 可以编辑修改（取消 v1 不可改约束）。
- **normalized_requirement**: `PlanNodeUpdate` 含 `has_module`（可选）；`service.update_plan_node` 正常透传更新；前端 Switch 无 disabled（始终可改）。
- **impacts**: schema（Update 含 has_module）、service（不 pop）、前端（Switch 可改）。
- **priority**: P0

## D-002@v1（superseded → v2）

- **type**: architecture
- **status**: superseded（v2 取消三层，见 D-002@v2）
- **source**: 用户（brainstorm Step 6 + 原始需求）
- **question**: 有模块时模板明细的归属与编辑方式？
- **answer**: ~~明细挂 module_id（模板→模块→明细 三层）~~。
- **normalized_requirement**: ~~三层展开 + 明细挂 module_id~~。
- **演进**: v2 取消三层，has_module 降为纯记录，UI 统一二层。

## D-002@v2（current）

- **type**: architecture
- **status**: accepted
- **source**: 用户（2026-07-16 需求变更）
- **question**: has_module 的作用与展开结构？
- **answer**: has_module 降为纯记录字段，不驱动展开结构。计划节点模板页展开统一只显示模板明细一个子表（二层，挂 plan_node_id）。
- **normalized_requirement**: `PlanNodeChildren` 统一渲染 `DetailsSubTable`（二层）；移除 `ModulesSubTable`/三层展开；has_module 仅作记录（母表列 + Switch）。module_id 字段保留作防御性归属约束承载（见 D-004@v2）。
- **impacts**: 前端 page（统一二层）、后端校验简化（D-004@v2）。
- **priority**: P0

## D-003@v1（current，保留）

- **type**: approach
- **status**: accepted
- **source**: 用户（brainstorm Step 8 AskUserQuestion）
- **question**: 明细行内编辑的实现路径？
- **answer**: 方案 A——复用 `PpmSubTable` editable 组件（不在本页新写）。
- **normalized_requirement**: 明细子表用 `PpmSubTable` editable 模式（内部已 antd Form），固定 `scroll.x`。
- **impacts**: 前端实现（复用组件）、design §5.3。
- **priority**: P1

## D-004@v1（superseded → v2）

- **type**: consistency
- **status**: superseded（v2 简化，见 D-004@v2）
- **source**: 架构分析（brainstorm Step 9）
- **question**: 明细 `module_id` 归属一致性如何保证？
- **answer**: ~~has_module=true 时 module_id 必填且属同 plan_node；has_module=false 时必须为 null~~。
- **演进**: v2 简化为防御性校验（has_module 不参与）。

## D-004@v2（current）

- **type**: consistency
- **status**: accepted
- **source**: 架构分析（v2 需求变更）
- **question**: 明细 `module_id` 归属一致性如何保证？
- **answer**: 防御性校验——has_module 不参与，module_id 非 null 时必须属于同 plan_node（防脏数据），module_id=null 一律放行。
- **normalized_requirement**: `create_plan_node_detail` / `update_plan_node_detail` 校验 module_id 非 null 时归属同 plan_node，违例抛 400。
- **impacts**: service 校验简化、测试用例、design §13。
- **priority**: P1
