---
id: task-04
title: 核实并统一所有 PolicyCache.set / isPathUnderAnyRoot 调用点口径
title_zh: 全量核对路径口径调用点并统一含 _handlePolicyUpdate
author: WhaleFall
created_at: 2026-07-30 16:36:00
priority: P0
depends_on: [task-01, task-02, task-03]
blocks: []
requirement_ids: [FR-01, FR-03]
decision_ids: [D-001@v1]
allowed_paths:
  - sillyhub-daemon/src/daemon.ts
provides:
  - contract: PolicyCacheSetPointsConsistent
    fields: [all_set_points_normalized, handlePolicyUpdate_normalized, no_raw_roots]
expects_from:
  task-01:
    - contract: PolicyCacheNormalizedRoots
      needs: [storage_form, no_realpath]
  task-02:
    - contract: SandboxPathRealpathCheck
      needs: [target_resolved, root_resolved]
  task-03:
    - contract: SyncAllowedRootsShortCircuit
      needs: [json_stringify_compare, skip_on_equal]
goal: >
  grep 全部 PolicyCache.set 与 isPathUnderAnyRoot 调用点，核实口径统一；修复 daemon.ts:2010 _handlePolicyUpdate 传未 normalize 原始 roots 的口径偏差。
implementation:
  - grep sillyhub-daemon/src 全部 PolicyCache.set（已知：register:1022、_syncPolicyCache:1973、_handlePolicyUpdate:2010）与 isPathUnderAnyRoot 调用点
  - daemon.ts:2010 _handlePolicyUpdate 改为传 normalizeAllowedRoots(roots)（与 :1022/:1973 同口径），消除原始 roots 进缓存
  - 核实所有 set 点输入均为 normalizeAllowedRoots 归一字符串（task-01 后缓存不再 realpath）
  - 核实所有 isPathUnderAnyRoot 调用点消费归一字符串缓存 + 判定时 realpath（task-02）
acceptance:
  - 全部 PolicyCache.set 输入均为 normalizeAllowedRoots 归一字符串，无原始 roots
  - _handlePolicyUpdate:2010 与 register/_syncPolicyCache 口径一致
  - grep 无遗漏的 set/判定点
  - cd sillyhub-daemon && pnpm typecheck 通过
verify:
  - cd sillyhub-daemon && pnpm typecheck
  - grep -rn 核对 sillyhub-daemon/src 下 PolicyCache.set 与 isPathUnderAnyRoot 调用点口径
constraints:
  - 只统一口径，不改 set/判定语义
  - daemon.ts 与 task-03 同文件改不同函数（:1930 vs :2010），顺序依赖 task-03 先行避免并发写冲突
  - 若 grep 发现 design 清单外的新 set 点需改，扩充本 task allowed_paths 并记录
---
