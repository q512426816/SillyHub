---
author: flow-machine-draft
created_at: 2026-10-09T04:10:52.133Z
---
# 提案书（Proposal）— 2026-10-09-thin-hide-step-timeline

## 动机

任务原话转写：动机: 轻量变更（thin 出身）详情页的「步骤时间线」卡只显示归档时 CLI unregisterChange 补种的 3 行同一时间戳步骤（decision-distill/extract-module-impact/确认归档），无过程信息量属噪音；thin 主线叙事已由顶部轻量流程条与真实留痕时间线卡承担，该卡应隐藏。
成功标准：
- thin 出身变更（isThinLineageChange 判定）详情页不再渲染「步骤时间线」卡，含归档补种 steps 场景
- 非 thin 厚变更步骤时间线卡行为不变，仍正常渲染 steps 明细
- 真实留痕时间线卡恒挂载行为不变（2026-09-27-timeline-coexist 共存语义保留）
- 相关前端测试更新并通过（仅跑改动相关测试，不跑全量）

## 变更范围

按成功标准机械推导，共 4 条验收面：
1. thin 出身变更（isThinLineageChange 判定）详情页不再渲染「步骤时间线」卡，含归档补种 steps 场景
2. 非 thin 厚变更步骤时间线卡行为不变，仍正常渲染 steps 明细
3. 真实留痕时间线卡恒挂载行为不变（2026-09-27-timeline-coexist 共存语义保留）
4. 相关前端测试更新并通过（仅跑改动相关测试，不跑全量）

## 成功标准（可验证）

1. thin 出身变更（isThinLineageChange 判定）详情页不再渲染「步骤时间线」卡，含归档补种 steps 场景
2. 非 thin 厚变更步骤时间线卡行为不变，仍正常渲染 steps 明细
3. 真实留痕时间线卡恒挂载行为不变（2026-09-27-timeline-coexist 共存语义保留）
4. 相关前端测试更新并通过（仅跑改动相关测试，不跑全量）
