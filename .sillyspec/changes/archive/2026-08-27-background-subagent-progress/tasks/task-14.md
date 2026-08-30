---
id: task-14
author: qinyi
created_at: 2026-08-27 09:36:00
priority: P2
title: 发送按钮空内容禁点
title_zh: 发送按钮空内容禁点
depends_on: [task-12]
blocks: []
allowed_paths:
  - frontend/src/components/daemon/session-panel.tsx
  - frontend/src/components/daemon/session-input-bar.tsx
  - frontend/src/components/daemon/__tests__/turn-timeline-session-input-bar.test.tsx
  - frontend/src/components/daemon/__tests__/session-panel-pre-session.test.tsx
  - frontend/src/components/daemon/__tests__/session-panel-dialog.test.tsx
provides: []
expects_from: []
goal: |
  前端侧空消息防御（FR-08 辅半）：输入 strip 为空时发送按钮 disabled。
implementation: |
  1. 定位发送按钮的 disabled 条件（page 与 dialog 两处挂载点共用同一 handler/state）。
  2. 条件追加 input.trim() 非空判断（附件-only 发送如既有支持则保持其例外口径——以现有 disabled 逻辑为准只收紧纯空文本）。
  3. 按钮aria-disabled/title 提示"消息内容不能为空"（与后端 422 文案一致）。
acceptance: |
  空输入/全空白输入发送按钮不可点；有附件无文本时维持现状（若现状允许）；非空输入不受影响。
verify: |
  cd frontend && pnpm exec tsc --noEmit && pnpm exec eslint src/components/daemon/session-panel.tsx；grep -n "trim()" src/components/daemon/session-panel.tsx 确认 disabled 条件含空文本判断；pnpm vitest run src/components/daemon/__tests__/（session-panel 既有相关用例回归绿）。
constraints: |
  与 task-12 同文件——依赖其完成后才动（Wave 隔离）；不改发送请求构造逻辑。
---
