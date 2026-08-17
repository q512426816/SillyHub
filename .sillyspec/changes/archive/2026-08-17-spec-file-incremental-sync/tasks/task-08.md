---
author: qinyi
created_at: 2026-08-17 10:20:00
repo: sillyspec
base_commit: 6647e176e11e670c4c671bf7407141358a53b9e2
id: task-08
title: task-08
title_zh: CLI 增量同步端到端测试
goal: 新增 CLI 测试覆盖有差异/无差异/conflict 不阻塞/Windows 路径转 POSIX。
implementation: |
  1. 新增 sillyspec/test/platform-spec-sync-incremental.test.mjs。
  2. mock HTTP server：GET /api/changes/-/spec-manifest 返回清单；POST /api/changes/-/spec-sync 按模式返回成功/conflict/500。
  3. 断言：a) 有差异时生成正确 ops；b) 无差异时短路不发 POST；c) conflict 时仍返回且不抛错；d) Windows 路径生成 POSIX op path。
acceptance: |
  - 测试全绿；
  - 测试结束正确关闭 server 并清理临时目录。
verify: node test/platform-spec-sync-incremental.test.mjs
constraints: |
  - 用 process.exitCode 而非 process.exit 避免 Windows UV handle 崩溃。
allowed_paths:
  - test/platform-spec-sync-incremental.test.mjs
---

# task-08 CLI 增量同步端到端测试
