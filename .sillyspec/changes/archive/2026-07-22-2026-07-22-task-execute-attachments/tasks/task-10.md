---
id: task-10
title: lib/ppm/types.ts 加 file_urls（FR-02,03,04）
title_zh: types.ts 5 类型加 file_urls
author: qinyi
created_at: 2026-07-22 22:16:15
priority: P0
depends_on: []
blocks: [task-11, task-12]
requirement_ids: [FR-02, FR-03, FR-04]
decision_ids: [D-001@v1]
allowed_paths:
  - frontend/src/lib/ppm/types.ts
provides:
  - contract: types.ts file_urls
    fields: [file_urls]
goal: >
  5 个前端类型加 file_urls，对齐后端 schema（task-03/05）可空性。
implementation:
  - TaskExecute（L1016-1036，attach_group_id L1026 后或字段末）加 file_urls: string[]（FR-04 执行记录表回显源）
  - ExecutePlanReq（L993-1006，end_remark L1005 后）加 file_urls?: string[] | null
  - ProblemExecuteReq（L862-872，execute_user_id L871 后）加 file_urls?: string[] | null
  - TaskExecuteCreate（L1051-1068，status L1067 前）加 file_urls?: string[]
  - TaskExecuteUpdate（L1070-1087，status L1086 前）加 file_urls?: string[] | null
acceptance:
  - pnpm typecheck 绿
  - 5 类型字段对齐后端（TaskExecute/Response 非空、请求/Update 可空、Create 非空可选）
verify:
  - cd frontend && pnpm typecheck
constraints:
  - D-001：file_urls 值=文件 id（string[]）
  - 可空性对齐后端 schema：TaskExecute.file_urls 非空（model default_factory=list）、ExecutePlanReq/ProblemExecuteReq/Update 可空（| None=None）、Create 非空可选（default_factory=list）
---

流程位置：Wave 4（前端，依赖后端就绪）。task-11/12 消费此类型。
