---
id: task-05
title: turn-segment-views 对话视图 agent 头像行 + 43px 对齐
title_zh: 对话视图 agent 头像行与过程行对齐
allowed_paths:
  - frontend/src/components/daemon/turn-segment-views.tsx
  - frontend/src/components/daemon/__tests__/turn-segment-views.test.tsx
depends_on:
  - task-03
goal: FR-01 单聊 v2 段路径：TextSegmentView 的 agent 文本气泡在对话视图挂 ChatMessageAvatar(agent)
implementation: |
  1. 头像外包仅在「对话」视图生效：TextSegmentView 现被 SegmentView 双视图共用且无 viewMode 入参——在 SegmentedTurnBody（或 SegmentView 消费侧）按 viewMode 判定，仅对话视图给 text 段外包 `flex items-start gap-2.5` 行 + ChatMessageAvatar(kind="agent")（Grill G-03/R-05 口径：全部/进度视图时间线原样式零改动）。
  2. 工具行/思考行/stderr 行在对话视图加 43px（32 头像+11 间距）左缩进，使文字与气泡左缘对齐（Grill G-02）；全部视图不动。
  3. 气泡自身类名不动（P0 的 max-w-[80%]/border-border/60 保留）。
  4. 测试适配/新增：对话视图 text 段渲染出头像个数正确；全部视图无头像；工具行缩进类存在。
acceptance: 对话视图 agent 文本气泡带头像、过程行 43px 对齐；全部/进度视图 DOM 结构不变；turn-segment-views 62 用例全绿（适配后）
verify: pnpm -C frontend exec vitest run src/components/daemon/__tests__/turn-segment-views.test.tsx 通过
constraints:
  - data-testid 与段 key 契约不动（memo 浅比较依赖段引用稳定性不变）
  - 头像只在文本段气泡行出现，tool/thinking 行不挂头像
---

## 说明

viewMode 判定落消费侧是为不改 TextSegmentView 的纯组件签名（memo 稳定）。
