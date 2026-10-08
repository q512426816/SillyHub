---
id: task-05
title: 'gen:types + 前端数据链：类型生成/lib 函数/query key'
title_zh: 'gen:types + 前端数据链：类型生成/lib 函数/query key'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-08 17:50:00
priority: P1
depends_on: [task-03]
blocks: [task-06, task-07, task-08]
requirement_ids: [FR-01, FR-02, FR-03]
decision_ids: [D-007@v1]
allowed_paths:
  - backend/openapi.json
  - frontend/src/lib/api-types.ts
  - frontend/src/lib/knowledge.ts
  - frontend/src/lib/query-keys.ts
target_files:
  - backend/openapi.json
  - frontend/src/lib/api-types.ts
  - frontend/src/lib/knowledge.ts
  - frontend/src/lib/query-keys.ts
goal: >
  前端类型零手写铁律落地：后端三端点就绪后立即 gen:types 并单独提交（R-05 并行会话守卫），lib 层加图函数与
  生成类型导出，query key 进集中工厂。
implementation:
  - 先核前端 node_modules 健康（CLAUDE.md 规则 21：pnpm exec tsc --version 可跑、.bin 有 shim；坏则 pnpm install --force）
  - cd frontend && pnpm gen:types（守卫有未提交生成物即中止——所以 task-02/03 的后端文件先提交）；提交 openapi.json + api-types.ts（独立提交，信息尾缀带变更名）
  - lib/knowledge.ts：export type KnowledgeGraph* = components["schemas"][...]（信封/分型全量导出）；getKnowledgeGraphQuery(sub, params)/getKnowledgeGraphOverview()/getKnowledgeGraphNodes(search, limit) 三函数（apiFetch GET，30s 缺省超时）；锚点参数 encodeKnowledgeFilename 思路按需（anchor 不含 / 时直接拼）
  - lib/query-keys.ts：knowledgeGraphQueryKey(wsId, params)/knowledgeGraphOverviewQueryKey(wsId)/knowledgeGraphNodesQueryKey(wsId, search)（凡影响结果的变量都进 key，D-004@v1 惯例）
acceptance:
  - api-types.ts 含 KnowledgeGraph* 全类型且与后端 schema 一致（gen:types:check 过）
  - lib 函数签名与 task-06/07/08 消费面匹配
verify:
  - cd frontend && pnpm gen:types:check
  - cd frontend && pnpm exec tsc --noEmit
constraints: >
  gen:types 前核 node_modules 健康；生成物单独提交（R-05 并行守卫）；类型零手写
---
# task-05
