---
author: WhaleFall
created_at: 2026-07-16T11:40:00
plan_level: light
---

# 轻量计划（Light Plan）：计划节点模板模块结构改造

## 来源
brainstorm `design.md` 方案 A（复用 PpmSubTable editable + antd Table 三层 expand + 抽屉 antd Form）。详细设计/接口/数据模型/风险见 `design.md`，本计划只组织 Wave + Task + 覆盖矩阵，不重复实现细节。

## 范围
- 后端 `backend/app/modules/ppm/plan/`：model.py / schema.py / service.py / router.py
- 后端 migration：`backend/migrations/versions/<ts>_plan_node_has_module_detail_module_id.py`
- 后端测试：`backend/app/modules/ppm/plan/tests/test_service.py` / `test_router.py`
- 前端：`frontend/src/lib/ppm/types.ts` + `frontend/src/app/(dashboard)/ppm/plan-nodes/page.tsx`
- 不动：PlanNodeModule 表、importer、ps 簇、PpmSubTable 组件（零回归）

## Wave & Tasks

### Wave 1 — 后端（独立可交付，不依赖前端）
- [ ] task-01: model + migration — `PlanNode` + `has_module`（bool default false）；`PlanNodeDetail` + `module_id`（uuid|null）+ 索引 `ix_ppm_plan_node_detail_module`；alembic 加两列。（覆盖 FR-001/FR-004）
- [ ] task-02: schema — `PlanNodeCreate` 加 has_module（必填）、`PlanNodeUpdate` 不含 has_module、`PlanNodeResp` 加 has_module；`PlanNodeDetailBase/Create/Update/Resp` 加 module_id。（覆盖 FR-001/FR-004）
- [ ] task-03: service — `list_plan_node_details_by_node` 加可选 module_id 过滤；create/update 明细透传 module_id + **归属校验**（has_module=true→module_id 必填且属同 plan_node；false→null；违例 400）；`update_plan_node` 强制忽略 has_module。（覆盖 FR-001/FR-004，D-001/D-004）
- [ ] task-04: router — `GET /plan-node/{id}/details` 加可选 module_id query；其余端点签名不变。（覆盖 FR-004）
- [ ] task-05: 后端测试 — has_module 不可改、明细归属校验（正/反例）、按 module_id 过滤；`ruff format/check` + `mypy app` + `pytest` 过。（覆盖 FR-001/FR-004/FR-006）

### Wave 2 — 前端（依赖 Wave 1 的 API + 类型）
- [ ] task-06: types — `types.ts`：PlanNode + has_module；PlanNodeCreate 加 has_module；PlanNodeUpdate 不含；PlanNodeDetail/Create/Update 加 module_id。（覆盖 FR-001/FR-004）
- [ ] task-07: plan-nodes 页重写 — 母表加「是否有模块」列；展开行条件渲染（has_module=false→DetailsSubTable 挂 plan_node_id 二层；has_module=true→ModulesSubTable antd Table→模块 expandRender→DetailsSubTable 挂 module_id 三层）；明细复用 PpmSubTable editable + 固定 scroll.x + DETAIL_COLUMNS 列宽压缩。（覆盖 FR-002/FR-003/FR-004，D-002/D-003）
- [ ] task-08: 抽屉 antd 化 — NodeFormDrawer 原生 input → antd Form/Input/InputNumber + Switch（has_module，编辑态 disabled）；ModuleFormDrawer 原生 input → antd Form/Input/DatePicker。（覆盖 FR-001/FR-005）
- [ ] task-09: 前端测试 + 部署 — vitest + tsc --noEmit + pnpm lint 过；rebuild frontend+backend Docker 部署；浏览器验收（二层/三层/antd 表单/归属校验/milestone-details 不回归）。**前置**：先归档 `2026-07-16-plan-node-subtable-style`（R-05）。（覆盖 FR-005/FR-006）

## 依赖关系
- **Wave 2 依赖 Wave 1**：前端 types/页面依赖后端 has_module/module_id API + schema。
- task-07、task-08 依赖 task-06（types）。
- task-09 依赖 task-06/07/08，且前置归档 `2026-07-16-plan-node-subtable-style`（避免两变更都改 plan-nodes/page.tsx 冲突）。
- Wave 1 内部：task-01（model+migration）→ task-02（schema）→ task-03（service）→ task-04（router）→ task-05（测试）。

## 验收
- has_module 新建必填、保存后不可改（后端 update 忽略 + 前端 Switch disabled，测试覆盖）。
- 有模块模板展开 → 模块子表 → 模块展开 → 明细子表（挂 module_id，行内编辑保存）。
- 无模块模板展开 → 明细子表（挂 plan_node_id，行内编辑保存）。
- 明细 module_id 归属违例被后端拒绝（400，测试覆盖正/反例）。
- 模板/模块抽屉全 antd 控件，无原生 input。
- milestone-details 页模块 CRUD 行为不变（零回归）。
- 后端 ruff/mypy/pytest 过；前端 tsc/vitest/pnpm lint 过。

## 覆盖矩阵

| 决策 ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v1（has_module 新建定不可改） | task-01 / task-02 / task-03 / task-08 | PlanNodeUpdate 不含 has_module + service 忽略 + 前端 Switch disabled |
| D-002@v1（有模块明细挂 module_id 三层 + 行内编辑） | task-06 / task-07 | 三层条件展开 + 明细挂 module_id + PpmSubTable editable |
| D-003@v1（复用 PpmSubTable） | task-07 | 明细子表用 PpmSubTable editable（不新写） |
| D-004@v1（module_id 归属后端校验） | task-03 / task-05 | service 校验 + 正反例测试 |
