---
id: task-07
title: 'ppm smart entry and url context hook'
title_zh: 'PPM 智能入口与 URL 上下文派生'
author: 'qinyi'
created_at: 2026-08-25 03:14:30
priority: P0
depends_on: [task-05, task-06]
blocks: []
requirement_ids: [FR-6]
decision_ids: [D-007]
allowed_paths:
  - frontend/src/hooks/use-page-session-context.ts
  - frontend/src/hooks/use-page-session-context.test.ts
  - frontend/src/app/(dashboard)/ppm/projects/page.tsx
goal: >
  第一个智能入口：PPM 项目行发起团队按钮唤起悬浮抽屉并携带项目上下文；
  URL 派生 hook 供上下文条默认感知。
implementation:
  - use-page-session-context：pathname /ppm 前缀加 pm_project_id/projectId 查询参派生 ppm_project 上下文，其余页面 null
  - ppm/projects 行按钮改调 floating startPreSession 携带 page_key 与 row.id
  - 移除原 router.push 跳转（门户 ?new=1 路径本身保留）
acceptance:
  - hook 派生单测通过（含非 PPM 页 null）
  - 按钮点击后 store 进入预会话态且携带 pageContext
verify:
  - cd frontend && pnpm exec vitest run src/hooks/use-page-session-context.test.ts
constraints:
  - 不改 ppm 页面其它行为
  - hook 纯派生不发请求
---
# task-07 PPM 智能入口
