---
id: task-06
title: frontend/src/lib/api/llm-providers.ts 加 queryUsage(id) → POST /api/llm-providers/{id}/usage + UsageResult/UsageData 类型（对齐后端 schema）。覆盖 FR-03 前端。依赖 design §7 契约，可与 Wave1 并行。
title_zh: 前端 api 客户端加用量查询
author: qinyi
created_at: 2026-07-28 10:37:44
priority: P0
depends_on: []
blocks: [task-08, task-09]
requirement_ids: [FR-03]
decision_ids: [D-002@v1]
allowed_paths:
  - frontend/src/lib/api/llm-providers.ts
provides:
  - contract: UsageResult
    fields: [success, data, error]
  - contract: UsageData
    fields: [plan_name, is_valid, total, used, remaining, unit, extra]
  - contract: queryUsage
    fields: [id, response]
expects_from:
  task-04:
    - contract: UsageResponse
      needs: [success, data, error]
goal: >
  前端 api 客户端加 queryUsage 函数与 UsageResult/UsageData TS 类型，对齐后端
  snake_case schema（design §7.2），复用 apiFetch 调 POST /api/llm-providers/{id}/usage，供 usage-footer 与 list 消费。
implementation:
  - 在 fetchProviderModels 后追加；UsageData/UsageResult 用 export interface 对齐 schema.py snake_case（plan_name/extra/is_valid/invalid_message/total/used/remaining/unit + success/data:list[UsageData]|null/error），字段全 optional（后端 Optional）。
  - 新增 queryUsage(id) 函数：用 apiFetch 对 UsageResult 类型发起 POST 请求到 /api/llm-providers/<id>/usage（id 做 encodeURIComponent、无请求体，owner 鉴权靠 path 上的 id），返回 UsageResult；类型与函数一并 export（同现有 fetchProviderModels 风格）。
  - brownfield：不改既有 listProviders/createProvider/updateProvider/deleteProvider/set/unsetDefault/fetchProviderModels 及表单映射函数。
acceptance:
  - queryUsage 调对路径 POST /api/llm-providers/{id}/usage（id encodeURIComponent）；UsageResult/UsageData 字段对齐后端 schema.py，snake_case 与既有 LlmProviderRead 一致。
  - pnpm exec tsc --noEmit 与 pnpm lint 无错；不影响现有导出与调用。
verify:
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm lint
constraints:
  - 类型对齐后端 schema.py（snake_case），与既有手写 LlmProviderRead 等同源（OpenAPI 生成类型尚未覆盖本模块）。
  - 复用现有 apiFetch（@/lib/api），不另起 fetch / 不引新依赖；纯追加，不改既有导出 / 调用 / 表单映射。
---
