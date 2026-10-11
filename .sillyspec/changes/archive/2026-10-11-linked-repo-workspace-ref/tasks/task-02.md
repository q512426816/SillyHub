---
id: task-02
title: 'frontend 表单下拉+列表跳转+回显匹配提示+gen:types（FR-04）'
title_zh: 'frontend 表单下拉+列表跳转+回显匹配提示+gen:types（FR-04）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-11 16:58:00
priority: P0
depends_on: [task-01]
blocks: []
requirement_ids: [FR-04]
decision_ids: [D-001@v1, D-002@v1]
allowed_paths:
  - frontend/src/components/workspace/linked-repos-card.tsx
  - frontend/src/components/workspace/linked-repos-form.tsx
  - frontend/src/components/workspace/__tests__/linked-repos-card.test.tsx
  - frontend/src/lib/linked-repos.ts
  - frontend/src/lib/api-types.ts
  - frontend/src/lib/provider-caps.ts
  - backend/openapi.json
target_files:
  []
expects_from:
  task-01:
    ref-workspace-api: "见 task-01 provides.ref-workspace-api"

goal: >
  前端表单下拉（选平台工作区）+ 列表跳转 + 回显匹配提示 + gen:types 再生成
implementation:
  - lib/linked-repos.ts 类型扩展（ref_workspace/matched_workspace）
  - linked-repos-form.tsx 下拉：数据源 listWorkspaces 可见集（排除自身），antd Select showSearch
  - linked-repos-card.tsx 列表：已挂载条目显示对方名+跳转图标（router push /workspaces/{id}）；回显 matched_workspace 命中显示「匹配到 XX」提示条
  - pnpm gen:types + api-types/openapi/provider-caps 同源提交
  - 测试：跳转交互/match 提示渲染/下拉选项排除自身/空态回归
acceptance:
  - FR-04 GWT 全过；typecheck/lint 过；老条目回归零变化
verify:
  - cd frontend && pnpm vitest run src/components/workspace/__tests__/linked-repos-card.test.tsx && pnpm typecheck && pnpm lint
constraints:
  - api-types 禁手写；零硬编码 hex；不自动拉工作区列表（表单打开时拉一次）
---
