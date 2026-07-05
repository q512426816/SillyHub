---
id: task-12
title: daemon _syncAllowedRoots 改写 PolicyCache 去并集
author: WhaleFall
created_at: 2026-07-02T15:12:00
priority: P0
depends_on: [task-02, task-11]
blocks: [task-22]
allowed_paths:
  - sillyhub-daemon/src/daemon.ts
  - sillyhub-daemon/tests/
change: 2026-07-02-daemon-filesystem-policy
goal: "(见 body)"
implementation: "(见 body)"
acceptance: "(见 body)"
verify: "(见 body)"
constraints: "(见 body)"
---

# task-12

> goal: _syncAllowedRoots 改写 PolicyCache，移除并集逻辑（D-002）。

## implementation
- `daemon.ts:1683` `_syncAllowedRoots(rid, resp)` 改为 `this._policyCache?.set(rid, expanded)`（每 rid 独立）
- 删 `_allowedRootsByRuntime` Map（:1682）+ 并集遍历（:1694）+ 写 `this._config.allowed_roots`（:1701）
- 心跳循环（:1635）保留调用，reloadAll 兜底全量刷
- homedir 不再自动加（D-007）

## 验收标准
- 心跳响应每 rid 独立存 PolicyCache，不并集
- `config.allowed_roots` 不再被心跳覆盖（保留初始值或弃用）
- claude/codex runtime 各存各的 roots

## 验证
- `cd sillyhub-daemon && pnpm test daemon-multi-runtime`

## constraints
- 移除并集后依赖 config.allowed_roots 的旧路径需改读 PolicyCache（task-16/18）
- homedir 兜底丢失（D-007 接受，admin 显式配）
- 心跳兜底 reloadAll 防 WS 断线
