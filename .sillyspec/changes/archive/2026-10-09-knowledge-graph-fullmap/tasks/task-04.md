---
id: task-04
title: 'gen:types + lib：getKnowledgeGraphDump 与 query key'
title_zh: 'gen:types + lib：getKnowledgeGraphDump 与 query key'
author: 'qinyi'
created_at: '2026-10-09 00:52:00'
priority: P1
depends_on: [task-03]
blocks: [task-05]
requirement_ids: [FR-03, FR-04]
decision_ids: [D-002@v1]
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
  类型链闭环：gen:types 生成 dump 端点与 GraphDump* schema；lib 加 getKnowledgeGraphDump() 与
  knowledgeGraphDumpQueryKey(wsId)；apiFetch 透明解压 gzip（浏览器原生）。
implementation:
  - 先核 node_modules 健康；pnpm gen:types（守卫：task-03 后端文件先提交）；生成物单独提交
  - lib/knowledge.ts：GraphDumpNode/GraphDumpData 类型导出 + getKnowledgeGraphDump(wsId)（GET，timeout 60s——大回包）
  - query-keys.ts：knowledgeGraphDumpQueryKey(wsId) + queryKeys.knowledgeGraph.dump 失效入口
constraints: >
  类型零手写（生成物单一源）；gen:types 联跑副作用（provider-caps 纯行尾 diff）还原不提交（先例）
acceptance:
  - gen:types:check 过；tsc 零错
verify:
  - cd frontend && pnpm gen:types:check && pnpm exec tsc --noEmit
---
# task-04

