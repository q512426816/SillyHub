---
author: flow-machine-draft
created_at: 2026-10-03T06:03:43.964Z
---
# 决策记录（Decisions）— 2026-10-03-local-usage-caliber-fix

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：最大风险：口径切换期新旧快照并存（存量未重摄的旧口径行 input 偏大、命中率偏低）——活跃变更下次上报自动收敛，死日志不重算可接受（展示偏高不丢数）。放弃的方案：展示层按数据源分公式（本地 CLI 用 cache_read/input、平台用现行公式）——两口径数字混一张表仍费解、公式分叉扩散到三处组件；落库归一一处收敛全部下游，且与平台列语义同构。次要风险：invocations 与 api_requests 语义近似（CLI 留底计数 vs API 调用）非严格同义，注脚已声明。
