---
id: task-03
title: "service — list_plan_node_details_by_node 加可选 module_id 过滤；create/update 明细透传+归属校验；update_plan_node 忽略 has_module"
title_zh: service 层：明细按 module_id 过滤、module_id 归属校验（违例 400）、强制忽略 has_module 更新
author: WhaleFall
created_at: 2026-07-16 12:25:00
priority: P0
depends_on: [task-01, task-02]
blocks: [task-04, task-05]
requirement_ids: [FR-001, FR-004]
decision_ids: [D-001, D-004]
allowed_paths:
  - backend/app/modules/ppm/plan/service.py
goal: >
  明细查询支持按 module_id 过滤，create/update 明细做 module_id 归属校验（违例 400），update_plan_node 强制忽略 has_module。
implementation:
  - list_plan_node_details_by_node(plan_node_id, module_id=None) 加可选 module_id 过滤（None=全部/挂模板，非 None=该模块下明细）。
  - create_plan_node_detail / update_plan_node_detail 透传 module_id，并做归属校验（D-004）：has_module=true→module_id 必填且属同 plan_node 的模块；has_module=false→module_id 必须为 null；违例抛 400。
  - update_plan_node 强制忽略入参中的 has_module 字段（D-001，不透传到更新）。
acceptance:
  - list 按 module_id=None 返回全部/挂模板明细，按具体 module_id 仅返回该模块明细。
  - has_module=true 模板下明细 module_id 缺失或指向别的 plan_node 的模块时返回 400。
  - has_module=false 模板下明细带 module_id 时返回 400。
  - update_plan_node 即便入参带 has_module 也不更新该字段。
verify:
  - cd backend && ruff check app/modules/ppm/plan/service.py
  - cd backend && mypy app/modules/ppm/plan/service.py
  - cd backend && pytest app/modules/ppm/plan/tests/test_service.py
constraints:
  - 归属校验放 service 层（D-004），不在 schema 层。
  - has_module 不可改只靠 service 忽略（前端 disabled 可被绕，R-02）。
  - 不改 PlanNodeModule CRUD 与共用查询逻辑。
expects_from:
  - task-02: PlanNodeCreate/Update/Resp + PlanNodeDetail schema 字段
  - task-01: PlanNode.has_module / PlanNodeDetail.module_id model
---

plan.md task-03：见 design §5.1（归属一致性校验）、§5.2（查询）、§10 R-02/R-03、decisions D-001/D-004。
