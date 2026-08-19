---
schema_version: 1
doc_type: task
id: task-12
title: Daemon runtime handler tests
title_zh: daemon runtime handler 测试
author: qinyi
created_at: 2026-08-19T06:45:00+00:00
change_name: 2026-08-19-runtime-live-daemon-read
wave: 12
allowed_paths:
  - sillyhub-daemon/src/runtime-handler.test.ts
goal: 覆盖 daemon 侧 runtime handler 各路径
implementation: 新增 vitest 测试，mock child_process.execFile 与 fs/promises
acceptance: 覆盖 sillyspec 命令成功/失败/旧版不存在、文件不存在、filename 穿越拒绝
verify: cd sillyhub-daemon && pnpm exec vitest run src/runtime-handler.test.ts
constraints: 测试不依赖真实 sillyspec CLI 安装
---

# task-12：daemon runtime handler 测试
