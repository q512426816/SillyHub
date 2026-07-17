---
author: WhaleFall
created_at: 2026-07-17T11:02:17
priority: P0
depends_on: [task-01, task-02]
blocks: [task-05]
requirement_ids: [FR-001, FR-002, FR-003]
decision_ids: [D-001@v1, D-002@v1, D-003@v1]
allowed_paths: [backend/app/modules/ppm/plan/service.py]
---

# TaskCard — task-03 service create_ps_project_plan 批量建里程碑

## 目标

扩展 `PlanService.create_ps_project_plan`（service.py:412-422）：建 PsProjectPlan 后，同事务查全部 PlanNode 模板（按 no asc）批量建 PsPlanNode；has_module=无复制模板明细 PlanNodeDetail→PsPlanNodeDetail（status=draft）/ 有只建空里程碑。覆盖 FR-001/002/003、D-001/002/003。

## 依据

- design.md §5.2（create_ps_project_plan 扩展 3 步）、§2（设计目标 1-3）、§10 R-04（模板空边界）。
- plan.md task-03（plan.md:24）+ 决策覆盖（plan.md:50-52）。
- 现状：service.py:412-422 仅建主表 + project_name 兜底，末尾走 `_Crud(...).create(data)`（service.py:412→162-168）单次 commit。
- 同事务原子范式：参照 `import_commit`（service.py:1156-1262）—— `session.add()` 批量挂对象 + 末尾单次 `commit()`，异常冒泡不 commit 即回滚。

## implementation

1. 保留现有 project_name 兜底逻辑（412-421）。
2. **不走** `_Crud.create`（其内部 `commit()` 会提前落库，破坏原子性）；改为手动 `PsProjectPlan(id=uuid.uuid4(), **data)` + `_set_created_updated` 等价手填 `created_at/updated_at=_now()` + `session.add(plan)`，先不入库。
3. `select(PlanNode).order_by(PlanNode.no)`（asc，D-002 全量不筛选）取模板列表。
4. 遍历模板，每个建 `PsPlanNode`：
   - `id=uuid.uuid4()`、`ps_project_plan_id=plan.id`、`template_plan_node_id=模板.id`、`has_module=模板.has_module`、`overall_stage=模板.overall_stage`、`no=str(模板.no)`（**显式 str()**，int→str 类型适配，PlanNode.no=int / PsPlanNode.no=str）、`task_theme=None`、`created_at/updated_at=_now()`。
   - `session.add(node)`。
   - **has_module=false**：`select(PlanNodeDetail).where(plan_node_id==模板.id).order_by(no)` 取模板明细，逐条建 `PsPlanNodeDetail`（`id=uuid.uuid4()`、`plan_node_id=node.id`、`module_id=None`、`status=PlanNodeDetailStatus.DRAFT.value`、其余展示字段从模板明细复制、`created_at/updated_at=_now()`），`session.add(detail)`。明细 draft 不走 `_transition`/状态机，不建任务。
   - **has_module=true**：跳过明细，里程碑空。
5. 末尾**单次** `await session.commit()` + `await session.refresh(plan)`；任一步异常冒泡 → 不 commit → 整体回滚（无脏数据）。

## acceptance

- 新建项目计划后：里程碑数 == PlanNode 模板数，顺序按 no asc。
- has_module=false 里程碑：含 N 条 PsPlanNodeDetail（== 模板明细数），全部 status=draft，module_id=null。
- has_module=true 里程碑：无明细（空里程碑）。
- PsPlanNode.no 为 str 类型（模板 no int 经 str()）。
- 整体原子：模板查询/明细复制任一失败 → 不建任何里程碑/计划（回滚）。

## verify

```
cd backend && pytest app/modules/ppm/plan/tests/test_service.py -q
```

## constraints

- 同事务原子（参照 import_commit 单 commit 范式，不复用 `_Crud.create` 的每次 commit）。
- `PlanNode.no`（int）→ `PsPlanNode.no`（str）必须显式 `str()`，勿依赖隐式转换。
- 明细一律 draft，**不触发状态机**（不走 `_transition`/`save_process`），故 draft 不建 PlanTask。
- 无模板时项目计划照建（R-04，里程碑空，接受）。
- allowed_paths 仅 service.py；model/schema/migration 属 task-01/02，本任务不碰。
