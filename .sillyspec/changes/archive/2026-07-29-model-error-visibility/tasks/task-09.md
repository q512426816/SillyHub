---
id: task-09
title: frontend RunErrorItem 组件 + 单测
title_zh: 前端运行错误展示组件与单测
author: qinyi
created_at: 2026-07-29 10:34:02
priority: P0
depends_on: [task-08]
blocks: [task-10]
requirement_ids: [FR-03]
decision_ids: [D-002@v1, D-004@v1]
allowed_paths:
  - frontend/src/components/agent-log/run-error-item.tsx
  - frontend/src/components/agent-log/__tests__/run-error-item.test.tsx
provides:
  - contract: RunErrorItem
    fields: [type, code, message, retryable, hint, raw]
expects_from:
  task-08:
    - contract: ErrorLogItem
      needs: [type, code, message, retryable, hint, raw]
goal: >
  新增 RunErrorItem 组件，按 error type 映射图标/颜色/文案，显示 message/hint 与 actions（重发/切换供应商/查看详情）。
implementation:
  - 新增 run-error-item.tsx，type 到图标/颜色的映射表（8 类）
  - 显示「运行失败」标题 + message + hint（针对性建议）
  - actions 按钮回调 props（重发/切换供应商/查看详情），组件只发事件不直接调 API
  - 查看详情展开 raw（原始错误文本）
  - 新增 run-error-item.test.tsx 覆盖各 type 渲染与 actions 触发
acceptance:
  - 各 type 渲染对应图标/颜色/文案
  - message 与 hint 正确显示
  - actions 按钮触发回调（重发/切换供应商/查看详情）
  - 查看详情展开 raw
verify:
  - cd frontend && pnpm typecheck
  - cd frontend && pnpm test components/agent-log/__tests__/run-error-item.test.tsx
constraints:
  - 组件只发 action 事件，不直接调 inject/路由（集成留 task-10）
  - 参考前端样式系统（CLAUDE.md 规则19）
  - type 映射含 unknown 兜底
---
