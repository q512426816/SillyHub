---
id: task-11
title: PolicyCache 口径统一 + _syncAllowedRoots 短路测试
title_zh: 缓存口径与同步短路口径测试
author: WhaleFall
created_at: 2026-07-30 16:36:00
priority: P0
depends_on: [task-01, task-03]
blocks: []
requirement_ids: [FR-01]
decision_ids: [D-001@v1, D-004@v1]
allowed_paths:
  - sillyhub-daemon/tests/policy/runtime-policy.test.ts
  - sillyhub-daemon/tests/daemon/sync-allowed-roots.test.ts
provides:
  - contract: PolicyCacheConsistencyTest
    fields: [normalized_storage, short_circuit, no_changed_on_equal]
expects_from:
  task-01:
    - contract: PolicyCacheNormalizedRoots
      needs: [storage_form, no_realpath]
  task-03:
    - contract: SyncAllowedRootsShortCircuit
      needs: [json_stringify_compare, skip_on_equal, no_set_on_equal]
goal: >
  PolicyCache 口径统一（存归一字符串不 realpath）+ _syncAllowedRoots 短路（相同 roots 不 changed=1）测试，验证卡死根因消除。
implementation:
  - runtime-policy.test.ts：断言 set 存的是 normalizeAllowedRoots 归一字符串、不含 realpath 结果、不再调 resolveRealPath
  - sync-allowed-roots.test.ts：mock 相同 roots 连续同步，断言第二次 changed=0、不触发 set；真正变化时 changed=1 + set
  - 覆盖 Windows 盘符大小写场景（同路径不同大小写归一后相等 → 短路）
acceptance:
  - PolicyCache.set 存归一字符串，不 realpath
  - 相同 roots 第二次同步 changed=0、不 set
  - 真正变化正确 set + changed++
  - cd sillyhub-daemon && pnpm test 通过
verify:
  - cd sillyhub-daemon && pnpm test tests/policy/runtime-policy.test.ts
  - cd sillyhub-daemon && pnpm test tests/daemon/sync-allowed-roots.test.ts
constraints:
  - 测试验证卡死根因（每心跳 changed=1 → set → stat 风暴）消除
  - 测试逻辑有误改实现不改测试（CLAUDE.md #9）
---
