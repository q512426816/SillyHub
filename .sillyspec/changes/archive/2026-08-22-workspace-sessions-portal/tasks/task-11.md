---
id: task-11
title: 'switch-scope-list-to-global-endpoint'
title_zh: '前端 scope 列表切全局端点'
author: qinyi
created_at: 2026-08-22 19:20:00
priority: P0
depends_on: ['task-10']
blocks: []
requirement_ids: [FR-04]
decision_ids: [D-003@v2]
allowed_paths:
  - frontend/src/lib/daemon.ts
  - frontend/src/components/sessions/session-list-panel.tsx
  - frontend/src/components/sessions/__tests__/session-list-panel.test.tsx
  - frontend/src/components/sessions/__tests__/sessions-portal.test.tsx
goal: >
  scope 模式复用 listAgentSessions 加过滤参（D-003@v2）——字段/筛选/分页与全局同构，删 v2 三段降级逻辑。
implementation:
  - daemon.ts 参数扩展
  - list-panel 单一查询路径+删瘦降级/客户端过滤/筛选隐藏（净 -87 行）
  - 两测试文件改写（16→18 与 10=10 语义映射）
acceptance:
  - 28/28 定向 + 全量 1906/1906 + tsc 零
verify:
  - cd frontend && pnpm exec vitest run src/components/sessions/__tests__/session-list-panel.test.tsx
constraints:
  - 禁删用例语义；越权即停
---
