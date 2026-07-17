---
author: WhaleFall
created_at: 2026-07-17T09:50:00
---

# 决策台账 — 项目计划初始化从模板

> 变更 `2026-07-17-project-plan-init-from-template` 决策台账。

## D-001@v1 方案 A（后端 service 自动）

- **type**: approach
- **status**: accepted
- **source**: 用户（brainstorm Step 8 AskUserQuestion）
- **question**: 实现方案？
- **answer**: 方案 A——后端 service 自动（create_ps_project_plan + create_module 内同事务建/复制），前端零改动。
- **normalized_requirement**: create_ps_project_plan 批量建里程碑+明细；create_module 复制模板明细。均同事务。
- **impacts**: service.py。
- **priority**: P0

## D-002@v1 所有模板生成（不筛选）

- **type**: scope
- **status**: accepted
- **source**: 用户（brainstorm Step 6 AskUserQuestion）
- **question**: 用哪些模板生成里程碑？
- **answer**: 所有 PlanNode 模板（不筛选 project_type）。
- **impacts**: create_ps_project_plan 查全量模板。
- **priority**: P0

## D-003@v1 has_module 处理

- **type**: behavior
- **status**: accepted
- **source**: 用户（brainstorm Step 6）
- **question**: has_module 有/无的里程碑生成？
- **answer**: 无模块 → 里程碑 + 复制模板明细（草稿）；有模块 → 只建空里程碑。
- **impacts**: create_ps_project_plan 分支逻辑。
- **priority**: P0

## D-004@v1 create_module 复制模板明细（模板不分模块）

- **type**: behavior
- **status**: accepted
- **source**: 用户（brainstorm Step 6 + 现状澄清）
- **question**: 有模块里程碑新建模块时，模板多模块怎么办？
- **answer**: 模板不分模块（has_module 仅标记）；新建模块（ps 侧 PlanNodeModule）时复制模板全部明细 PlanNodeDetail 到该模块下。
- **impacts**: create_module 复制逻辑。
- **priority**: P0

## D-005@v1 PsPlanNode 加 template_plan_node_id + has_module

- **type**: data-model
- **status**: accepted
- **source**: 用户（brainstorm Step 6）+ 架构
- **question**: 如何追溯里程碑对应模板？
- **answer**: PsPlanNode 加 template_plan_node_id（追溯模板）+ has_module（冗余，模块层判断用，避免反查）。
- **impacts**: model.py + migration。
- **priority**: P0

## D-006@v1 模块层条件改 has_module

- **type**: ui
- **status**: accepted
- **source**: 用户（brainstorm Step 6）
- **question**: milestone-details 模块层展示条件？
- **answer**: overall_stage="实施阶段" → 改为 PsPlanNode.has_module=true。
- **impacts**: milestone-details page.tsx。
- **priority**: P1
