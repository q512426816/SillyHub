---
id: task-04
title: router /api/llm-providers + main.py 挂载
title_zh: LLM 供应商路由与 main 挂载
author: qinyi
created_at: 2026-07-25 17:06:11
priority: P0
depends_on: [task-03]
blocks: [task-05, task-11, task-12]
requirement_ids: [FR-01]
decision_ids: [D-008@v1]
allowed_paths:
  - backend/app/modules/llm_provider/router.py
  - backend/app/main.py
provides:
  - contract: LlmProviderAPI
    fields:
      - "GET /api/llm-providers"
      - "POST /api/llm-providers"
      - "GET /api/llm-providers/{id}"
      - "PATCH /api/llm-providers/{id}"
      - "DELETE /api/llm-providers/{id}"
      - "POST /api/llm-providers/{id}/set-default"
goal: >
  暴露 /api/llm-providers REST CRUD（含 set-default），所有端点按 current_user.id 过滤，
  list/detail 仅返回 masked api_key，并在 main.py 挂载路由。
implementation:
  - router.py APIRouter(prefix=/llm-providers, tags=[llm_provider])，挂载时叠 /api（照 git_identity/router.py + main.py:477）
  - 依赖 SessionDep + CurrentUser=Depends(get_current_user)（auth_deps.py:56，owner 级非 admin，D-008）
  - GET / → LlmProviderList；POST / → 201 LlmProviderRead；GET /{id} → Read；PATCH /{id} → Read；DELETE /{id} → 204；POST /{id}/set-default → Read
  - main.py from app.modules.llm_provider.router import router as llm_provider_router + include_router(prefix=/api)（不改其他路由顺序）
acceptance:
  - 未登录 curl /api/llm-providers → 401；登录后 → 200 返回 masked 列表
  - 越权访问他人 provider id → 404/403；list/detail 响应 body 无明文 api_key、无 encrypted_api_key 列
verify:
  - cd backend && uv run uvicorn app.main:app
  - curl -i /api/llm-providers（无 token）实测 401；带 token 实测 200 且 body 无明文
constraints:
  - 所有端点经 CurrentUser 取 current_user.id 过滤（D-008），用 get_current_user 非 require_permission_any（owner 级非管理员专属）
  - list/detail 严禁返回明文 api_key 与 encrypted_api_key 列，仅经 service _to_read 输出 api_key_masked（R-02/R-04）
  - main.py 挂载照 git_identity 范式（import + include_router prefix=/api），不改其他 include 顺序
  - backend/app/modules/llm_provider/__init__.py 包标记需存在（design §6，task-01 建空文件，缺则补）
---
