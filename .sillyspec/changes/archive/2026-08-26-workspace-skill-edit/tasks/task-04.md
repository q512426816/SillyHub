---
author: qinyi
created_at: 2026-08-26 19:45:00
id: task-04
title: "Frontend types regen"
title_zh: "前端类型重生成"
priority: P0
depends_on: [task-02]
allowed_paths:
  - frontend/src/lib/api-types.ts
  - backend/openapi.json
goal: gen:types 重生成并同提交
acceptance: |
  1. tsc 探针（规则 21/36；半坏 pnpm install --force）
  2. api-types 含 5 端点操作与请求/响应模型
  3. diff 仅含本变更端点相关；无关抖动如实报告
implementation: pnpm gen:types（worktree 内相对执行）
constraints: ["成对提交 api-types.ts + openapi.json"]
verify: cd frontend && pnpm exec tsc --noEmit -p tsconfig.json
expects_from:
  task-02:
    - contract: "REST 端点"
      needs: [OpenAPI schema]
provides:
  - contract: "api-types"
    fields: [skills 5 端点类型]
---

# task-04: 前端类型重生成

按 frontmatter acceptance 执行。
