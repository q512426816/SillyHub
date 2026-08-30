---
id: task-11
title: 'preamble visibility in all-view timeline'
title_zh: '上下文前导在「全部（进度）」视图可见'
author: 'qinyi'
created_at: 2026-08-25 09:40:00
priority: P0
depends_on: [task-10]
blocks: []
requirement_ids: [FR-7]
decision_ids: [D-008]
allowed_paths:
  - frontend/src/components/daemon/session-log-assembler.ts
  - frontend/src/components/daemon/__tests__/session-log-assembler.test.ts
  - frontend/src/components/daemon/runtime-session-helpers.tsx
  - frontend/src/components/daemon/session-panel.tsx
  - frontend/src/components/daemon/turn-timeline.tsx
  - frontend/src/components/daemon/turn-segment-views.tsx
goal: >
  用户反馈"注入完全黑盒"：对话 tab 保持干净，「全部（进度）」tab 显示首轮
  注入的上下文前导来源（变更/页面/团队简报三类）。
implementation:
  - TurnSegment += preamble 段（text/ts）；extractPreambleText 识别（标题开头+---分隔）
  - 历史路径（runtime-session-helpers attach）+ 实时 SSE 路径（session-panel onLog）双通道提取
  - SegmentView preamble 分支渲染卡片；segmentTsOf preamble 取捕获 ts；对话视图过滤天然排除
acceptance:
  - 「全部」视图显示「上下文注入」卡片含前导内容；「对话」视图无此卡
  - 普通消息不误伤（标题开头但无 --- 分隔不算前导）；assembler 55 测试绿
verify:
  - cd frontend && pnpm exec vitest run src/components/daemon/__tests__/session-log-assembler.test.ts
constraints:
  - 对话视图保持干净（展示层契约不变）
  - session-panel/runtime-session-helpers 增量最小化（巨石区）
---
# task-11 前导段「全部」视图可见（用户实测反馈迭代 3）
