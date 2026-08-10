---
id: task-06
title: 测试 incident 转换校验（test_fsm.py：合法边全覆盖 + 非法边拒 422 + 重开清字段 + 同态幂等 + resolved→resolved 不刷时间戳）
title_zh: 测试 incident 转换校验
author: qinyi
created_at: 2026-08-09 21:54:41
priority: P0
depends_on: [task-02]
blocks: []
requirement_ids: [FR-01, FR-02, FR-03, FR-04, FR-05, FR-06]
decision_ids: [D-001@v1, D-002@v1, D-006@v1]
allowed_paths:
  - backend/app/modules/incident/tests/test_fsm.py
expects_from:
  task-02:
    - contract: INCIDENT_TRANSITIONS
      needs: [open, investigating, mitigated, resolved]
goal: >
  新建 test_fsm.py 覆盖 incident 放宽版图全部合法边 + 关键非法边 + 重开清字段 + 同态幂等 + resolved→resolved 不刷时间戳。
implementation:
  - 新建 incident/tests/test_fsm.py
  - 合法边全覆盖(open→investigating/open→resolved/investigating→mitigated/investigating→open/investigating→resolved/mitigated→resolved/mitigated→investigating/resolved→investigating)
  - 非法边拒 422(open→mitigated/mitigated→open/resolved→open/resolved→mitigated)
  - 重开清字段断言 resolved_at/resolved_by 均 None
  - 同态幂等 open→open 不报错
  - resolved→resolved 幂等不刷新 resolved_at(Grill P2-3)
  - 值非法仍 400 互补
acceptance:
  - AC-1/3/4/5
  - pytest app/modules/incident/tests/test_fsm.py 全绿
  - ruff format
verify:
  - cd backend && pytest app/modules/incident/tests/test_fsm.py -q && ruff check app/modules/incident/tests/test_fsm.py
constraints:
  - 复用 _make_workspace/_make_user helper（同 test_service.py 风格）
  - 不改动 test_service/test_router 既有断言
---
合法边 9 条、非法边 4 条与 task-02 版图严格对应。resolved→resolved 时间戳不刷新是 P2-3 防回归点。
