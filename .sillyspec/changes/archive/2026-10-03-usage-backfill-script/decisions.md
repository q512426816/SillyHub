---
author: flow-machine-draft
created_at: 2026-10-03T06:21:45.859Z
---
# 决策记录（Decisions）— 2026-10-03-usage-backfill-script

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：最大风险：daemon 离线导致大面积跳过（回填不完整）——设计为可重跑补齐，且每条独立降级不影响其他；历史日志文件已被用户清理的条目 RPC not_found 跳过（诚实缺数）。放弃的方案：写进 alembic 迁移自动跑——链内破坏性/外部依赖（RPC）不可入迁移（reset 脚本先例同裁决）；逐条即时 commit——无必要（幂等覆盖写无中间态语义）。
