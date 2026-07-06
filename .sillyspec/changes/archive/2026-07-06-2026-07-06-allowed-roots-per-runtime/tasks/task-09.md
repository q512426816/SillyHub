---
id: task-09
title: daemon per-runtime 同步测试
author: WhaleFall
created_at: 2026-07-06T11:40:00
priority: P1
depends_on: [task-07]
blocks: [task-10]
allowed_paths:
  - sillyhub-daemon/tests/
change: 2026-07-06-allowed-roots-per-runtime
goal: "(见 body)"
implementation: "(见 body)"
acceptance: "(见 body)"
verify: "(见 body)"
constraints: "(见 body)"
---

# task-09

> goal: 覆盖 daemon per-runtime 同步 + register 初始化。FR-05/FR-07。

## implementation
- 复用 daemon-multi-runtime / session-manager-allowed-roots 测试框架
- 新建/扩展 daemon-sync-allowed-roots-per-runtime 测试：心跳 runtimes map（CC/Hermes 不同 roots 各自同步）+ 旧单值兼容 + register 响应初始化 PolicyCache

## 验收标准
- _syncAllowedRoots per-runtime（runtimes map 各 runtime 独立同步 PolicyCache）
- 兼容旧单值（hbResp.allowed_roots 同步所有 runtime）
- register 响应初始化 PolicyCache（runtimes[].allowed_roots）
- vitest + tsc 通过

## 验证
- cd sillyhub-daemon && pnpm test daemon-sync-allowed-roots-per-runtime
- pnpm build（tsc）

## constraints
- 测试覆盖兼容旧单值（过渡期）
