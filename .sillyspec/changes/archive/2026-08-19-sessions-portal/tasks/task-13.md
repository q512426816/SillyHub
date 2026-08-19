---
id: task-13
title: 前端抽共享子组件 TurnTimeline/SessionInputBar（弹窗零回归，覆盖 FR-05, D-002@v1）
title_zh: 交互式会话面板子组件抽取
author: WhaleFall
created_at: 2026-08-15 09:55:21
priority: P1
depends_on: []
blocks: [task-14]
requirement_ids: [FR-05, FR-07]
decision_ids: [D-002@v1]
allowed_paths:
  - frontend/src/components/daemon/interactive-session-panel.tsx
  - frontend/src/components/daemon/__tests__/
  - frontend/src/components/daemon/
provides:
  - contract: SessionPanelSubcomponents
    fields: [TurnTimeline, SessionInputBar]
expects_from: {}
goal: >
  从 interactive-session-panel.tsx 抽出消息流与输入区共享子组件，供 /runtimes 弹窗与 /sessions 新页面共同组装（弹窗行为零回归）。
implementation:
  - 抽 TurnTimeline（消息流渲染：气泡/工具条目/状态徽章/对话与全部切换）
  - 抽 SessionInputBar（输入框/发送/打断/结束按钮区）
  - interactive-session-panel.tsx 改为组装共享子组件，props 与对外行为不变
  - 同步更新既有弹窗测试的导入与组装路径
acceptance:
  - runtime-session-dialog 三套既有测试（panel/dialog/reconnect）全绿零回归
  - 子组件可被新页面独立 import（无弹窗上下文依赖）
verify:
  - cd frontend && pnpm exec vitest run src/components/daemon
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - 只做抽取不改行为（DOM 结构尽量稳定，测试选择器不变）
  - who 行快照渲染归 task-14，不在本 task 改消息头部逻辑
related_tests:
  - path: frontend/src/components/daemon/__tests__/interactive-session-panel.test.tsx
    reason: 抽组件后导入路径/组装方式变化需同步
  - path: frontend/src/components/daemon/__tests__/interactive-session-panel-offline.test.tsx
    reason: 同上
  - path: frontend/src/components/daemon/__tests__/interactive-session-panel-changeid.test.tsx
    reason: 同上
---
