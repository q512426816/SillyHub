---
id: task-02
title: incident 状态机转换校验（INCIDENT_TRANSITIONS 放宽版图 + update() 插入 assert_transition + 重开清字段）
title_zh: incident 状态机转换校验
author: qinyi
created_at: 2026-08-09 21:54:41
priority: P0
depends_on: []
blocks: [task-06]
requirement_ids: [FR-01, FR-02, FR-03, FR-04, FR-05, FR-06]
decision_ids: [D-001@v1, D-002@v1, D-006@v1]
allowed_paths:
  - backend/app/modules/incident/service.py
  - backend/app/modules/incident/tests/test_service.py
  - backend/app/modules/incident/tests/test_router.py
provides:
  - contract: INCIDENT_TRANSITIONS
    fields: [open, investigating, mitigated, resolved]
goal: >
  给 incident update() 加合法转换校验，堵任意互跳/终态复活，重开清解决字段，非法转换 422，现有测试零破坏。
implementation:
  - 模块级加 INCIDENT_TRANSITIONS={open:{investigating,resolved},investigating:{mitigated,open,resolved},mitigated:{resolved,investigating},resolved:{investigating}}
  - import from app.modules.ppm.common.fsm import assert_transition
  - update() status 分支按序：值∉VALID_STATUSES→IncidentError(400)→同状态幂等跳过→assert_transition(incident.status,target,INCIDENT_TRANSITIONS,entity='incident',entity_id=incident.id)非法抛 InvalidTransition(422)→进 resolved 写 resolved_at/by、离开 resolved 清两字段→赋值
  - severity/description 等分支不动
acceptance:
  - test_update_invalid_status 仍 400
  - 非法跳转(open→mitigated/resolved→open)抛 InvalidTransition 422
  - resolved→investigating 清 resolved_at/by
  - open→open 幂等放行
  - 现有 test_service/test_router 全绿
verify:
  - cd backend && pytest app/modules/incident -q && ruff check app/modules/incident/service.py
constraints:
  - 不改 router（InvalidTransition 由全局 handler 映射 422）
  - 不改 schema/DTO
  - 放宽版图保现有 open→investigating/resolved 用例绿（已 Grill X-01 核实）
---
放宽版图允许 open 直跳 resolved、resolved 反跳 investigating（重开），仅堵任意互跳与终态复活外的路径。
