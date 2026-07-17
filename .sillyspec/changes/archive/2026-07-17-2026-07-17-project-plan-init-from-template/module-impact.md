---
author: WhaleFall
created_at: 2026-07-17T12:18:00
---

# 模块影响分析（Module Impact）— 项目计划初始化从模板

> 变更 `2026-07-17-project-plan-init-from-template` · commit 790616

## 模块影响矩阵

| 模块 | 影响类型 | 影响范围 | 变更文件 |
|---|---|---|---|
| **ppm** | 逻辑变更 + 数据结构变更 + 新增 | plan 子域（PsProjectPlan 创建 / PsPlanNode / PsPlanNodeDetail / milestone-details 页）| model.py / schema.py / service.py / test_service.py / types.ts / milestone-details/page.tsx |

### ppm 模块影响详情

- **逻辑变更**：`create_ps_project_plan` 扩展为同事务按模板批量建里程碑（无模块含明细 draft / 有模块空）；`create_module` 扩展为复制模板明细到新模块（draft）。
- **数据结构变更**：`PsPlanNode` + `template_plan_node_id`（追溯模板）+ `has_module`（冗余，模块层判断）。
- **新增**：migration `20260717_psn_tmpl_fields`（ALTER +2 列）；helper `_init_milestones_from_template` + `_copy_template_details_to_node`。
- **前端**：milestone-details 模块层条件 `overall_stage` → `has_module`（expandRender + Tag）。

### 零回归（ppm 模块内未动）

模板表 PlanNode/PlanNodeDetail/PlanNodeModule、importer、ps 簇 CRUD（get/update/delete/list）、流程（save/reject/change）、三联表查询、PlanTask 联动均未改。

## 未匹配文件

| 文件 | 类型 | 说明 |
|---|---|---|
| `backend/migrations/versions/20260717_ps_plan_node_template_fields.py` | DB 迁移 | ALTER ppm_ps_plan_node +2 列（alembic 跨模块基础设施）|

## 三重交叉验证

- **声明范围**（design §6 文件清单）：7 源码文件 ✅
- **任务范围**（plan.md task-01~08）：覆盖上述文件 ✅
- **真实变更**（git diff）：7 源码 + migration + spec 文档，与声明一致 ✅
- 以 git diff 为准，三者一致。

## 模块文档同步建议

- `modules/ppm.md`「变更索引」追加：`2026-07-17-project-plan-init-from-template | 新建项目计划按模板批量初始化里程碑（has_module=无含明细 draft / 有空里程碑；新建模块复制模板明细；PsPlanNode+template_plan_node_id+has_module）`。
- `modules/ppm.md` 注意事项可补：新建项目计划自动建里程碑（同事务，按所有 PlanNode 模板）；create_module 复制模板明细（模板不分模块）；模块层条件改 has_module。
