---
id: task-09
title: 全量验证（vitest 零回归 + grep 残留引用）
author: qinyi
created_at: 2026-07-07 23:26:42
priority: P0
depends_on: [task-08]
blocks: []
requirement_ids: [FR-05, NFR-01]
decision_ids: [D-001@v1]
allowed_paths:
  - sillyhub-daemon
goal: >
  代码改完后跑全量测试 + 残留引用扫描，确认零回归 + dead code 清理干净。
implementation:
  - cd sillyhub-daemon && pnpm test（全量 vitest）
  - grep -r "PLATFORM_CONFIG_FILENAME|writePlatformConfig|readPlatformConfig|PlatformConfig" sillyhub-daemon/src（零命中，注释除外）
acceptance:
  - vitest 全绿零回归
  - grep 残留引用零命中
verify:
  - cd sillyhub-daemon && pnpm test
  - grep -rn "PLATFORM_CONFIG_FILENAME|writePlatformConfig|readPlatformConfig|PlatformConfig" sillyhub-daemon/src
constraints:
  - 只读验证，不改代码
  - 失败回对应 task 修复，不在本 task 改代码
---

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| 1 | `cd sillyhub-daemon && pnpm test` | 全绿零回归 |
| 2 | grep 残留引用 | 零命中（注释除外） |
