---
author: flow-machine-draft
created_at: 2026-10-16T00:58:34.017Z
---
# 提案书（Proposal）— 2026-10-15-session-turn-completion-semantics

## 动机

任务原话转写：上一变更把绿点/完成通知锚定在会话终态 ended 上，但平台里一轮任务跑完后会话仍为 active（只有手动结束才 ended），用户实测（阿里云部署）跑完任务无绿点无通知；且完成通知需覆盖「一轮跑完」口径。本变更把执行完成语义改为轮次级：活性 working/blocked→idle 转移即一轮执行结束。
成功标准：
- 活性由 working/blocked 转移到 idle 且当前不在该会话上 → 行首亮绿点+完成角标（aria-label 此会话已执行完成），点击进入后角标与绿点消失（空闲回归留白）
- 会话终态 ended 的完成通知（上一变更 FR-06）保留，与轮次完成共用同一落盘键与同一角标
- 原红色「有新的空闲状态未读」角标退役——working/blocked→idle 的提醒统一为绿色执行完成语义
- 完成时正选中该会话不标记（两个来源一致）；历史空闲（首见即 idle 无转移基线）不误报
- 相关测试更新全过（session-list-panel + use-session-liveness），lint 零告警

## 变更范围

按成功标准机械推导，共 5 条验收面：
1. 活性由 working/blocked 转移到 idle 且当前不在该会话上 → 行首亮绿点+完成角标（aria-label 此会话已执行完成），点击进入后角标与绿点消失（空闲回归留白）
2. 会话终态 ended 的完成通知（上一变更 FR-06）保留，与轮次完成共用同一落盘键与同一角标
3. 原红色「有新的空闲状态未读」角标退役——working/blocked→idle 的提醒统一为绿色执行完成语义
4. 完成时正选中该会话不标记（两个来源一致）；历史空闲（首见即 idle 无转移基线）不误报
5. 相关测试更新全过（session-list-panel + use-session-liveness），lint 零告警

## 成功标准（可验证）

1. 活性由 working/blocked 转移到 idle 且当前不在该会话上 → 行首亮绿点+完成角标（aria-label 此会话已执行完成），点击进入后角标与绿点消失（空闲回归留白）
2. 会话终态 ended 的完成通知（上一变更 FR-06）保留，与轮次完成共用同一落盘键与同一角标
3. 原红色「有新的空闲状态未读」角标退役——working/blocked→idle 的提醒统一为绿色执行完成语义
4. 完成时正选中该会话不标记（两个来源一致）；历史空闲（首见即 idle 无转移基线）不误报
5. 相关测试更新全过（session-list-panel + use-session-liveness），lint 零告警
