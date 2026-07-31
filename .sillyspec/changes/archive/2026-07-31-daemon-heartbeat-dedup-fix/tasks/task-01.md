---
id: task-01
title: PolicyCache.set 去 resolveRealPath 统一归一口径
title_zh: PolicyCache 存储改为只存归一字符串不再 realpath
author: WhaleFall
created_at: 2026-07-30 16:36:00
priority: P0
depends_on: []
blocks: [task-03, task-04, task-11]
requirement_ids: [FR-01, FR-03]
decision_ids: [D-001@v1]
allowed_paths:
  - sillyhub-daemon/src/policy/runtime-policy.ts
provides:
  - contract: PolicyCacheNormalizedRoots
    fields: [storage_form, no_realpath]
goal: >
  PolicyCache.set 去掉 resolveRealPath，改为只存 normalizeAllowedRoots 归一字符串，统一缓存口径，消除每心跳因口径不一致（缓存 realpath 后 vs 比较侧只 resolve）导致的 changed=1 → set → realpath/stat 风暴。
implementation:
  - runtime-policy.ts:56-63 PolicyCache.set，去掉对每个 root 的 resolveRealPath 调用，直接存 normalizeAllowedRoots(roots) 归一字符串（与 _syncAllowedRoots 比较侧 normalizeAllowedRoots 同口径）
  - 保留 version 自增逻辑不变
  - get() 返回的 allowedRoots 现为归一字符串（非 realpath），消费方（isPathUnderAnyRoot，task-02）改在判定时 realpath
acceptance:
  - PolicyCache.set 存的 allowedRoots 与 normalizeAllowedRoots 输出一致（resolve 但不 realpath，保留原始大小写）
  - 不再在 set 内调用 resolveRealPath / fs.realpathSync / existsSync
  - cd sillyhub-daemon && pnpm typecheck 通过
verify:
  - cd sillyhub-daemon && pnpm typecheck
constraints:
  - 只改 set 存储口径，不改 get 签名（消费方 task-02 适配）
  - 不动 normalizeAllowedRoots（config.ts:533-560，保持只 resolve）
  - Windows 盘符大小写差异由 task-02 判定时 realpath 消化，不在缓存层
---
