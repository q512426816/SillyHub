---
author: WhaleFall
created_at: 2026-07-17T09:55:00
---

# 需求（Requirements）— 项目计划初始化从模板

> 变更 `2026-07-17-project-plan-init-from-template` · scale: large

## FR-001 新建项目计划同步建里程碑
新建 PsProjectPlan 时，按**所有 PlanNode 模板**（按 no 正序）批量建 PsPlanNode（overall_stage/no 从模板复制，template_plan_node_id 记录来源，has_module 冗余）。

## FR-002 无模块模板复制明细
has_module=false 模板：建里程碑 + 复制模板 PlanNodeDetail → PsPlanNodeDetail（module_id=null, **status=draft**）。

## FR-003 有模块模板建空里程碑
has_module=true 模板：只建里程碑（空，不建明细/模块）。

## FR-004 新建模块复制模板明细
has_module=true 里程碑用户新建模块时：建 PlanNodeModule（ps 侧，挂里程碑）+ 复制模板**全部 PlanNodeDetail** → PsPlanNodeDetail（module_id=新模块, **status=draft**）。模板不分模块（has_module 仅标记）。

## FR-005 PsPlanNode 加字段
`template_plan_node_id`（uuid|null，来源模板）+ `has_module`（bool default false，冗余，模块层判断）。migration ALTER ppm_ps_plan_node ADD 两列。

## FR-006 milestone-details 模块层条件
模块层展示条件：`overall_stage==="实施阶段"` → 改为 `PsPlanNode.has_module===true`（有模块里程碑三级展开 / 无模块二级）。

## FR-007 零回归
现有项目计划/里程碑不动（只新建生效）；模板表 / importer / ps 簇其他逻辑不动；端点签名不变；手动建的里程碑（template_plan_node_id=null）行为不变。

## 验收
- 新建项目计划 → 自动生成里程碑（无模块含明细草稿 / 有模块空）。
- 实施阶段里程碑新建模块 → 模块 + 模板明细复制（草稿）。
- milestone-details 有模块里程碑三级展开 / 无模块二级。
- 后端 ruff/mypy/pytest 过；前端 tsc/vitest 过。
- 现有项目计划/里程碑不回归。
