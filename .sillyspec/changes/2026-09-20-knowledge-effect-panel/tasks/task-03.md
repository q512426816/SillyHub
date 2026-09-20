---
id: task-03
title: 'facade use_count and gen types'
title_zh: '联调门面（list 透传 use_count+gen:types 提交）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-20 22:20:00
priority: P0
depends_on: [task-01, task-02]
blocks: [task-04, task-05]
requirement_ids: [FR-06]
decision_ids: [D-007]
allowed_paths:
  - backend/app/modules/knowledge/service.py
  - backend/app/modules/knowledge/hits.py
  - backend/openapi.json
  - frontend/src/lib/api-types.ts
target_files:
  - backend/app/modules/knowledge/service.py
  - backend/openapi.json
  - frontend/src/lib/api-types.ts
provides:
  - contract: KnowledgeEntryRead
    fields: [use_count, zone]
expects_from:
  task-01:
    - contract: KnowledgeStatsOut
      needs: [entry_counts]
goal: >
  联调门面：列表透传文件级 use_count（entry_counts 关联）+ gen:types 再生成提交，前端类型就绪。
implementation:
  - service.list_knowledge 关联 hits 聚合 entry_counts 按 filename 前缀匹配附 use_count（KnowledgeEntryRead 增可选字段）
  - pnpm gen:types 提交 api-types.ts 与 openapi.json（provider-caps 纯 EOL churn 还原）
acceptance:
  - 列表项含 use_count（无数据为 0）
  - api-types 含 KnowledgeStatsOut 与 HitsBatchOut 与 use_count，前端 tsc 0
verify:
  - cd backend && uv run pytest app/modules/knowledge -q
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - 不做组件（task-04 与 05 范围）
  - use_count 可选缺省对旧客户端零回归
---
