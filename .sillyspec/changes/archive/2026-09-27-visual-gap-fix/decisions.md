---
author: flow-machine-draft
created_at: 2026-09-26T23:29:24.409Z
---
# 决策记录（Decisions）— 2026-09-27-visual-gap-fix

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：最大风险：两栏 grid 中 ChangesOverviewCard（内部自带高度行为）在窄栏挤压下的布局回归——已跑概览 23 用例 + 卡片 19 用例全绿对冲。试过放弃：把 WorkspaceConfigCard 也收进右栏——放弃（ql-20260821-003 用户裁决全宽展示，不推翻既有用户决策）。会话门户左栏深改（3665 行条目重构）放弃——风险收益比差，已有 11px/brand 阶打底，留待专项。
