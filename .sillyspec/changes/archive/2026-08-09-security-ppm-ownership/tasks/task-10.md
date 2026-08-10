---
id: task-10
title: CONCERNS.md PPM 冒名条目标 ✅ + backend.md 变更索引 + ppm 全量回归
title_zh: 文档同步与回归
priority: P1
depends_on: [task-07, task-08, task-09]
blocks: []
requirement_ids: [NFR-01]
decision_ids: [D-001@v1, D-006@v1]
allowed_paths:
  - .sillyspec/docs/SillyHub/scan/CONCERNS.md
  - .sillyspec/docs/multi-agent-platform/modules/backend.md
created_at: 2026-08-10 00:22:00
author: qinyi
goal: >
  收尾：CONCERNS.md「2026-08-08 多代理审计」PPM 冒名条目标 ✅ 已修复（change 2026-08-09-security-ppm-ownership）+ 修复手段摘要；backend.md 模块卡片变更索引加 change-3 条目（ppm/common/ownership.py ownership 校验 + 7 端点 actor 透传 + 测试）。跑 ppm 全量回归确认零回归。
provides:
  - contract: docs-synced
    fields: [CONCERNS.md, backend.md]
expect_from:
  - contract: ownership-tests
    from: task-07
    fields: [test_ownership.py]
  - contract: task-tests-patched
    from: task-08
    fields: [test_task.py actor stub]
  - contract: problem-tests-patched
    from: task-09
    fields: [test_problem_flow.py actor stub]
related_tests: []
implementation:
  - CONCERNS.md：PPM 代填冒名条目（line 待核）标 ✅ 已修复 + change 名 + 手段摘要（service 层 resolve_owner，非 admin 代填→403，admin 放行）；保留 change-1/change-2 既有标记不动
  - backend.md：变更索引加 change-3 条目（ppm/common/ownership.py + 7 端点 actor 透传 + test_ownership/test_task/test_problem_flow stub）
  - 全量回归：cd backend && uv run pytest app/modules/ppm -q --no-cov 确认全绿
acceptance:
  - AC-6 ppm 模块全量回归全绿（test_router 零改动 + test_task/test_problem_flow 补 stub + test_ownership 新增）
  - NFR-01 文档同步落实
verify:
  - cd backend && uv run pytest app/modules/ppm -q --no-cov
constraints:
  - 只动 CONCERNS.md PPM 冒名条目 + backend.md 变更索引，不碰其他条目（change-1/2 标记保留）
  - 文档改动符合既有格式（参照 change-1/2 在 CONCERNS/backend.md 的标记风格）
---
