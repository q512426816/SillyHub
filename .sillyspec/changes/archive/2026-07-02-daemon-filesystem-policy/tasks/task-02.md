---
id: task-02
title: policy/runtime-policy.ts PolicyCache
author: WhaleFall
created_at: 2026-07-02T15:12:00
priority: P0
depends_on: []
blocks: [task-05, task-12, task-13, task-16]
allowed_paths:
  - sillyhub-daemon/src/policy/runtime-policy.ts
  - sillyhub-daemon/tests/policy/runtime-policy.test.ts
change: 2026-07-02-daemon-filesystem-policy
goal: "(见 body)"
implementation: "(见 body)"
acceptance: "(见 body)"
verify: "(见 body)"
constraints: "(见 body)"
---

# task-02

> goal: 按 runtime 隔离的 PolicyCache，替代 daemon.ts:1682 并集逻辑（D-002/D-007）。

## implementation
- `RuntimePolicy { allowedRoots: string[]（已规范化）; version: number }`
- `PolicyCache` = `Map<runtime_id, RuntimePolicy>`，方法 get/set/reload/reloadAll
- set 时调 path-utils 规范化 roots；**不偷偷加 homedir**（D-007）
- version 单调递增，用于 WS push 去重

## 验收标准
- claude/codex runtime 各存各的 roots，互不串扰
- 不自动补 homedir；未命中 get 返回 undefined（调用方 fallback）
- reloadAll 从心跳全量刷新

## 验证
- `cd sillyhub-daemon && pnpm test runtime-policy`

## constraints
- 新 runtime 默认 allowed_roots 由 backend model 决定（`["~/.sillyhub"]`），daemon 不改默认
- 不持久化（内存，靠 backend + 心跳重建）
- 移除现有 `_allowedRootsByRuntime` 并集语义（task-12 执行）
