---
id: task-01
title: plan/service.py 新增联动 helper 方法集（_ensure_task_for_detail / _sync_task_fields / _migrate_task_to_version / _unlink_task / _resolve_project_context / _lookup_user_name，复用 self._session、不单独 commit）
title_zh: 新增明细-任务联动 helper 方法集
author: WhaleFall
created_at: 2026-07-15 19:29:30
priority: P0
depends_on: []
blocks: [task-02, task-03, task-04, task-05, task-06]
requirement_ids: [FR-01]
decision_ids: [D-002@v1, D-003@v1]
allowed_paths:
  - backend/app/modules/ppm/plan/service.py
provides:
  - contract: PlanService detail-task 联动 helper 方法集
    fields: [_ensure_task_for_detail, _sync_task_fields, _migrate_task_to_version, _unlink_task, _resolve_project_context, _lookup_user_name]
expects_from: {}
goal: >
  在 PlanService 内补 6 个私有 helper，为后续明细状态机联动任务提供同事务基础设施（不单独 commit）。
implementation:
  - 确认 import：PlanTask 已在 service.py:68 引入，PpmProjectMember 在 line 67 引入；无需新增 import，跳过该步。
  - 在 PlanService 类内新增 _resolve_project_context(plan_node_id)：select(PsProjectPlan).join(PsPlanNode) 回溯，返回 (project_id, project_name)；plan_node_id 为空或查无返回 (None, None)。
  - 新增 _lookup_user_name(user_id)：select(PpmProjectMember.user_name).where(user_id==...).limit(1)，口径对齐 kanban/service.py:543；查无返回 None。
  - 新增 _ensure_task_for_detail(detail)：execute_user_id 空→返回 None（D-003）；select(PlanTask).where(ps_plan_node_detail_id==detail.id) 命中则走字段同步分支，未命中则 new PlanTask(status="未开始")，kanban_order 取该 user 现有 max(kanban_order)+1（select(func.max()) 空取 0+1）；字段映射 user_id/user_name←execute_user_id+_lookup_user_name、content←task_theme、start_time/end_time←plan_begin_time/plan_complete_time、work_load←plan_workload、project_id/project_name←_resolve_project_context(detail.ps_plan_node_id)、module_id←detail.module_id；不 commit。
  - 新增 _sync_task_fields(detail)：查关联任务命中则同步上述字段（不含 status），未命中不建、直接返回 None。
  - 新增 _migrate_task_to_version(old_id, new_id)：select(PlanTask).where(ps_plan_node_detail_id==old_id) 命中则置 = new_id。
  - 新增 _unlink_task(detail_id)：关联任务 ps_plan_node_detail_id 置 None（任务保留不删）。
  - 全部复用 self._session.add / execute，禁止 await self._session.commit()；commit 由 _transition/save_process 等调用方统一执行。
acceptance:
  - PlanService 含 6 个私有 async 方法，签名与 design 语义一致。
  - helper 内无任何 self._session.commit() / flush() 调用，仅 add/query。
  - execute_user_id 为空时 _ensure_task_for_detail 返回 None 且不写库（D-003）。
  - _lookup_user_name 查 PpmProjectMember.user_name（非 User.display_name）。
  - kanban_order 取该 user 现有 max+1，无记录时为 1。
verify:
  - cd backend && ruff check app/modules/ppm/plan/service.py
  - cd backend && mypy app/modules/ppm/plan/service.py
constraints:
  - 复用 self._session，helper 内不单独 commit（由调用方统一 commit，保证强一致）
  - execute_user_id 为空时 _ensure_task_for_detail 返回 None 不建任务（D-003）
  - 姓名反查用 PpmProjectMember.user_name（与 kanban 同口径）
---
