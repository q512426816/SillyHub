---
id: task-17
title: pnpm gen:types 同步 + client 类型迁生成版（规则 20）
title_zh: OpenAPI 类型同步
author: WhaleFall
created_at: 2026-08-15 09:55:21
priority: P1
depends_on: [task-02, task-06, task-07]
blocks: []
requirement_ids: [FR-01, FR-02]
decision_ids: [D-011@v1]
allowed_paths:
  - frontend/src/lib/api-types.ts
  - frontend/src/lib/daemon.ts
  - backend/openapi.json
provides: {}
expects_from: {}
goal: >
  后端 schema 变更后重新生成前端类型并把 lib/daemon.ts 会话类型迁到生成版，消除手写副本漂移。
implementation:
  - gen:types 前验证 node_modules 健康（pnpm exec tsc --version）
  - 运行 pnpm gen:types 产出 api-types.ts 与 openapi.json
  - lib/daemon.ts 的 SessionCreateRequest/SessionInjectRequest/AgentSessionRead 手写副本替换为 api-types 生成类型并修编译错误
  - 若暴露无关旧测试债按惯例顺手补字段修好
acceptance:
  - api-types.ts 含具名 SessionCreateRequest/SessionInjectRequest/LlmProviderQuotaResponse
  - tsc --noEmit 零错误且 daemon.ts 无手写会话 DTO 残留
verify:
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm exec vitest run src/lib
constraints:
  - node_modules 半坏时先 pnpm install --force 修复（规则 20）
  - 不改后端代码（只生成与消费）
related_tests: []
---
