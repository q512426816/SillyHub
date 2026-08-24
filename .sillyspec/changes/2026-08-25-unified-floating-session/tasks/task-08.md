---
id: task-08
title: 'full regression and verify report'
title_zh: '全量回归与验证报告'
author: 'qinyi'
created_at: 2026-08-25 03:14:30
priority: P0
depends_on: [task-01, task-02, task-03, task-04, task-05, task-06, task-07]
blocks: []
requirement_ids: [FR-1, FR-2, FR-3, FR-4, FR-5, FR-6]
decision_ids: []
allowed_paths:
  - .sillyspec/changes/2026-08-25-unified-floating-session/verify-result.md
goal: >
  对照 design 与 requirements 全量回归，落盘验证结论。
implementation:
  - backend pytest 回归 daemon 与 ppm 模块
  - frontend vitest 受影响目录加 tsc 加 eslint
  - verify-result.md 记录结果与遗留
acceptance:
  - 全绿或如实记录差异与原因
verify:
  - cd backend && python -m pytest app/modules/daemon/tests app/modules/ppm -q
constraints:
  - 不为通过测试修改既有断言（规则 9）
---
# task-08 验证
