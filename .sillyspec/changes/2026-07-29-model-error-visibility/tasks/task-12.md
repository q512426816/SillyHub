---
id: task-12
title: local.yaml modules 块加 backend daemon + agent 子模块条目
title_zh: local.yaml 增加 daemon 与 agent 子模块测试条目
author: qinyi
created_at: 2026-07-29 10:34:02
priority: P1
depends_on: []
blocks: []
requirement_ids: []
decision_ids: []
allowed_paths:
  - .sillyspec/local.yaml
goal: >
  local.yaml modules 块补 backend daemon + agent 子模块 test 条目，防 verify fallback backend 全量预存 errors。
implementation:
  - .sillyspec/local.yaml modules 块加 daemon 条目（path 指向 backend/app/modules/daemon/，test 命令跑该模块测试）
  - 加 agent 条目（path 指向 backend/app/modules/agent/，test 命令跑该模块测试）
  - test 命令格式对齐既有 ppm/auth 条目（cd backend && uv run pytest <path> -q --no-cov）
  - 先确认 daemon/agent 模块测试实际目录（app/modules/*/tests 或 tests/modules/*）再定 path
acceptance:
  - modules 块含 daemon 与 agent 两个条目且 test 命令可执行
  - git diff 命中 daemon/agent 模块时 verify 跑对应子模块测试，不 fallback 全量
verify:
  - cat .sillyspec/local.yaml 确认 modules 含 daemon 与 agent 条目
  - cd backend && uv run pytest app/modules/daemon -q --no-cov（确认 test 命令有效）
constraints:
  - 不改既有 ppm/auth/frontend/sillyhub-daemon/llm_provider/workspace 条目
  - test 命令按实际测试目录（先核实，既有 auth 用 tests/modules/auth）
---
