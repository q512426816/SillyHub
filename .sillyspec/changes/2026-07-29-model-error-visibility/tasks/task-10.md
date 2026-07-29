---
id: task-10
title: frontend 会话页集成 RunErrorItem + failed 标红 + actions
title_zh: 前端会话页集成错误展示与操作
author: qinyi
created_at: 2026-07-29 10:34:02
priority: P0
depends_on: [task-08, task-09]
blocks: [task-11]
requirement_ids: [FR-03]
decision_ids: [D-002@v1, D-004@v1]
allowed_paths:
  - frontend/src/components/agent-log-viewer.tsx
  - frontend/src/components/runtime-session-dialog.tsx
provides:
  - contract: SessionErrorDisplay
    fields: [display]
expects_from:
  task-08:
    - contract: ErrorLogItem
      needs: [type, code, message, retryable, hint, raw]
  task-09:
    - contract: RunErrorItem
      needs: [type, code, message, retryable, hint, raw]
goal: >
  会话页（agent/runtime 页）渲染 RunErrorItem，run/session failed 状态标红，接通 actions（重发 inject/切换供应商/查看详情）。
implementation:
  - agent-log-viewer.tsx 渲染 error 类日志项为 RunErrorItem
  - 会话页 run failed 时状态标红（先定位确切接入组件 runtime-session-dialog 或 agent 页）
  - 重发 action 复用现有 inject 链路重新提交同一 prompt
  - 切换供应商 action 跳 llm-provider 设置页
  - 查看详情展开 raw（RunErrorItem 已实现，此处接状态）
acceptance:
  - 会话页 run failed 时显示 RunErrorItem 错误项
  - run/session failed 状态标红
  - 重发/切换供应商/查看详情 actions 可用
verify:
  - cd frontend && pnpm typecheck
  - cd frontend && pnpm test
constraints:
  - 重发复用现有 inject 链路，不新建提交逻辑
  - 接入组件 execute 前确认（agent 页 vs runtime 页，design §12 存疑）
  - 不影响 PPM 模块
---
