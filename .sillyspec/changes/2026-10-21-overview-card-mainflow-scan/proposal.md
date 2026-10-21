---
author: flow-machine-draft
created_at: 2026-10-21T00:59:28.398Z
---
# 提案书（Proposal）— 2026-10-21-overview-card-mainflow-scan

## 动机

任务原话转写：总览卡主管线去scan并隐藏thin零步骤

动机与背景：用户实证工作区「活跃变更总览」卡两处错显——①主管线含 scan 首段且把 brainstorm 阶段变更渲染成「scan 已完成」，而 sillyspec 自 2026-09-27-change-birth-stage-brainstorm 起出生阶段即 brainstorm、scan 是辅助阶段（MAIN_FLOW_ORDER 不含 scan），管线应五段 brainstorm→archive；②轻量（thin）变更行显「步骤 0/0」，thin 不走阶段机无步骤语义（CLI 侧 2026-10-21-overview-thin-stage 已把 current_stage 投影为 thin，前端旁路徽标已备，唯步骤文案残留）。

成功标准：
- 总览卡主管线为 brainstorm→plan→execute→verify→archive 五段，无 scan 点位；brainstorm 阶段变更不渲染「scan 已完成」
- current_stage='thin' 的变更行渲染「◈ thin」旁路徽标且不显示「步骤 0/0」文案（quick/explore 存量行为不动）
- changes-overview-card 既有测试更新后全绿

## 变更范围

按成功标准机械推导，共 3 条验收面：
1. 总览卡主管线为 brainstorm→plan→execute→verify→archive 五段，无 scan 点位；brainstorm 阶段变更不渲染「scan 已完成」
2. current_stage='thin' 的变更行渲染「◈ thin」旁路徽标且不显示「步骤 0/0」文案（quick/explore 存量行为不动）
3. changes-overview-card 既有测试更新后全绿

## 成功标准（可验证）

1. 总览卡主管线为 brainstorm→plan→execute→verify→archive 五段，无 scan 点位；brainstorm 阶段变更不渲染「scan 已完成」
2. current_stage='thin' 的变更行渲染「◈ thin」旁路徽标且不显示「步骤 0/0」文案（quick/explore 存量行为不动）
3. changes-overview-card 既有测试更新后全绿
