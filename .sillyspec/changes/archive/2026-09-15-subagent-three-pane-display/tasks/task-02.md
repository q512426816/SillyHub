---
id: task-02
title: '对话视图过滤放宽（turn-timeline.tsx：子代理容器段进入对话流）+ turn-timeline-conversation-file-card.test.tsx 新用例'
title_zh: '对话视图过滤放宽（turn-timeline.tsx：子代理容器段进入对话流）+ turn-timeline-conversation-file-card.test.tsx 新用例'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-15 18:23:35
priority: P0
depends_on: []
blocks: [task-04]
requirement_ids: [FR-04]
decision_ids: [D-002@v1]
allowed_paths:
  - frontend/src/components/daemon/turn-timeline.tsx
  - frontend/src/components/daemon/__tests__/turn-timeline-conversation-file-card.test.tsx
target_files:
  - frontend/src/components/daemon/turn-timeline.tsx
  - frontend/src/components/daemon/__tests__/turn-timeline-conversation-file-card.test.tsx
goal: >
  把 TurnTimeline 对话视图（默认）的段过滤条件从 text/file 放宽到
  text/file/子代理容器段（tool 带 children 或 subagent_stub）——修复默认视图下
  子代理整体不可见这一"内容不完整"主因（design §5.D / FR-04 / D-002@v1 ①）。
implementation:
  - 'turn-timeline.tsx（1183-1188 行）textSegments 过滤——s.kind === "text" || s.kind === "file" 后追加 || (s.kind === "tool" && s.children.length > 0) || s.kind === "subagent_stub"（isTeamDispatchTool 的 dispatch_worker 段保持不进对话视图，team 分身块仍仅进度视图，避免团队卡混入对话流）'
  - '渲染侧零改动——容器段经 SegmentView 分发到 SubagentBlockView（task-01 双模式自动生效：page 模式紧凑卡片 / dialog 内联展开），textSegments map 处无需特判'
  - 'turn-timeline-conversation-file-card.test.tsx 新增 describe「对话视图子代理容器段（subagent-three-pane）」——用例：①conversation 模式下 tool 段（带 children 的子代理）渲染出子代理块（按名称/🤖 断言）；②subagent_stub 同样渲染；③thinking/tool（无 children）段仍不渲染（渲染经济不回归，沿用本文件既有 thinking 不可见断言手法）；④viewMode=all 时原 v2 段线全段渲染零回归'
acceptance:
  - '对话视图出现子代理卡片（tool 带 children / subagent_stub 两形态），thinking 与普通 tool 段仍被过滤'
  - '进度视图（all）行为零变化'
  - '新增 describe ≥4 用例 + 本文件既有用例全绿'
verify:
  - 'pnpm -C frontend exec tsc --noEmit（对照基线 0 新增错误）'
  - 'pnpm -C frontend exec eslint src/components/daemon/turn-timeline.tsx src/components/daemon/__tests__/turn-timeline-conversation-file-card.test.tsx（0 error 0 warning）'
  - 'pnpm -C frontend exec vitest run src/components/daemon/__tests__/turn-timeline-conversation-file-card.test.tsx（新增 + 既有全绿）'
constraints:
  - '不改 TurnTimelineProps 与调用方签名；不改 v2 段线（all 视图）逻辑'
  - 'dispatch_worker 团队分身段不进对话视图（保持现状）'
---
