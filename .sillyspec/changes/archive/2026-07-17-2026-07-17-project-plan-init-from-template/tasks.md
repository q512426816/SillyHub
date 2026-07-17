---
author: WhaleFall
created_at: 2026-07-17T09:55:00
---

# 任务（Tasks）— 项目计划初始化从模板

> 变更 `2026-07-17-project-plan-init-from-template` · scale: large · 实现路径：plan → execute → verify → archive
> 依据：design.md §5/§6；分 2 Wave（初步，plan 阶段重排细化）

## Wave 1 — 后端（model + service + migration + 测试）

### task-01 model + migration
- `model.py`：PsPlanNode + `template_plan_node_id`（uuid|null）+ `has_module`（bool default false）。
- migration `ALTER ppm_ps_plan_node ADD` 两列。
- 覆盖：FR-005

### task-02 schema
- `schema.py`：PsPlanNodeResp / PsPlanNodeWithDetail 加 `template_plan_node_id` + `has_module`。
- 覆盖：FR-005

### task-03 service create_ps_project_plan 批量建里程碑
- `service.py`：create_ps_project_plan 同事务查所有模板（按 no asc）批量建 PsPlanNode（has_module=无复制明细 PlanNodeDetail→PsPlanNodeDetail draft / 有只建空里程碑）。
- 注意：PlanNode.no（int）→ PsPlanNode.no（str）类型转换 str()。
- 覆盖：FR-001/002/003

### task-04 service create_module 复制模板明细
- `service.py`：create_module 反查 PsPlanNode.template_plan_node_id → 复制模板 PlanNodeDetail 到新模块（module_id=新模块, status=draft）。无模板则空模块。
- 覆盖：FR-004

### task-05 后端测试
- `test_service.py`：create_ps_project_plan 批量建（无模块含明细/有模块空）+ create_module 复制 + no int→str。
- ruff format/check + mypy + pytest 过。
- 覆盖：FR-001~004/007

## Wave 2 — 前端（types + milestone-details + 测试）

### task-06 types
- `frontend/src/lib/ppm/types.ts`：PsPlanNode + `template_plan_node_id` + `has_module`。
- 覆盖：FR-005

### task-07 milestone-details 模块层条件
- `frontend/src/app/(dashboard)/ppm/milestone-details/page.tsx`：模块层 `overall_stage==="实施阶段"` → `PsPlanNode.has_module===true`。
- 覆盖：FR-006

### task-08 前端测试 + 部署
- vitest + tsc + pnpm lint 过；rebuild backend+frontend Docker 部署；浏览器验收（新建项目计划自动建里程碑 / 新建模块复制明细 / 模块层三级）。
- 覆盖：FR-006/007

## 依赖关系
- Wave 2 依赖 Wave 1（API + 字段）。
- task-03/04 依赖 task-01/02。
- R-02（现有"实施阶段"里程碑回填 has_module）在 plan 阶段定案（design §10/§12）。
