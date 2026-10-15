---
author: flow-machine-draft
created_at: 2026-10-14T08:10:08.843Z
---
# 决策记录（Decisions）— 2026-10-14-session-bottom-switch-remount

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：最大风险：重挂载一次性成本（切会话时全量行重建）——切会话本就全量重渲 turns，增量成本可忽略。放弃方案：①TurnTimeline 内加 sessionId prop + effect 手动重置各 refs——枚举 refs 易漏（本轮正是漏了 scrollBaselineRef 才升级到 key），新增 ref 又要记得加；②只重置 isNearBottomRef——治标，其余残留（lastSigRef/firstTurnKeyRef/baseline）仍有竞态面。
