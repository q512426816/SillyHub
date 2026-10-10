---
author: flow-machine-draft
created_at: 2026-10-10T00:33:46.759Z
---
# 决策记录（Decisions）— 2026-10-10-dump-gzip-thread-offload

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：最大风险：to_thread 默认线程池在高并发 dump 风暴下排队——但 dump 为低频全图总览请求且单次百 ms 级，默认池容量充足；极端排队仅表现为该请求变慢，不阻塞事件循环（恰是本变更要保住的底线）。试过但放弃：①降 compresslevel 到 6（放弃理由：只缩短不消除阻塞，且改变输出字节引入对比噪声）；②ResponseStreaming 分块压缩（放弃理由：信封需整体 JSON 化后压缩才能保证 gzip 原子性与既有测试的字节级断言，流式改造收益不抵复杂度）。
