---
id: task-15
title: 删除 interactive/write-guard.ts
author: WhaleFall
created_at: 2026-07-02T15:12:00
priority: P1
depends_on: [task-14]
blocks: []
allowed_paths:
  - sillyhub-daemon/src/interactive/write-guard.ts
change: 2026-07-02-daemon-filesystem-policy
goal: "(见 body)"
implementation: "(见 body)"
acceptance: "(见 body)"
verify: "(见 body)"
constraints: "(见 body)"
---

# task-15

> goal: write-guard.ts 逻辑已迁 PolicyEngine，删除文件。

## implementation
- 确认无残留 `from './write-guard.js'` 引用（task-14 已改 session-manager.ts:43）
- 删除 `sillyhub-daemon/src/interactive/write-guard.ts`
- 确认测试已迁移（task-14）

## 验收标准
- write-guard.ts 不存在
- 无残留导入引用
- pnpm test 全绿（无 import 错误）

## 验证
- `cd sillyhub-daemon && pnpm test`
- `grep -r "write-guard" sillyhub-daemon/src` 无结果

## constraints
- 必须在 task-14 完成后执行（确保引用已迁移）
- 测试文件 write-guard.test.ts 已在 task-14 迁移或删除
