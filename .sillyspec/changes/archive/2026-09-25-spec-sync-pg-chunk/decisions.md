---
author: flow-machine-draft
created_at: 2026-09-25T05:28:12.473Z
---
# 决策记录（Decisions）— 2026-09-25-spec-sync-pg-chunk

## D-001@v1: 风险与死路（design 槽4 收割）
- 决策：最大风险：批间非原子（部分批成功后后续批失败）——原语义同为单事务内多语句，失败整体回滚，原子性不变；幂等重放由 conflict 跳过兜底。放弃的方案：改 executemany 或拆多请求——前者失去 on_conflict_do_update 的版本高位对齐语义，后者改 CLI 契约，均过重。
