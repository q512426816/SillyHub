---
id: task-04
title: service create_module 复制模板明细（反查 template_plan_node_id → 复制 PlanNodeDetail draft）
author: WhaleFall
created_at: 2026-07-17 11:02:17
priority: P0
depends_on: [task-01, task-02]
blocks: [task-05]
requirement_ids: [FR-004]
decision_ids: [D-004@v1]
allowed_paths:
  - backend/app/modules/ppm/plan/service.py
goal: >
  扩展 create_module：建 PlanNodeModule 后，反查里程碑 PsPlanNode.template_plan_node_id →
  命中模板则复制模板全部 PlanNodeDetail 到新模块（plan_node_id=里程碑.id, module_id=新模块.id,
  status=draft）；无模板（手动里程碑 template_plan_node_id=null）则空模块不复制。同事务单 commit。
implementation:
  - 现状 create_module（service.py:365-366）直接 `await _Crud(self._session, PlanNodeModule).create(data)`，该路径自带单独 commit——需重构为原子事务（参考 create_detail / import_commit 写法：session.add + 末尾单次 commit），保证建模块 + 复制明细在同一事务
  - 取 data["plan_node_id"] 经 `_safe_uuid` 规整为 UUID，反查 PsPlanNode（_Crud(PsPlanNode).get 或 session.get）；读其 template_plan_node_id
  - template_plan_node_id 非空：查模板 PlanNodeDetail（`select(PlanNodeDetail).where(plan_node_id == template_plan_node_id).order_by(no)`，复用 list_plan_node_details_by_node 语义——模板不分模块全量复制，D-004）；逐条构造 PsPlanNodeDetail（id=uuid4, plan_node_id=里程碑.id, module_id=新模块.id, status=PlanNodeDetailStatus.DRAFT.value, 复制 detailed_stage/no/task_theme/task_description/requirements/role_name/achievement/overall_stage, created_at/updated_at=_now()），session.add 批量挂
  - template_plan_node_id 为空（手动里程碑）：空模块，不复制任何明细
  - 末尾 await self._session.commit() 单次提交；异常冒泡不 commit 即整体回滚（对齐 import_commit R-07 原子语义）
  - 不复用 create_detail（其内部单独 commit + DONE 时触发 _ensure_task_for_detail 建任务）；复制模板明细为 draft，不触发状态机、不建任务
  - PlanNodeModule 汇总字段（plan_workload/plan_begin_time/plan_complete_time/duty_user_id/plan_type）由前端表单 body 透传 data 落库，本任务不重算（与 import_commit 的 _build_module 聚合不同，此处只建一个空壳模块 + 复制明细）
acceptance:
  - 有模块里程碑（template_plan_node_id 非空）新建模块 → 模块建成 + 模板全部 PlanNodeDetail 复制为该模块下 PsPlanNodeDetail（module_id=新模块.id, status=draft）
  - 手动里程碑（template_plan_node_id=null）新建模块 → 模块建成，明细为空
  - 复制出的明细 plan_node_id 指向里程碑.id（非模板.id），module_id 指向新模块.id
  - 建模块 + 复制明细同事务，任一步失败整体回滚，无脏数据
verify:
  - cd backend && python -m pytest tests/modules/ppm/plan/test_service.py -q（create_module 复制场景：模板里程碑复制明细 / 手动里程碑空模块）
  - ruff format/check + mypy 过（对齐 task-05）
constraints:
  - 同事务单 commit（不改 _Crud.create 签名，仅 create_module 内联原子化）
  - 模板 PlanNodeDetail 不分模块、全量复制到新模块（D-004@v1，模板本身不分模块）
  - 复制明细 status 固定 draft，不触发状态机、不联动建任务（FR-01 建任务仅发生在明细推进到 done 时）
  - 仅改 create_module；不动 create_detail / import_commit / 其他 CRUD
---

