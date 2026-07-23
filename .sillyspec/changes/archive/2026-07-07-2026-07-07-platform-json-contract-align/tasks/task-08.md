---
id: task-08
title: 测试更新（test_init_lease 断言 + test_spec_version_refresh 路径 + hasUnsynced fixture 迁移）
author: qinyi
created_at: 2026-07-07 23:26:42
priority: P0
depends_on: [task-01, task-02, task-03, task-04, task-05, task-06, task-07]
blocks: [task-09]
requirement_ids: [FR-01, FR-02, FR-03, FR-04, NFR-01]
decision_ids: [D-001@v1]
allowed_paths:
  - sillyhub-daemon/tests/test_init_lease.test.ts
  - sillyhub-daemon/tests/test_spec_version_refresh.test.ts
  - sillyhub-daemon/tests
goal: >
  把测试断言与 fixture 从 .sillyspec-platform.json 迁到 .runtime/spec-version.json。
implementation:
  - test_init_lease.test.ts 断言改为「写 {cacheRoot}/.runtime/spec-version.json（2 字段）」+「不写 {rootPath}/.sillyspec-platform.json」
  - test_spec_version_refresh.test.ts 路径常量 PLATFORM_CONFIG_FILENAME→DAEMON_STATE_FILENAME；fixture 在 .runtime/spec-version.json 准备 spec_version
  - hasUnsynced 相关测试 synced_at fixture 路径迁移
acceptance:
  - 全量 vitest 绿
  - 测试目录无 PLATFORM_CONFIG_FILENAME 残留
verify:
  - cd sillyhub-daemon && pnpm test
constraints:
  - 只迁路径/常量，不改测试逻辑本身
  - 若发现真 bug 单独记录，不在本 task 改测试"凑过"（CLAUDE.md 规则 8）
---

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| 1 | `cd sillyhub-daemon && pnpm test` | 全量 vitest 绿 |
| 2 | grep 测试目录 `PLATFORM_CONFIG_FILENAME` | 零残留（已迁到 DAEMON_STATE_FILENAME） |
