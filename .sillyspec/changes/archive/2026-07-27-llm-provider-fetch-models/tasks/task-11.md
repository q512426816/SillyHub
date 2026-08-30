---
id: task-11
title: "lib/api/llm-providers.ts 加 fetchProviderModels + 类型加 settings_config + form payload"
title_zh: 前端 API 加 fetchProviderModels+settings_config
author: qinyi
created_at: 2026-07-27 09:47:54
priority: P0
depends_on: []
blocks: [task-09, task-10, task-14]
requirement_ids: [FR-01, FR-06]
decision_ids: []
allowed_paths:
  - frontend/src/lib/api/llm-providers.ts
provides:
  - contract: fetchProviderModels return
    fields: [models]
  - contract: LlmProviderFormValues
    fields: [settings_config]
expects_from:
  task-02:
    - contract: FetchModelsResponse
      needs: [models]
goal: >
  前端 lib/api 加 fetchProviderModels 调 POST /api/llm-providers/fetch-models（双形态 body），LlmProviderCreate/Update/Read 类型加 settings_config，LlmProviderFormValues + formToCreate/formToUpdate 提交 payload 携带 settings_config（design §6.1，FR-01/FR-06 前端侧）。
implementation:
  - 加 fetchProviderModels(req: {provider_id?:string} | {base_url:string, api_key:string, auth_field?:LlmProviderAuthField}) → apiFetch POST /api/llm-providers/fetch-models，json:req，返回 {models:[{id:string, owned_by:string|null}]}（消费 task-02 FetchModelsResponse；新建态 base_url+key 用完即弃，不落本地存储/日志）
  - LlmProviderCreate / LlmProviderUpdate / LlmProviderRead 三类型加 settings_config?: Record<string,any> | null（对齐后端 schema；Read 的 null 经 ?? null 归一，frontend-type-migration 坑）
  - LlmProviderFormValues 加 settings_config: Record<string,any> | null（配置 JSON 面板 task-10 产出）
  - formToCreate(line 232) + formToUpdate(line 253) 返回对象追加 settings_config: v.settings_config ?? null（与 extra_env 同语义；旧数据 null 透传）
acceptance:
  - fetchProviderModels 双形态都发对请求：{provider_id} 编辑态 / {base_url,api_key,auth_field?} 新建态，POST 到 /api/llm-providers/fetch-models，返回 models 数组
  - LlmProviderFormValues 及 formToCreate/formToUpdate 提交 payload 含 settings_config 字段
  - LlmProviderCreate/Update/Read 类型含 settings_config，与后端 OpenAPI schema 对齐（nullable → ?? null）
  - 不改既有 CRUD 函数签名（listProviders/createProvider/updateProvider/deleteProvider/setDefaultProvider/unsetDefaultProvider）
verify:
  - cd frontend && pnpm typecheck
  - cd frontend && pnpm test
constraints:
  - 双形态联合类型：{provider_id} 编辑态（后端解密）/ {base_url,api_key,auth_field?} 新建态用完即弃，前端永不存明文 key（design §2/§8 安全）
  - settings_config 可空：旧数据后端 None → Read 走 ?? null；前端只透传，null 语义（清空/不动）由后端 PATCH 决定
  - 类型对齐后端 OpenAPI（nullable 必须 ?? null，frontend-type-migration 坑）；formToCreate/formToUpdate 仅追加 settings_config 字段，不动既有字段
---
