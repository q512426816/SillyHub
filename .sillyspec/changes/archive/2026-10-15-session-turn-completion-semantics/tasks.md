---
author: flow-machine-draft
created_at: 2026-10-16T00:58:34.017Z
---
# 任务注册表（Tasks）— 2026-10-15-session-turn-completion-semantics

- [x] task-01: 活性由 working/blocked 转移到 idle 且当前不在该会话上 → 行首亮绿点+完成角标（aria-label 此会话已执行完成），点击进入后角标与绿点消失（空闲回归留白）
- [x] task-02: 会话终态 ended 的完成通知（上一变更 FR-06）保留，与轮次完成共用同一落盘键与同一角标
- [x] task-03: 原红色「有新的空闲状态未读」角标退役——working/blocked→idle 的提醒统一为绿色执行完成语义
- [x] task-04: 完成时正选中该会话不标记（两个来源一致）；历史空闲（首见即 idle 无转移基线）不误报
- [x] task-05: 相关测试更新全过（session-list-panel + use-session-liveness），lint 零告警
