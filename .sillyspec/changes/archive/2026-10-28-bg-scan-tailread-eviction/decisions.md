---
author: flow-machine-draft
created_at: 2026-10-28T00:19:20.849Z
---
# 决策记录（Decisions）— 2026-10-28-bg-scan-tailread-eviction

## D-001@v1: 设计期风险与放弃方案（底稿）
- 类型：process
- 状态：confirmed
- 答案：最大风险：淘汰可见集若因发现链瞬时抖动漏掉在产路径，会误删其幂等基线导致终态重报——backend 侧已声明重复上报无害（同值信号），且 discoverLivenessWatchTargets(rescan:false) 完全由内存 spawn 记录推导、无 fs 抖动面，风险可控。试过放弃的方案：①内层 Map 加条目级 TTL/LRU——放弃，会话存活期内条目本就该保留（幂等基线），TTL 反而制造重报；②保留 size>200 阈值门——放弃，每轮 O(n) 核对在 60s 节奏下成本可忽略，阈值门只是把正确性修复重新变成条件触发。
