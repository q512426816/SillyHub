---
schema_version: 1
doc_type: task
id: task-16
title: Full test and lint acceptance
title_zh: 全量测试与 lint 验收
author: qinyi
created_at: 2026-08-19T06:45:00+00:00
change_name: 2026-08-19-runtime-live-daemon-read
wave: 16
allowed_paths:
  - backend/app/modules/runtime
  - sillyhub-daemon/src
  - frontend/src/app/(dashboard)/workspaces/[id]/runtime
  - sillyspec/src
  - sillyspec/tests
goal: 所有改动通过测试与 lint
implementation: 分别跑 backend pytest、daemon vitest、frontend vitest、各 lint/typecheck
acceptance: backend runtime pytest 绿；daemon vitest 绿；frontend vitest 绿；ruff/mypy/eslint/tsc 干净
verify: local.yaml test/lint 命令；按 module subset 命中 runtime 时跑对应测试
constraints: 失败时修逻辑不修测试
---

# task-16：全量测试与 lint 验收
