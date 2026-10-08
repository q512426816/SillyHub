---
author: flow-machine-draft
created_at: 2026-10-08T03:33:16.863Z
---
# 决策记录（Decisions）— 2026-10-08-turn-nav-hover-mark

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：最大风险：指向 ring 与浮层行既有 `hover:bg-muted/50` 底色叠加的视觉密度——选择仅 ring 描边不加底色，二者正交叠加不糊（token 均为主题语义阶，随 data-theme 换肤）。放弃方案：①指向行加底色（与 active 行 `bg-muted/60` 底色同型，视觉冲突辨识度差）；②刻度上挂原生 title/tooltip 显示轮号（>60 轮密集态刻度仅 6px 高命中差，且不满足「浮层卡片标记指向轮」的需求本体）；③浮层行高亮直接复用 active 同款样式（「我在指」与「聊天停在哪」两语义混同，正是本 bug 的认知混淆点）。
