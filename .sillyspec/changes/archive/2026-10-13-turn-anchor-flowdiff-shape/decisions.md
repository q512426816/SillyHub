---
author: flow-machine-draft
created_at: 2026-10-13T16:04:08.801Z
---
# 决策记录（Decisions）— 2026-10-13-turn-anchor-flowdiff-shape

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：最大风险：totals 与 files 不一致（存量漂移）——缓解：toFlowDiffShape 不信任存量 totals、始终从 files 重算（落盘 totals 只是消费方便利，真相在 files）；新落盘记录两者同源同算。次风险：rows 无 state 字段被消费方误当 flow diff 完整契约——JSDoc 明示维度差异。试过放弃的方案：①在 JSONL 行内再加 rows 别名数组——同一数据双字段冗余存 JSONL，膨胀且易漂移；②在 sillyspec flow diff 侧加轮粒度模式——CLI 不应知道 daemon 的会话轮概念，职责倒置。均否。
