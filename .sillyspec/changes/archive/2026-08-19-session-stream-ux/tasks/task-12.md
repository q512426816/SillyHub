---
id: task-12
title: Segment view unit tests and final sweep
title_zh: turn-segment-views 段渲染单测 + 全量 test 与 lint 终扫
author: WhaleFall
created_at: 2026-08-19T18:43:32
priority: P0
depends_on: [task-01, task-02, task-03, task-04, task-05, task-06, task-07, task-08, task-09, task-10, task-11]
blocks: []
requirement_ids: [FR-01, FR-02, FR-03, FR-04, FR-05, FR-06]
decision_ids: [D-001@v1, D-002@v1, D-003@v1]
allowed_paths:
  - frontend/src/components/daemon/__tests__/turn-segment-views.test.tsx
expects_from:
  task-05:
    - contract: SegmentViewProps
      needs: [segment]
  task-06:
    - contract: TurnTimelineProps
      needs: [turns, viewMode]
  task-07:
    - contract: TurnActivitySummary
      needs: [toolCount, currentActivity]
goal: >
  新增 turn-segment-views 段渲染单测（各段类型/折叠交互/扫动动画/视图两态/状态条派生），
  跑全量 frontend test 与 lint 终扫收口
implementation:
  - 新建 turn-segment-views.test.tsx，覆盖各段类型渲染（文本流式光标/思考折叠摘要/工具单行卡/stderr 行/子代理嵌套递归）
  - 折叠交互用例——思考摘要展开、工具结果展开、子代理块折叠
  - 运行中工具行扫动动画类名断言
  - 视图两态用例——对话视图显文本加状态条，进度视图显完整段序列
  - 状态条派生用例——工具计数含子代理递归、子代理清单、当前活动回退文案
  - 全量终扫确认 test 与 lint 全绿，发现实现缺陷回报不越界修
acceptance:
  - 新单测全绿且覆盖 design §6 段渲染维度清单
  - 全量 pnpm test 通过、pnpm lint 通过（plan 全局验收前两条）
verify:
  - cd frontend && pnpm test
  - cd frontend && pnpm lint
constraints:
  - 仅新增测试文件，不改任何实现文件（越界修复回报另立任务）
  - 不重复 task-03 已覆盖的装配器纯函数用例
related_tests: []
---
