---
author: WhaleFall
created_at: 2026-07-17T10:50:00
plan_level: light
---

# 轻量计划（Light Plan）：项目计划初始化从模板

## 来源
brainstorm `design.md` 方案 A（后端 service 自动）。详细设计/接口/数据模型/风险见 `design.md`，本计划只组织 Wave + Task + 覆盖矩阵，不重复实现细节。

## 范围
- 后端 `backend/app/modules/ppm/plan/`：model.py / schema.py / service.py
- 后端 migration：`backend/migrations/versions/<ts>_ps_plan_node_template_fields.py`
- 后端测试：`backend/app/modules/ppm/plan/tests/test_service.py`
- 前端：`frontend/src/lib/ppm/types.ts` + `frontend/src/app/(dashboard)/ppm/milestone-details/page.tsx`
- 不动：模板表 PlanNode/PlanNodeDetail/PlanNodeModule、importer、ps 簇其他逻辑、项目计划创建前端流程

## Wave & Tasks

### Wave 1 — 后端（model + schema + service + migration + 测试）
- [ ] task-01: model + migration — `PsPlanNode` + `template_plan_node_id`（uuid|null）+ `has_module`（bool default false）；migration ALTER `ppm_ps_plan_node` ADD 两列。（覆盖 FR-005，D-005）
- [ ] task-02: schema — `PsPlanNodeResp` / `PsPlanNodeWithDetail` 加 `template_plan_node_id` + `has_module`。（覆盖 FR-005，D-005）
- [ ] task-03: service create_ps_project_plan 批量建里程碑 — 同事务查所有 PlanNode 模板（按 no asc）建 PsPlanNode（overall_stage/no 从模板复制，template_plan_node_id+has_module 写入）；has_module=无复制模板 PlanNodeDetail→PsPlanNodeDetail（module_id=null, status=draft）/ 有只建空里程碑。注意 PlanNode.no（int）→ PsPlanNode.no（str）显式 str()。（覆盖 FR-001/002/003，D-001/D-002/D-003）
- [ ] task-04: service create_module 复制模板明细 — 反查 PsPlanNode.template_plan_node_id → 复制模板 PlanNodeDetail 到新模块（plan_node_id=里程碑.id, module_id=新模块.id, status=draft）；无模板（手动里程碑）则空模块。（覆盖 FR-004，D-004）
- [ ] task-05: 后端测试 — create_ps_project_plan 批量建（无模块含明细草稿/有模块空）+ create_module 复制模板明细 + no int→str；ruff format/check + mypy + pytest 过。（覆盖 FR-001~004/007）

### Wave 2 — 前端（types + milestone-details + 测试 + 部署）
- [ ] task-06: types — `types.ts` PsPlanNode + `template_plan_node_id` + `has_module`。（覆盖 FR-005）
- [ ] task-07: milestone-details 模块层条件 — `page.tsx` 模块层 `overall_stage==="实施阶段"` → `PsPlanNode.has_module===true`。（覆盖 FR-006，D-006）
- [ ] task-08: 前端测试 + 部署 — vitest + tsc --noEmit + pnpm lint 过；rebuild backend+frontend Docker；浏览器验收（新建项目计划自动建里程碑 / 新建模块复制明细 / 模块层三级 vs 二级）。（覆盖 FR-006/007）

## 依赖关系
- **Wave 2 依赖 Wave 1**：前端 types/milestone-details 依赖后端字段 + API。
- Wave 1 内部：task-01（model+migration）→ task-02（schema）→ task-03/04（service）→ task-05（测试）。
- Wave 2 内部：task-06（types）→ task-07（page）→ task-08（测试+部署）。
- **R-02 定案**：项目未上线可重置（CLAUDE.md 规则 11），migration **不回填**现有"实施阶段"里程碑（has_module default false）；现有数据接受二级展示（非阻塞，可重置）。

## 验收
- 新建项目计划 → 自动生成里程碑（无模块模板含明细草稿 / 有模块模板只建空里程碑）。
- 实施阶段里程碑新建模块 → 模块 + 模板明细复制（草稿）。
- milestone-details 有模块里程碑三级展开（模块层）/ 无模块二级。
- 后端 ruff/mypy/pytest 过；前端 tsc/vitest/lint 过。
- 现有项目计划/里程碑不回归（手动建的里程碑 template_plan_node_id=null 行为不变）。

## 覆盖矩阵

| 决策 ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v1（方案 A 后端自动） | task-03 / task-04 | create_ps_project_plan / create_module service 内同事务建/复制 |
| D-002@v1（所有模板不筛选） | task-03 | 查全量模板按 no asc |
| D-003@v1（has_module 处理） | task-03 | 无模块复制明细 draft / 有只建空里程碑 |
| D-004@v1（模板不分模块，复制明细） | task-04 | create_module 反查 template_plan_node_id 复制模板明细到新模块 |
| D-005@v1（PsPlanNode 加字段） | task-01 / task-02 / task-06 | template_plan_node_id + has_module（model + schema + types） |
| D-006@v1（模块层条件改 has_module） | task-07 | milestone-details page.tsx overall_stage → has_module |
