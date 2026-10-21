---
author: flow-machine-draft
created_at: 2026-10-21T01:14:33.403Z
---
# 提案书（Proposal）— 2026-10-21-mobile-scan-birth-cleanup

## 动机

任务原话转写：移动端与变更中心scan起步口径清零

动机与背景：总览卡主管线已在 2026-10-21-overview-card-mainflow-scan 去 scan（对齐 2026-09-27-change-birth-stage-brainstorm 出生阶段决策），但同根因残留三处未随迁——移动端变更详情 STEPPER_STAGES（mobile-change-detail.tsx:145 含 scan 首段）、变更中心列表兜底 stage={c.current_stage ?? "scan"}（changes/page.tsx:764）、移动卡片兜底（mobile-change-card.tsx:261 及其 35 行口径注释）。scan 是按需显式跑的辅助阶段，变更起步即 brainstorm，缺省兜底显 scan 是过时口径。

成功标准：
- 移动端变更详情 stepper 阶段序列无 scan（brainstorm→archive 五段口径）
- 变更中心与移动卡片两处 current_stage 缺省兜底为 brainstorm，缺失兜底不再显 scan
- 受影响组件测试更新后全绿

## 变更范围

按成功标准机械推导，共 3 条验收面：
1. 移动端变更详情 stepper 阶段序列无 scan（brainstorm→archive 五段口径）
2. 变更中心与移动卡片两处 current_stage 缺省兜底为 brainstorm，缺失兜底不再显 scan
3. 受影响组件测试更新后全绿

## 成功标准（可验证）

1. 移动端变更详情 stepper 阶段序列无 scan（brainstorm→archive 五段口径）
2. 变更中心与移动卡片两处 current_stage 缺省兜底为 brainstorm，缺失兜底不再显 scan
3. 受影响组件测试更新后全绿
