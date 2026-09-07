---
author: qinyi
created_at: 2026-09-07 11:10:00
---

# sillyspec-manager 变更索引

- ql-20260907-007-67df | runProgressJsonDefault 默认执行器 env 显式传「SILLYSPEC_SYNC_TIMEOUT_MS=20000 缺省垫底 + process.env 覆盖」并导出供直测——daemon 自身跑的 sillyspec 命令（runResolve/ghostCleanup 含平台同步收敛）同享熔断预算放宽，常量单一源在 spawn-env.ts（spawn-env 38 + sillyspec-manager 42 vitest 绿，tsc 0）。
