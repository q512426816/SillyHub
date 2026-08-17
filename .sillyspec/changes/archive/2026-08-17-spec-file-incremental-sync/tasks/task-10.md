---
author: qinyi
created_at: 2026-08-17 10:20:00
repo: main
id: task-10
title: verify regression and docs
title_zh: verify 全量回归与模块文档更新
goal: 完成 backend/frontend/CLI 回归测试，更新模块文档，产出 verify-result.md。
implementation: |
  1. main 仓回归：backend pytest（platform_sync + spec_workspace）+ frontend vitest。
  2. sillyspec 仓回归：CLI 测试套件。
  3. 更新 .sillyspec/docs/multi-agent-platform/modules/sillyspec.md 与 platform_sync.md。
  4. 产出 verify-result.md。
acceptance: |
  - backend/frontend/CLI 测试全绿；
  - tsc 0 错误；
  - verify-result.md 结论 PASS。
verify: pytest + vitest + node test/*
constraints: |
  - 非测试逻辑本身有误时禁止改测试通过。
allowed_paths:
  - .sillyspec/docs/multi-agent-platform/modules/sillyspec.md
  - .sillyspec/docs/multi-agent-platform/modules/backend.md
  - backend/app/modules/platform_sync/tests/
---

# task-10 verify 全量回归与模块文档更新
