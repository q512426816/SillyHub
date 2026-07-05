---
id: task-18
title: file-rpc list_dir 改调 PolicyEngine.canRead
author: WhaleFall
created_at: 2026-07-02T15:12:00
priority: P1
depends_on: [task-05, task-11]
blocks: [task-22]
allowed_paths:
  - sillyhub-daemon/src/file-rpc.ts
  - sillyhub-daemon/src/daemon.ts
  - sillyhub-daemon/tests/file-rpc.test.ts
change: 2026-07-02-daemon-filesystem-policy
goal: "(见 body)"
implementation: "(见 body)"
acceptance: "(见 body)"
verify: "(见 body)"
constraints: "(见 body)"
---

# task-18

> goal: list_dir 改调 PolicyEngine.canRead，行为不变（读自由，不 audit）（D-008）。

## implementation
- `file-rpc.ts:123` `listDir` 签名加 runtimeId 参数；`assertWithinAllowedRoots` 改调 `policyEngine.canRead(rid, path)`
- `daemon.ts` list_dir RPC handler 传入发起 runtime 的 id
- canRead 默认全 allow，不产 audit（D-008）
- 迁移 `file-rpc.test.ts`

## 验收标准
- list_dir 白名单内放行（行为不变）
- canRead 不产 audit 事件
- runtimeId 透传到 PolicyEngine

## 验证
- `cd sillyhub-daemon && pnpm test file-rpc`

## constraints
- 读自由（canRead 全 allow），仅改数据源 + 透传 runtimeId
- 不改 list_dir 校验语义（design 非目标）
- canRead 不调 auditSink（D-008）
