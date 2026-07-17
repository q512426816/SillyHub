---
author: WhaleFall
created_at: 2026-07-17 11:02:17
priority: P0
depends_on: [task-03, task-04]
blocks: []
requirement_ids: [FR-001, FR-002, FR-003, FR-004, FR-007]
decision_ids: []
allowed_paths:
  - backend/app/modules/ppm/plan/tests/test_service.py
---

# task-05 后端测试 — 项目计划初始化从模板（create_ps_project_plan 批量建 + create_module 复制明细）

> 依据：design.md §5.2（create_ps_project_plan / create_module 扩展）、§10（风险 R-01~R-04 边界）；plan.md task-05（覆盖 FR-001~004/007）。
> 范围：仅 `backend/app/modules/ppm/plan/tests/test_service.py` 新增 `TestProjectPlanInitFromTemplate` 测试类，不改实现。

## implementation

在 `backend/app/modules/ppm/plan/tests/test_service.py` 末尾（`if __name__ == "__main__"` 之前）新增 `TestProjectPlanInitFromTemplate` 测试类，复用根 conftest 的 `db_session`（in-memory SQLite）fixture 与 `PlanService`，沿用现有 `uuid.uuid4()` / `await` / 断言风格：

1. **test_create_ps_project_plan_batch_init_milestones** — create_ps_project_plan 批量建里程碑（design §5.2、D-001/D-002/D-003、覆盖 FR-001/002/003/007）
   - 先建模板：2 个无模块 `PlanNode`（has_module=false，各挂 1~2 条 `PlanNodeDetail`）+ 1 个有模块 `PlanNode`（has_module=true，挂 1 个 `PlanNodeModule` 不复制明细）。
   - 新建项目计划 `create_ps_project_plan({"project_id": <uuid>, "project_name": "模板计划", "status": "draft"})`。
   - 断言：里程碑数 == 模板数（3）；顺序按模板 no asc（D-002）；每个 `PsPlanNode.template_plan_node_id` 指向对应模板；`has_module` 冗余自模板（D-005）。
   - 断言无模块里程碑：`list_plan_node_details_by_node(ps_node.id)` 返回 draft 明细，条数 == 模板明细数，`status == PlanNodeDetailStatus.DRAFT.value`，`module_id is None`（无模块模板 module_id=null）。
   - 断言有模块里程碑：明细为空（只建空里程碑）。

2. **test_no_int_to_str** — PlanNode.no（int）→ PsPlanNode.no（str）显式 str()（plan.md task-03 注意点、覆盖 FR-002）
   - 模板 `create_plan_node({"overall_stage": "立项", "no": 1})`（int 1）→ 新建项目计划 → 断言生成 `PsPlanNode.no == "1"`（字符串），不是 int。

3. **test_create_module_copies_template_details** — create_module 复制模板明细（design §5.2、D-004、覆盖 FR-004）
   - 模板：has_module=true 的 `PlanNode` 挂 2 条 `PlanNodeDetail`；新建项目计划生成有模块里程碑（空明细）。
   - 对该里程碑 `create_module({"plan_node_id": <ps_node_id>, "module_name": "前端"})`。
   - 断言：反查 `template_plan_node_id` 后复制模板明细；`list_plan_node_details_by_node(ps_node.id, new_module.id)` 返回 2 条 draft，`module_id == 新模块.id`，`status == DRAFT`，task_theme/no 与模板一致。

4. **test_create_module_on_manual_milestone_is_empty** — 手动里程碑（template_plan_node_id=null）新建模块为空（design §5.2 step 4、R-04 边界、覆盖 FR-004）
   - 直接 `create_ps_plan_node` 手动建里程碑（template_plan_node_id=null）→ `create_module` → 断言该模块下 `list_plan_node_details_by_node` 为空（无模板不复制）。

## acceptance

- 全部 4 条新用例通过，覆盖正/反/边界（批量正例、int→str 边界、复制正例、无模板空边界）。
- 明细 `status == PlanNodeDetailStatus.DRAFT.value` 显式断言（design §5.2 status=draft 硬约束）。
- 零回归：现有 `test_service.py` 全部用例（TestPlanNodeCrud / TestSubTables / TestPsProjectPlan / TestSaveProcess / TestChangeProcess 等）保持通过，不破坏既有断言。

## verify

```
cd backend && ruff format app/modules/ppm/plan/tests/
cd backend && ruff check app/modules/ppm/plan/
cd backend && mypy app/modules/ppm/plan/
cd backend && pytest app/modules/ppm/plan/tests/ -q
```

## constraints

- 用 `db_session`（in-memory SQLite）fixture，不连真实库；沿用现有 `_ACTOR` 常量与 async 测试风格。
- 不破坏现有测试：新增类追加在文件末尾，不改既有类/方法签名。
- 明细 `status=draft` 必须断言；`module_id` 归属（无模块=null、复制=新模块）必须断言。
- PsPlanNode 字段名以 task-01 实现为准：`template_plan_node_id`、`has_module`；明细 status 枚举用 `PlanNodeDetailStatus.DRAFT.value`。
