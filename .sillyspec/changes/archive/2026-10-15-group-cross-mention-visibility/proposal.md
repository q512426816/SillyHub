---
author: qinyi
created_at: 2026-10-15 11:33:20
generated_by: sillyspec-fourpiece-init
---
# 提案书（Proposal）

## 动机

群聊互 @ 自 2026-09-10 起默认私聊化（D-005@2026-09-10）：agent 互 @ 的回复定向注入发起方影子会话、不进群时间线。该决策解决了「分歧讨论污染群时间线」，但代价是**协作过程对群完全不可见**——用户与其它成员看不到 agent 之间的任务流转与结果，群里表现为"死寂"，多 agent 群聊的协作价值被削弱。对 DS Bot（Fei2411/DeepSeek-Bot）的源码级调研验证了「公开委派」模式：委派成员的**最终结果**进群、过程留私有通道，配合护栏约束既可见又不污染。本变更为互 @ 引入群级可配置的「协作可见性」模式。

## 关键问题

1. 互 @ 协作结果只有发起方 agent 私下可见，用户在群里看不到「任务转给了谁、结果是什么」，无法追踪和审计 agent 间协作；
2. 可见性语义不可配置——「讨论过程别刷群」与「结果应该进群」是两种正交诉求，现有 private 一刀切无法兼顾；
3. 直接全量公开（现状反转）会复现 2026-09-10 决策前的「分歧讨论污染时间线」问题，需要「只公开结果、过程仍私有」的中间态。

## 变更范围

- `AgentGroupChat` 新增 `cross_mention_mode`（`'private'|'public'`，默认 `'private'`）+ DTO 透传 + 加列迁移；
- 互 @ 触发分流（mentions.py）：public 群走新轮型 `agent_public`（公开委派 role_prompt + `asked_by_member_id`，无 dm_target），private 群现路径零改动；
- 投影回流（group_bridge.py）：`projection_blocked` 放行 `agent_public` 轮的 [[GROUP]] 投影 + 无标记兜底；收口后向发起方影子会话纯注入轻通知（不建 run、不占队列、计同链通知上限）；
- 前端：member-panel 群设置区与建群向导第三步新增模式选择（三态联动：总开关关/consensus 开时禁用），api-types 前后端再生成。

## 不在范围内（显式清单）

- 不做过程进度播报（DS Bot 式阶段性多段 [[GROUP]] 播报 + 短句合流）；
- 不做结果后自动触发发起方接话（askedBy 自动应答）；
- 不做双写（群投影 + 发起方 DM 完整注入并存）；
- 不改用户直接 @ 多成员的并行触发、consensus 汇总模式、影子直聊、typing/presence、护栏参数值。

## 成功标准（可验证）

- public 群互 @：被 @ 成员轮 turn_overrides 带 `dm_kind='agent_public'` 且无 `dm_target_member_id`；其收口回复的 [[GROUP]] 段（或无标记兜底）出现在群时间线；发起方影子会话收到 `delegation_notice` 注入行且无新 run 创建；
- private 群互 @：触发参数、投影拦截、注入路径与变更前逐比特一致（零回归断言）；
- 存量群升级后行为完全不变（新列默认 private）；
- 护栏（链深/同链同成员次数/限频/Redis fail-closed）在两模式下同源计数、无放宽；
- consensus_mode 开启群：互 @ 模式字段无行为效果（consensus 接管）；
- 打断被委派成员：零投影、零注入；
- 前端设置控件三态联动正确，gen:types 前后端同变更提交。

> **可否决项（用户未及作答，AI 按仓库惯例保守裁定，见 decisions.md D-002/D-003/D-004/D-008）**：①新群默认 private；②v1 只投影最终结果不做进度播报；③轻注入不自动触发发起方。否决任一项走 D-xxx@v2 supersede 修订。
