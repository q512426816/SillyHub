---
author: WhaleFall
created_at: 2026-07-17T09:55:00
---

# 提案（Proposal）— 项目计划初始化从模板

> 变更 `2026-07-17-project-plan-init-from-template` · scale: large

## 问题

新建项目计划（PsProjectPlan）后，里程碑（PsPlanNode）只能手动逐条新建，与计划节点模板（PlanNode）无关联，效率低且结构不一致。

## 方案

方案 A（后端 service 自动，D-001）：
- `create_ps_project_plan` 同事务按所有 PlanNode 模板批量建 PsPlanNode（has_module=无复制明细草稿 / 有只建空里程碑）。
- `create_module`（has_module=有里程碑）复制模板明细到新模块。
- PsPlanNode 加 `template_plan_node_id` + `has_module` 字段。
- milestone-details 模块层条件改 `has_module` 判断。

## 不在范围内（Non-Goals）

- 不改模板表（PlanNode / PlanNodeDetail / PlanNodeModule）
- 不改现有项目计划/里程碑（只对新建生效）
- 不做 project_type 筛选（所有模板都生成）
- 不改 importer / ps 簇其他逻辑 / PlanTask 联动
- 不恢复模板的模块管理（模板不分模块，has_module 仅标记）
- 不改项目计划创建前端流程（后端自动）

## 影响

- 后端 plan 子域：model / schema / service / migration / tests
- 前端：types + milestone-details page
- 零回归：现有项目计划/里程碑不动；模板表 / importer 不动；端点签名不变。

## 实现路径

`sillyspec run plan --change 2026-07-17-project-plan-init-from-template`
