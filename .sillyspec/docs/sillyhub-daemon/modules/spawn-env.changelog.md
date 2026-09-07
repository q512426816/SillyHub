---
author: qinyi
created_at: 2026-09-07 11:10:00
---

# spawn-env 变更索引

- ql-20260907-007-67df | spec-sync 熔断预算缺省放宽：新增 SILLYSPEC_SYNC_TIMEOUT_MS_FIELD / SILLYSPEC_SYNC_TIMEOUT_DEFAULT_MS('20000') 导出常量，buildSpawnEnv 在 tool_config 层后填补缺省（process.env/tool_config 预设保留、空串视同未配置），覆盖 batch/interactive/restore/reload 全部 agent 子进程路径（sillyspec ≥3.28.1 env 开关，背景 docs/sillyspec/2026-09-07-spec-sync-abort-classification.md 行动项 1）。
