---
author: flow-machine-draft
created_at: 2026-10-16T01:42:37.296Z
---
# 提案书（Proposal）— 2026-10-16-pg-index-local-followup

## 动机

任务原话转写：本地平台 postgres 索引损坏修复补记沉淀知识库

动机：本地 docker 平台复发同款唯一索引静默损坏（btree 12/360 坏、无重复行、直接 REINDEX 即愈），另有三点新经验需补记在生产事故条目旁：amcheck 须过滤 btree（GIN 会被误判坏）、同步静默断档排查信号（platform_sync_tokens.last_used_at 长期停滞）、2026-09-08-session-turn-nav 墓碑冲突遗留待拍板。

成功标准：
- .sillyspec/knowledge/uncategorized.md 新增补记小节，覆盖本地 12/360 无重复行直接 REINDEX、amcheck 须 JOIN pg_am 过滤 btree、last_used_at 停滞即同步静默断档信号、墓碑冲突遗留待拍板，四点齐全
- 补记紧邻既有 2026-10-16 生产事故条目且不改动原条目内容
- 数字与本次实证一致：360 checked/12 bad/修复后 0 bad、清单 10152 到 10680 行、变更行 614

## 变更范围

按成功标准机械推导，共 3 条验收面：
1. .sillyspec/knowledge/uncategorized.md 新增补记小节，覆盖本地 12/360 无重复行直接 REINDEX、amcheck 须 JOIN pg_am 过滤 btree、last_used_at 停滞即同步静默断档信号、墓碑冲突遗留待拍板，四点齐全
2. 补记紧邻既有 2026-10-16 生产事故条目且不改动原条目内容
3. 数字与本次实证一致：360 checked/12 bad/修复后 0 bad、清单 10152 到 10680 行、变更行 614

## 成功标准（可验证）

1. .sillyspec/knowledge/uncategorized.md 新增补记小节，覆盖本地 12/360 无重复行直接 REINDEX、amcheck 须 JOIN pg_am 过滤 btree、last_used_at 停滞即同步静默断档信号、墓碑冲突遗留待拍板，四点齐全
2. 补记紧邻既有 2026-10-16 生产事故条目且不改动原条目内容
3. 数字与本次实证一致：360 checked/12 bad/修复后 0 bad、清单 10152 到 10680 行、变更行 614
