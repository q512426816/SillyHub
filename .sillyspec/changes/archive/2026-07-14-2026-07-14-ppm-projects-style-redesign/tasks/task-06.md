---
id: task-06
title: `tsc --noEmit` + `pnpm lint` 通过
title_zh: 类型检查与 lint 通过
author: WhaleFall
created_at: 2026-07-14 11:00:55
priority: P0
depends_on: [task-01, task-02, task-03, task-04, task-05]
blocks: [task-07]
requirement_ids: []
decision_ids: []
allowed_paths:
  - frontend/src/components/ppm-resource-table.tsx
  - frontend/src/components/ppm-project-members-table.tsx
  - frontend/src/app/(dashboard)/ppm/projects/page.tsx
goal: >
  对全部前端改动跑类型检查与 lint，确保零编译错误、零 lint 错误。
implementation:
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm lint
  - 修复报告的类型/lint 问题（仅样式相关，不改业务逻辑）
acceptance:
  - tsc --noEmit 退出码 0
  - pnpm lint 无 error
verify:
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm lint
constraints:
  - 不为通过 lint 而改业务逻辑
  - 命令优先用 local.yaml 配置
---
