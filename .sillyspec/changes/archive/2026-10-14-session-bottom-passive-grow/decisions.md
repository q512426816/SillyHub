---
author: flow-machine-draft
created_at: 2026-10-14T07:43:00.851Z
---
# 决策记录（Decisions）— 2026-10-14-session-bottom-passive-grow

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：最大风险：阈 50px/容差 4px 经验值——过大误吞用户小步上滚（距底仍 <80px 无影响），过小 markdown 抖动穿透（回退到上轮形态）。放弃方案：CSS overflow-anchor（浏览器原生锚定，但对 content-visibility 估算高度不稳定且不可控）；在 [turns] effect 内直接跟随不设守卫（上滚读历史被拉底，ql-20260822-010 既有回归）。
