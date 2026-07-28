---
id: task-04
title: backend/app/modules/llm_provider/router.py 加 POST /{provider_id}/usage（owner 级 get_current_user，跨用户 404/403 不泄漏存在性）。在 fetch-models 端点后追加，调 LlmProviderService.query_usage，response_model=UsageResult，瞬时错误由 AppError 自然冒泡交全局处理器转 5xx，确定性 success:false 原样 200 返回。覆盖 FR-03。依赖 task-03。
title_zh: router 加用量查询端点 POST /{id}/usage
author: qinyi
created_at: 2026-07-28 10:37:44
priority: P0
depends_on: [task-03]
blocks: [task-06]
requirement_ids: [FR-03]
decision_ids: [D-002@v1]
allowed_paths:
  - backend/app/modules/llm_provider/router.py
provides:
  - contract: UsageResponse
    fields: [success, data, error]
expects_from:
  task-03:
    - contract: UsageResult
      needs: [success, data, error]
goal: >
  暴露 owner 级用量查询 HTTP 端点 POST /{provider_id}/usage，薄转发 service.query_usage；
  瞬时错误（网络/5xx/429/超时）由 AppError 自然冒泡交全局处理器转 5xx（前端保留上次成功值），
  确定性结果（含 success:false）原样 200 返回；跨用户访问走既有 fetch-models/get_provider 范式
  → 404/403 不泄漏存在性。
implementation:
  - 在 fetch-models 端点（router.py:67-83）之后追加 `@router.post("/{provider_id}/usage", response_model=UsageResult)`，签名 `(provider_id:str, session:SessionDep, user:CurrentUser) -> UsageResult`，复用既有 owner 级 `get_current_user` + `_parse_id` 范式（同 get_provider/set_default）。
  - 函数体仅 `service = LlmProviderService(session); return await service.query_usage(_parse_id(provider_id), user.id)`；跨用户归属校验在 service 内（复用 fetch_models 的 user_id 过滤范式，跨用户 404/403 不泄漏）。
  - import 从 schema 补 `UsageResult`（task-01 产出）；不改既有 import。
  - 本层不做错误两态分类 / SSRF / detect / 解密（均 task-03 service 内）；service raise 的 AppError（瞬时 5xx）不经 try/except，自然冒泡交全局异常处理器（同 fetch_models 范式）。
  - 不改路由前缀（`/llm-providers`）与既有端点，纯追加一个端点。
acceptance:
  - POST /api/llm-providers/{id}/usage 200 返回 UsageResult（success:true 带 data:list[UsageData]，或 success:false 带 error:str）。
  - owner 级：跨用户访问 provider_id 经 service 归属校验 → 404/403 不泄漏存在性（同 get_provider）。
  - 瞬时错误（网络/5xx/429/超时）经 service raise AppError → 本层不吞 → 全局处理器转 5xx。
  - 确定性错误（401/403/空 key/未知供应商）service 返回 UsageResult{success:false}，本层不抛、原样 200 返回。
  - 路径与 fetch-models 同前缀 /llm-providers，端点位于 fetch-models 之后；既有 CRUD/set-unset-default/fetch-models 零回归。
verify:
  - cd backend && .venv/Scripts/python.exe -m pytest app/modules/llm_provider/tests/test_router*.py -q --no-cov
  - cd backend && .venv/Scripts/python.exe -c "from app.modules.llm_provider.router import router"
constraints:
  - owner 级不泄漏：复用既有 fetch-models/get_provider 范式（get_current_user + service 内 user_id 过滤），不加 require_permission_any。
  - 复用 fetch-models 范式，不改路由前缀 / 既有端点 / response_model 风格；纯追加一个端点。
  - 本层不做错误两态分类 / SSRF / detect / 解密（均 task-03 service 内）；AppError 不 try/except 吞掉。
  - brownfield 兼容：新端点不影响既有 CRUD/set-unset-default/fetch-models；api_key 明文不入响应（UsageResult 无 key 字段）。

---
