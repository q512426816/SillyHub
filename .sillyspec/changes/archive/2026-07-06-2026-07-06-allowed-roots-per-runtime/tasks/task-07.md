---
id: task-07
title: daemon _syncAllowedRoots per-runtime + register 初始化 PolicyCache
author: WhaleFall
created_at: 2026-07-06T11:40:00
priority: P0
depends_on: [task-02, task-05]
blocks: [task-09, task-10]
allowed_paths:
  - sillyhub-daemon/src/daemon.ts
change: 2026-07-06-allowed-roots-per-runtime
goal: "(见 body)"
implementation: "(见 body)"
acceptance: "(见 body)"
verify: "(见 body)"
constraints: "(见 body)"
---

# task-07

> goal: daemon 适配新协议：_syncAllowedRoots 从心跳 runtimes map per-runtime 同步；register 响应初始化 PolicyCache。FR-05/FR-07。

## implementation
- `daemon.ts:1783` _syncAllowedRoots 改 per-runtime：`for (const rt of hbResp.runtimes ?? []) { if (rt.runtime_id) this._policyCache.set(rt.runtime_id, rt.allowed_roots); }`
- 兼容旧响应：若 `hbResp.runtimes` 不存在但 `hbResp.allowed_roots` 存在，同步到所有 `_registeredRuntimes`（过渡期）
- register 响应处理：对 `res.runtimes[].allowed_roots` 调 `PolicyCache.set(runtime_id, roots)`，消除首次写 fail-closed 窗口
- WS POLICY_UPDATE 不变（daemon.ts:1813 已 per-runtime）

## 验收标准
- _syncAllowedRoots 从 hbResp.runtimes map 各 runtime 独立同步 PolicyCache
- 兼容旧单值（hbResp.allowed_roots 同步所有 runtime）
- register 响应初始化 PolicyCache（runtimes[].allowed_roots）

## 验证
- vitest: daemon-sync-allowed-roots-per-runtime（map 同步 + 旧单值兼容 + register 初始化）
- tsc --noEmit

## constraints
- 兼容旧单值仅过渡期（同步部署后可删）
