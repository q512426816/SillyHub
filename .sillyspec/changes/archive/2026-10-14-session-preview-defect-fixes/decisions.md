---
author: flow-machine-draft
created_at: 2026-10-14T06:45:37.144Z
---
# 决策记录（Decisions）— 2026-10-14-session-preview-defect-fixes

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：最大风险：把「有 prompt」放行后，某些只有噪音 user_input（如纯前导/系统注入行）的轮被误判有内容而展开空壳。已用真零正文集成用例锁定空串不放行；纯前导内容由 steerMatchKey 类既有归一口径消化，属可接受边界。放弃方案：在 logsToTurns 内全局改批次编号（跨批次状态维护复杂、动共享装配器影响 dialog/群聊全消费方，风险面大）——归并层盖章只影响 page 模式消息流，改面最小。
