---
author: flow-machine-draft
created_at: 2026-10-09T00:21:57.288Z
---
# 决策记录（Decisions）— 2026-10-09-status-root-write-race

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：最大风险：回归用例对竞态的检出是概率性的（旧码本地 ×20 用例 3 跑未触发、原用例 1/3 触发、CI 触发）——窗口取决于 fs 调度；以机理代码读证 + CI 实跑红作红证，用例作放大器非唯一防线。次风险：链上积压（极端高频 claim）延迟落盘——量级为毫秒级写排队，claim 频率远达不到。试过放弃：(a) 只修测试轮询窗口——放弃，生产同款竞态（两次快速 claim 持久化旧根）仍在；(b) 写前 coalesce（同值跳过）——`_sillyspecStatusRoot === rootPath` 早退已有同值短路，跨值仍需保序，链式是完备解；(c) 防抖 500ms——放弃，改落盘时效语义且测试需假时钟。
