---
id: task-14
title: interactive canUseTool 改调 PolicyEngine + 迁移 write-guard 测试
author: WhaleFall
created_at: 2026-07-02T15:12:00
priority: P0
depends_on: [task-05, task-11]
blocks: [task-15, task-22]
allowed_paths:
  - sillyhub-daemon/src/interactive/session-manager.ts
  - sillyhub-daemon/src/cli.ts
  - sillyhub-daemon/tests/interactive/session-manager-allowed-roots.test.ts
  - sillyhub-daemon/tests/write-guard.test.ts
change: 2026-07-02-daemon-filesystem-policy
goal: "(见 body)"
implementation: "(见 body)"
acceptance: "(见 body)"
verify: "(见 body)"
constraints: "(见 body)"
---

# task-14

> goal: interactive canUseTool 改调 PolicyEngine.canWrite（带 runtimeId），write-guard 逻辑迁入（D-002）。

## implementation
- `session-manager.ts:130` `allowedRootsProvider` 签名改带 runtimeId（或注入 PolicyEngine 引用，session 持 runtimeId 后调 canWrite）
- `session-manager.ts:822` `_wrapWithWriteGuard` 改调 `policyEngine.canWrite(session.runtimeId, path)`，deny 返回统一中文错误
- `cli.ts:528` 注入改 PolicyEngine 闭包
- 迁移 `write-guard.test.ts` + `session-manager-allowed-roots.test.ts` 覆盖到 PolicyEngine 单测
- 60+ SessionManager 测试构造点评估传 mock/null

## 验收标准
- interactive Write/Edit/MultiEdit + Bash/PowerShell/CMD 经 PolicyEngine 校验
- deny 返回统一中文错误提示
- runtimeId 透传到 PolicyEngine

## 验证
- `cd sillyhub-daemon && pnpm test session-manager-allowed-roots`
- `cd sillyhub-daemon && pnpm test session-manager`

## constraints
- session 已持 runtimeId（session 归属 runtime，无需新增透传）
- 60+ 测试构造点多数传 null/mock 向后兼容
- write-guard.ts 删除在 task-15
