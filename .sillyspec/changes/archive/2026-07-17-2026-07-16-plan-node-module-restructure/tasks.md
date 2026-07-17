---
author: WhaleFall
created_at: 2026-07-16T11:32:00
---

# 任务（Tasks）— 计划节点模板模块结构改造

> 变更 `2026-07-16-plan-node-module-restructure` · scale: large · 实现路径：plan → execute → verify
> 依据：`design.md` §5/§6/§7；分 2 个 Wave

> ⚠️ **v2/v3/v4 需求迭代**（见 design §13 + 本文档末尾「需求变更 v2/v3」章节）：下方 task 描述为 v1（含三层 / ModuleFormDrawer / has_module 不可改 等**已被取代**的内容），实际实现以 v2/v3 章节为准——task-07 统一二层明细、task-08 仅 NodeFormDrawer、has_module 编辑可改、列表按编号正序。

## Wave 1 — 后端（数据模型 + API + 测试）

### task-01 模型 + migration
- `backend/app/modules/ppm/plan/model.py`：PlanNode + `has_module: bool`（default false）；PlanNodeDetail + `module_id: uuid|None` + `Index("ix_ppm_plan_node_detail_module", "module_id")`。
- 新增 `backend/migrations/versions/<ts>_plan_node_has_module_detail_module_id.py`：ALTER ppm_plan_node ADD has_module（default false）；ALTER ppm_plan_node_detail ADD module_id + 索引。
- 覆盖：FR-001/FR-004

### task-02 schema
- `schema.py`：PlanNodeBase/Create 加 has_module（Create 必填）；PlanNodeUpdate 不含 has_module；PlanNodeResp 加 has_module。PlanNodeDetailBase/Create/Update/Resp 加 module_id。
- 覆盖：FR-001/FR-004

### task-03 service（含校验）
- `service.py`：`list_plan_node_details_by_node(plan_node_id, module_id=None)` 加可选过滤；create/update 明细透传 module_id + **归属校验**（has_module=true→module_id 必填且属同 plan_node；false→null；违例 400）；`update_plan_node` 强制忽略 has_module。
- 覆盖：FR-001/FR-004

### task-04 router
- `router.py`：`GET /plan-node/{id}/details` 加可选 `module_id` query；其余端点签名不变。
- 覆盖：FR-004

### task-05 后端测试
- `tests/test_service.py` / `test_router.py`：has_module 不可改（update 忽略）、明细归属校验（正/反例）、按 module_id 过滤查询。
- `ruff format/check` + `mypy app` + `pytest` 过。
- 覆盖：FR-001/FR-004/FR-006

## Wave 2 — 前端（types + 页面重写 + antd 化）

### task-06 前端类型
- `frontend/src/lib/ppm/types.ts`：PlanNode + has_module；PlanNodeCreate 加 has_module；PlanNodeUpdate 不含；PlanNodeDetail/Create/Update 加 module_id。
- 覆盖：FR-001/FR-004

### task-07 plan-nodes 页重写（母表 + 条件展开 + 三层）
- `frontend/src/app/(dashboard)/ppm/plan-nodes/page.tsx`：母表加「是否有模块」列；展开行条件渲染（has_module=false→DetailsSubTable 挂 plan_node_id 二层；has_module=true→ModulesSubTable antd Table→模块 expandRender→DetailsSubTable 挂 module_id 三层）；明细复用 PpmSubTable editable，固定 scroll.x + DETAIL_COLUMNS 列宽压缩。
- 覆盖：FR-002/FR-003/FR-004

### task-08 抽屉 antd 化
- NodeFormDrawer：原生 input → antd Form/Input/InputNumber + Switch（has_module，编辑态 disabled）。
- ModuleFormDrawer：原生 input → antd Form/Input/DatePicker（PpmUserSelect 已 antd）。
- 覆盖：FR-001/FR-005

### task-09 前端测试 + 部署
- vitest（plan-nodes 相关）、tsc --noEmit、pnpm lint 过。
- rebuild frontend + backend Docker 部署；浏览器验收（二层/三层、antd 表单、归属校验、milestone-details 不回归）。
- **前置**：先归档 `2026-07-16-plan-node-subtable-style` 变更（R-05）。
- 覆盖：FR-005/FR-006

## 需求变更 v2（2026-07-16，见 design §13）

has_module 从「驱动展开」降级为「纯记录」。对应 task 调整：

- **task-03**（service 校验）：`_validate_detail_module` 简化——has_module 不参与，仅保留 module_id 非 null 时属同 plan_node 的防御校验；module_id=null 一律放行。
- **task-07**（plan-nodes 页）：展开行**统一只渲染 DetailsSubTable**（二层，挂 plan_node_id），不论 has_module；模块子表从该页移除。~~三层条件展开取消~~。
- **task-08**（抽屉 antd 化）：NodeFormDrawer 保留（has_module Switch 记录用）；~~ModuleFormDrawer 从该页删除~~（模块子表移除）。
- **task-05**（测试）：归属校验用例更新（has_module 不再驱动必填/禁用）。
- task-01/02/04/06/09 不变（model/schema/router/migration/types/部署保留）。

## 需求变更 v3（2026-07-16，见 design §13）

D-001 取消——has_module **编辑时可改**（不再新建定不可改）。对应 task 调整：

- **task-02**（schema）：`PlanNodeUpdate` 加 `has_module` 字段（可选）。
- **task-03**（service）：`update_plan_node` 移除「强制 pop has_module」逻辑，允许透传更新。
- **task-08**（抽屉）：`NodeFormDrawer` 的 has_module Switch 移除 edit 态 `disabled`；`handleSaveNode` edit 模式传 has_module。
- **task-05**（测试）：原 `test_update_plan_node_ignores_has_module`（service+router）改为「可改」。
- 前端 types：`PlanNodeUpdate` 加 `has_module?: boolean | null`。
