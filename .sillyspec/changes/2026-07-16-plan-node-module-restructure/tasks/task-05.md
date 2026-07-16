---
id: task-05
title: "后端测试 — has_module 不可改、明细归属校验（正/反例）、按 module_id 过滤"
title_zh: 后端测试：覆盖 has_module 不可改、module_id 归属正反例、按 module_id 过滤
author: WhaleFall
created_at: 2026-07-16 12:25:00
priority: P1
depends_on: [task-01, task-02, task-03, task-04]
blocks: []
requirement_ids: [FR-001, FR-004, FR-006]
decision_ids: [D-001@v1, D-004@v1]
allowed_paths:
  - backend/app/modules/ppm/plan/tests/test_service.py
  - backend/app/modules/ppm/plan/tests/test_router.py
goal: >
  用测试覆盖 has_module 不可改、明细 module_id 归属校验正反例、按 module_id 过滤三类核心行为。
implementation:
  - test_service.py 加用例：update_plan_node 传 has_module 不生效（不可改）。
  - test_service.py 加用例：has_module=true 明细 module_id 缺失/指向别的 plan_node 模块 → 400（反例）。
  - test_service.py 加用例：has_module=true 明细 module_id 属同 plan_node 模块 → 成功（正例）。
  - test_service.py 加用例：has_module=false 明细带 module_id → 400；module_id=null → 成功。
  - test_service.py / test_router.py 加用例：list 按 module_id 过滤返回正确子集。
acceptance:
  - 上述正反例测试全部通过。
  - 既有 plan 测试不回归。
verify:
  - cd backend && ruff format app/modules/ppm/plan/tests
  - cd backend && ruff check app/modules/ppm/plan/tests
  - cd backend && mypy app/modules/ppm/plan
  - cd backend && pytest app/modules/ppm/plan/tests
constraints:
  - 非测试逻辑本身有误时，禁止改实现凑通过（CLAUDE.md 规则 9）。
  - 归属校验正反例都要覆盖（D-004）。
expects_from:
  - task-03: service 归属校验与 module_id 过滤
  - task-04: router module_id query
---

plan.md task-05：见 design §10 R-02/R-03（测试证据）、decisions D-001/D-004。
