---
id: task-12
title: 前端 API + types + 单测
title_zh: 前端 API 封装（lib/api/llm-providers.ts）+ types 对齐 + 表单提交单测
author: qinyi
created_at: 2026-07-25 17:06:11
priority: P0
depends_on: [task-11]
blocks: [task-13]
requirement_ids: [FR-06]
decision_ids: []
allowed_paths:
  - frontend/src/lib/api/llm-providers.ts
  - frontend/src/lib/api/__tests__/llm-providers.test.ts
  - frontend/src/lib/api-types.ts
goal: >
  封装 /api/llm-providers 的 list/create/update/delete/set_default 调用，types 对齐后端 schema（含
  model_role_mappings / extra_env 嵌套结构），单测覆盖表单提交→API 调用映射。
expects_from:
  task-11:
    - contract: LlmProviderFormValues
      needs: [name, agent_kind, base_url, api_key, auth_field, model_role_mappings, default_fallback_model, extra_env, is_default]
implementation:
  - lib/api/llm-providers.ts：listProviders / createProvider / updateProvider / deleteProvider / setDefaultProvider，复用 apiFetch（@/lib/api），照 api-keys.ts 范式
  - types：优先复用 OpenAPI 生成（api-types 的 components schemas LlmProvider*）；未生成则手写 LlmProviderRead/Create/Update，含 model_role_mappings（每角色含 display/model/one_m，整体可空）与 extra_env（KEY→VALUE 键值对，可空）嵌套结构
  - api_key：Create 必传、Update 可选（undefined/空串=不动原密钥，照后端 None 语义）
  - 单测：表单值→请求 body 映射正确（角色映射嵌套结构、extra_env 键值对、api_key 留空不出现在 PATCH body）
acceptance:
  - 五个方法签名与 task-04 router 一一对应（method + path）
  - types 与后端 LlmProviderRead/Create/Update 字段对齐（含嵌套）
  - 单测断言表单提交落到正确的 method + path + body
verify:
  - cd frontend && pnpm typecheck
  - cd frontend && pnpm test
constraints:
  - 优先复用 OpenAPI 生成类型，避免手写漂移（frontend-type-migration 坑）
  - api_key 明文仅出现在 POST/PATCH 请求 body，绝不落日志/本地存储
  - 跨平台命令链（pnpm 走 npm scripts，Win/Linux/macOS 通用）
---
