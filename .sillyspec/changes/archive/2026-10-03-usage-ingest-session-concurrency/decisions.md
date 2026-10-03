---
author: flow-machine-draft
created_at: 2026-10-03T04:14:12.758Z
---
# 决策记录（Decisions）— 2026-10-03-usage-ingest-session-concurrency

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：最大风险：串行定位段拉长任务总时长——上限 50 entry × 每次 3-4 个本地查询， 毫秒级/条，远小于 RPC 段本身（30s 预算/条），可忽略；若 daemon 全离线， 定位仍逐条走完（每条查询+404 抛出），属既有降级路径的既有代价。 放弃方案：① 任务内自开 session（identity map 跨 session 改写复杂，见槽1）； ② 定位整体改为候选筛选时一次性批量 JOIN 查询——需改动 router 共享函数 `_resolve_agent_log_read_target`，牵连 content/messages 两端点，超出本缺陷 修复范围。
