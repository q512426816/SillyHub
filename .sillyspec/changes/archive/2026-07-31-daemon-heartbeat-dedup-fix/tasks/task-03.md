---
id: task-03
title: _syncAllowedRoots 加短路
title_zh: allowed roots 同步加 JSON.stringify 短路防无谓重算
author: WhaleFall
created_at: 2026-07-30 16:36:00
priority: P0
depends_on: [task-01]
blocks: [task-04, task-11]
requirement_ids: [FR-01]
decision_ids: [D-004@v1]
allowed_paths:
  - sillyhub-daemon/src/daemon.ts
provides:
  - contract: SyncAllowedRootsShortCircuit
    fields: [json_stringify_compare, skip_on_equal, no_set_on_equal]
expects_from:
  task-01:
    - contract: PolicyCacheNormalizedRoots
      needs: [storage_form, no_realpath]
goal: >
  _syncAllowedRoots 加短路：normalized 与缓存 JSON.stringify 相同则直接 return（不 set、不 changed），双保险防止无谓重算 + 将来口径回归。
implementation:
  - daemon.ts:1930-1933 _syncAllowedRoots，口径统一后（task-01）normalized 与 existing 均 normalizeAllowedRoots 归一字符串，JSON.stringify 相等则 return（跳过 set + changed++）
  - 仅在真正变化时 set + changed++
  - 保持对 register:1022、_syncPolicyCache:1973、_handlePolicyUpdate:2010 的一致性（task-04 核实）
acceptance:
  - 相同 roots 不再 changed=1、不再触发 PolicyCache.set
  - 真正变化时仍正确 set + changed++
  - cd sillyhub-daemon && pnpm typecheck 通过
verify:
  - cd sillyhub-daemon && pnpm typecheck
  - cd sillyhub-daemon && pnpm test tests/daemon/sync-allowed-roots.test.ts（task-11）
constraints:
  - 短路依赖 task-01 口径统一（normalized 与缓存同口径才能 JSON.stringify 比较）
  - 不改 _syncAllowedRoots 的 roots 来源逻辑（union 计算）
---
