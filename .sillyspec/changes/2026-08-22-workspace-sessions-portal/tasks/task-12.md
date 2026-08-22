---
id: task-12
title: 'rework-regression-deploy-recheck'
title_zh: '返工回归部署与三入口复验'
author: qinyi
created_at: 2026-08-22 19:20:00
priority: P0
depends_on: ['task-11']
blocks: []
requirement_ids: [FR-04]
decision_ids: [D-003@v2]
allowed_paths:
  - frontend/src/components/sessions/sessions-portal.tsx
  - backend/openapi.json
  - frontend/src/lib/api-types.ts
goal: >
  v3 返工收尾——全量回归、gen:types 同步（openapi.json+api-types.ts，规则 21）、3001 重建部署、三入口列表一致性复验（含 sessions-portal.tsx:137 陈旧注释校正）。
implementation:
  - 全量 vitest+tsc+lint
  - worktree 提交+assess 合入+3001 重建
  - 浏览器三入口复验（列表字段/筛选条/分页一致性）+ 注释校正
acceptance:
  - 全量零失败；3001 三入口复验通过；用户复验闭环
verify:
  - cd frontend && pnpm test
constraints:
  - 不改产品逻辑（仅注释校正）
---
