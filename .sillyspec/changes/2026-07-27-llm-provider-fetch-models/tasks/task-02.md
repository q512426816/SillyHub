---
id: task-02
title: llm_provider fetch-models 端点（双形态 body + httpx + 候选 URL 兜底 + 错误分类）
title_zh: fetch-models 端点（双形态+候选URL+错误分类）
author: qinyi
created_at: 2026-07-27 09:47:54
priority: P0
depends_on: []
blocks: [task-03, task-11, task-12]
requirement_ids: [FR-01, FR-02, FR-03]
decision_ids: [D-001, D-006]
allowed_paths:
  - backend/app/modules/llm_provider/router.py
  - backend/app/modules/llm_provider/service.py
provides:
  - contract: FetchModelsResponse
    fields: [models]
goal: >
  新增 POST /api/llm-providers/fetch-models（owner 级 get_current_user），双形态 body 经 httpx.AsyncClient(timeout=10) 拉上游 /v1/models，返回 {models:[{id,owned_by}]}（design §5.1 D-001/D-006）。
implementation:
  - router.py 加 @router.post("/fetch-models")（CurrentUser owner 级）；请求体 FetchModelsRequest 双形态 {provider_id} 或 {base_url,api_key,auth_field?}；响应 FetchModelsResponse{models:[{id:str,owned_by:str|None}]}
  - service.fetch_models 双形态解析：provider_id → service.get(row) + get_cipher().decrypt(encrypted_api_key, key_id) 取明文 key + auth_field + base_url；{base_url,api_key,auth_field?} 直传不落库
  - httpx.AsyncClient(timeout=10)；鉴权头按 auth_field：ANTHROPIC_AUTH_TOKEN → Authorization: Bearer <key>；ANTHROPIC_API_KEY → x-api-key:<key> + anthropic-version:2023-06-01
  - 候选 URL：base_url.rstrip('/')+'/v1/models'；遇 404/405 剥离尾部 /anthropic、/compatibility、/api 子路径再试（顺序不并发，NFR-03 防中转站限流）
  - 错误分类抛 AppError 子类：401/403→LLM_PROVIDER_AUTH_FAILED；404/405 终→LLM_PROVIDER_MODELS_UNSUPPORTED；候选全失败→LLM_PROVIDER_MODELS_ALL_FAILED；超时→LLM_PROVIDER_MODELS_TIMEOUT
acceptance:
  - 双形态均能拉模型（provider_id 形态后端解密成功 / base_url+api_key 形态直传不写库）
  - 鉴权头按 auth_field 正确（ANTHROPIC_AUTH_TOKEN 走 Bearer / ANTHROPIC_API_KEY 走 x-api-key+version）
  - 候选 URL 404 兜底：首个 /v1/models 404/405 时剥离 /anthropic 等子路径再试能成功
  - 4 类错误码正确分类（AUTH_FAILED / MODELS_UNSUPPORTED / MODELS_ALL_FAILED / MODELS_TIMEOUT）
  - api_key 明文永不回传前端（响应只含 models；新建态用完即弃不入库不入日志）
verify:
  - cd backend && uv run mypy app
  - cd backend && uv run ruff check .
  - cd backend && uv run pytest app/modules/llm_provider -q --no-cov
constraints:
  - 新建态 api_key 用完即弃不落库；编辑态只收 provider_id 不收明文 key；fetch-models 是无状态查询（POST 仅因双形态 body，无副作用不创建实体，design §9 豁免生命周期契约表）
  - SSRF 防护实现归 task-03（复用 tool_policy._check_not_private_ip + 补 IPv6 + getaddrinfo 包 asyncio.to_thread），本 task 仅在 httpx 调用前预留挂钩点（占位 await），不写私网判定逻辑
  - models 项结构固定 {id:str, owned_by:str|null}，前端 task-11 消费此响应；跨平台 Win/Linux/macOS
---
