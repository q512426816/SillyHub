---
author: flow-machine-draft
created_at: 2026-10-27T03:55:46.338Z
---
# 决策记录（Decisions）— 2026-10-27-mobile-chat-visual-round4

## D-001@v1: 设计期风险与放弃方案（底稿）
- 类型：process
- 状态：confirmed
- 答案：最大风险：seg-width-cap 类被未来新块遗忘挂载（回到散装限宽）——已由测试断言锚（6 用例锚 seg-width-cap）+ globals.css 注释声明单一源约束。放弃的方案：①13 处逐个加 mobile prop 分支（组件改动 13 处×两行 vs 一次类替换+CSS 两行）；②all 视图保留 TurnStatusBadge 仅调样式近似（用户明确「统一用对话的」，两套组件近似必再漂移，正解是删旧用同组件）。
