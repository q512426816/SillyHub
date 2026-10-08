---
author: flow-machine-draft
created_at: 2026-10-08T17:37:33.843Z
---
# 决策记录（Decisions）— 2026-10-09-stale-recheck-scope

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：最大风险：daemon 活性门放过的「在线 daemon + 永久静默轮」会一直被追踪不判死——有意取舍（对齐 patrol 判死段语义：在线 daemon 的轮不判死，归属用户取消/会话超时面）；若需硬上限可后续迭代加最长追踪时长。次风险：`_run_daemon_alive` 的 lease 倒序首见语义在 lease 频繁重建时可能解析到无 runtime_id 的新 pending lease 而返回 None——None 走 recency 判死，方向与原实现一致不放大。试过放弃：(a) 复扫判死面保持全局仅加活性门——放弃，启动后新开轮每 10 分钟进判死面本身就是审查实证缺陷源；(b) 循环异常无限重试——放弃，持久故障下无限日志噪音且违背有界退避要求。
