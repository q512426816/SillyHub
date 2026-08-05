---
id: task-13
title: 前端 terminating 态显示（覆盖 FR-04 展示, R-08）
title_zh: 前端终止中状态显示
author: qinyi
created_at: 2026-08-05 19:24:02
priority: P2
depends_on: [task-10]
blocks: []
requirement_ids: [FR-04]
decision_ids: []
allowed_paths:
  - frontend/src/components/daemon/interactive-session-panel.tsx
  - frontend/src/lib/api-types.ts
  - backend/app/modules/daemon/schema.py
  - backend/app/modules/daemon/router.py
expects_from:
  task-10:
    - contract: DaemonTaskLease.terminating_at
      needs: [terminating_at]
goal: >
  会话面板在 lease 处于 terminating 态（terminating_at 非空）显示终止中而非立刻已停止，并对齐打断本轮与取消 run 两按钮文案（R-08）。RS-3（Wave 2 发现）：terminating_at 需在响应 DTO 暴露才能被前端消费（task-10 仅加了 ORM 字段未暴露）。
implementation:
  - "RS-3（Wave 2 扩展本 task 范围）：task-10 只加了 DaemonTaskLease.terminating_at ORM 字段 + migration，未暴露到任何响应 DTO（openapi.json 0 处），前端无法消费。本 task 扩展为在 AgentSessionRead（会话详情 DTO）暴露 terminating_at，router 层 join DaemonTaskLease（经 session.lease_id）取值。"
  - schema.py 的 AgentSessionRead 加 terminating_at: datetime | None = None（默认 None，brownfield 不破坏既有构造）
  - router.py 所有构建 AgentSessionRead 的端点（含面板消费的 session 详情/列表）populate terminating_at（join lease 或额外查询）
  - 跑 gen:types（frontend，重建 openapi.json + frontend api-types.ts）；daemon 不消费此字段，daemon api-types.ts 不强制重生成（避免与 task-08 并发改 daemon 文件竞态）
  - interactive-session-panel.tsx 根据 session.terminating_at 显示终止中
  - 确认打断本轮与取消 run 两按钮文案和反馈对齐（R-08）
acceptance:
  - terminating_at 在 AgentSessionRead 暴露并经 router populate
  - terminating_at 非空时面板显示终止中
  - 打断本轮与取消 run 两按钮文案对齐
verify:
  - cd backend && uv run pytest app/modules/daemon -q --no-cov
  - cd backend && uv run ruff check app/modules/daemon && uv run mypy app/modules/daemon
  - cd frontend && pnpm gen:types
  - cd frontend && pnpm typecheck
  - cd frontend && pnpm test --silent
constraints:
  - budget 进度条后置不做
  - 后端只新增 terminating_at 的 DTO 暴露（schema + router join），不改 ORM 字段本身（task-10 已完成）、不改 lease.status 状态机
  - daemon api-types.ts 不强制重生成（daemon 不消费 AgentSessionRead.terminating_at）
---
