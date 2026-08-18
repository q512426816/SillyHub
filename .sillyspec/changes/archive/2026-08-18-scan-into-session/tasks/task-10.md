---
id: task-10
title: verify-full-regression
title_zh: 全量验证与全局验收
author: qinyi
created_at: 2026-08-17 14:10:00
priority: P0
depends_on: [task-01, task-02, task-03, task-04, task-05, task-06, task-07, task-08, task-09]
blocks: []
requirement_ids: [FR-01, FR-02, FR-03, FR-04, FR-05, FR-06, FR-07]
decision_ids: [D-001@v1, D-002@v1, D-003@v1, D-004@v1]
allowed_paths:
  - backend/app/modules/agent/service.py
  - frontend/src/components/workspace-config-card.tsx
  - frontend/src/components/workspace-session-section.tsx
  - frontend/src/app/(dashboard)/workspaces/[id]/page.tsx
provides: []
expects_from: []
goal: >
  全量验证本变更达成设计目标：backend 模块级 pytest、frontend vitest、lint、typecheck 与死链 grep 复查全部通过，并对照 design.md 全局验收标准逐条确认。
implementation:
  - backend 模块级 pytest 跑 agent 与 workspace 与 change 与 daemon 相关测试
  - frontend 跑 vitest 全量测试并执行 pnpm exec tsc --noEmit 类型检查
  - 跑 lint 检查，backend 为 ruff check 与 ruff format --check 与 mypy app，frontend 为 pnpm lint
  - 死链 grep 复查 href agent 与 workspaces 路径下 /agent 相关导航入口
  - 对照 design.md 全局验收标准逐条确认并记录核对结果
acceptance:
  - backend pytest 相关模块全绿，覆盖 workspace 与 agent 与 change 与 daemon
  - frontend vitest 全量全绿且 tsc 无错误
  - lint 检查全部通过，backend 与 frontend 均无报错
  - 死链 grep 复查结果为零，智能体控制台导航入口无残留
  - design.md 全局验收标准逐条达成
verify:
  - cd backend 后执行 uv run pytest app/modules/workspace app/modules/agent app/modules/change app/modules/daemon -q --no-cov
  - cd frontend 后执行 pnpm test 与 pnpm exec tsc --noEmit 与 pnpm lint
constraints:
  - 本任务仅做全量验证与核对，不修改任何源码
  - 非测试逻辑本身有误时禁止修改测试来通过
  - 验证结论须与 design.md 全局验收标准逐条对照并如实记录
---
