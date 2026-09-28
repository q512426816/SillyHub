---
author: flow-machine-draft
created_at: 2026-09-28T10:48:37.316Z
---
# 决策记录（Decisions）— 2026-09-28-timeline-anchor-scope

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：最大风险：本变更 commit 事件的短哈希在全局 50 窗口外（远端落后、窗口截断）→ anchor_pairs 空 → 锚 None——无锚是诚实降级优于错锚；titles 同理降级。放弃方案：锚匹配直接读 events 不经 git 窗口（事件只有短哈希无 message，token 匹配必须有 message——保留经窗口取对的形态只收窄窗口）。
