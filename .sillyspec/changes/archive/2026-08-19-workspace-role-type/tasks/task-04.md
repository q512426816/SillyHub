---
id: task-04
title: regen-api-types-for-workspace-type
title_zh: gen:types 重新生成前端 API 类型与 OpenAPI
author: qinyi
created_at: 2026-08-18 23:11:29
priority: P0
depends_on: [task-01]
blocks: [task-05]
requirement_ids: [FR-01]
decision_ids: [D-002@v1]
allowed_paths:
  - frontend/src/lib/api-types.ts
  - backend/openapi.json
provides:
  - contract: WorkspaceType 8 值字面量联合类型（源自 WorkspaceCreate.type 枚举）
    fields: [type, description, role]
expects_from:
  task-01:
    - contract: WorkspaceCreate/WorkspaceUpdate/WorkspaceRead/WorkspaceBrief
      needs: [type, role, description]
goal: >
  后端 schema 落盘后重新生成 api-types.ts 与 openapi.json，让 8 值词表以枚举形态进入前端类型（FR-01 验收前置）。
implementation:
  - cd frontend && pnpm exec tsc --version 确认 node_modules 健康；失败先 pnpm install --force 再复验（R-05）
  - cd frontend && pnpm gen:types（scripts/gen-api-types.mjs）
  - git diff 复核两产物——WorkspaceCreate.type 进 required 且 enum 8 值；WorkspaceRead/WorkspaceBrief 含 description；WorkspaceUpdate.type 带枚举；list 接口 query 参数含 unclassified 布尔
  - 只落盘生成产物，不手改生成文件
acceptance:
  - openapi.json 中 WorkspaceCreate.type 为必填且 enum 恰含 8 个词表值
  - api-types.ts 出现 8 值字面量联合类型，Read/Brief/Update 新字段齐全
verify:
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - 本卡不改任何手写源码；若既有代码与新生成类型冲突，记录留给 task-05+ 修，不在本卡动源码
  - api-types.ts 禁止手写（CLAUDE.md 规则 21），生成后须同 change 提交两产物
---
