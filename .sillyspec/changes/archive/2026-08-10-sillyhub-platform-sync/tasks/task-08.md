---
id: task-08
title: local.yaml modules add platform_sync test config
title_zh: local.yaml modules 块补 platform_sync 的 test 配置
author: qinyi
created_at: 2026-08-10 23:45:00
priority: P1
depends_on: []
blocks: []
requirement_ids: []
decision_ids: []
allowed_paths:
  - .sillyspec/local.yaml
goal: >
  在 .sillyspec/local.yaml 的 modules 块补 platform_sync 的 path+test 配置，
  让 test_strategy=module 在 verify 阶段 git diff 命中 platform_sync 时有对应 test 命令可跑（R-02）。
implementation:
  - 编辑 .sillyspec/local.yaml，在 modules: 块下新增一行（对齐现有 12 条格式）：
    platform_sync: { path: "backend/app/modules/platform_sync/", test: "cd backend && uv run pytest app/modules/platform_sync -q --no-cov" }
  - 不动现有 ppm/auth/frontend/sillyhub-daemon/llm_provider/workspace/daemon/agent/skills/change_writer/change/mcp_gateway 等 12 条
acceptance:
  - local.yaml modules 块含 platform_sync 条目（path + test）
  - 现有 12 条 modules 配置不变
  - yaml 缩进/格式正确（与现有条目对齐）
verify:
  - cat .sillyspec/local.yaml | grep platform_sync（确认条目就位）
  - test_strategy=module verify 实测时 platform_sync 命中能跑 test（verify 阶段验证）
constraints:
  - 只加 platform_sync 一条，不动现有 modules 配置（R-02 措辞：未配 platform_sync，非只配 ppm）
  - test 命令格式对齐现有条目（cd backend && uv run pytest <path> -q --no-cov）
---
