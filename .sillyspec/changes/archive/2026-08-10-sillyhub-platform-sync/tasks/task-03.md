---
id: task-03
title: require_platform_sync auth dependency Bearer APIKey/JWT
title_zh: require_platform_sync 鉴权依赖 Bearer=APIKey优先/JWT回退
author: qinyi
created_at: 2026-08-10 23:45:00
priority: P0
depends_on: []
blocks: [task-06]
requirement_ids: [FR-02]
decision_ids: [D-002@v1]
allowed_paths:
  - backend/app/modules/platform_sync/auth.py
goal: >
  新建 require_platform_sync FastAPI 依赖：从 Authorization: Bearer 取 token，
  识别 shk_live_ 前缀走 ApiKeyService.authenticate，否则回退 JWT(get_current_user)。
  不做 workspace 权限检查（平台级聚合无 workspace 语义）。
implementation:
  - 新建 backend/app/modules/platform_sync/auth.py
  - 复用 core/auth_deps._extract_bearer(request) 取 token；无 token → raise AuthTokenMissing（401）
  - if token.startswith(API_KEY_PREFIX='shk_live_'): user = await ApiKeyService(session, settings=settings).authenticate(plaintext=token)；user is None → raise AuthTokenInvalid（401）
  - else: user = await get_current_user(request, session, settings)（JWT 解码，失败自动 raise AuthTokenInvalid/Expired）
  - 返回 user（router 不一定用，但鉴权副作用即门控）
  - 不调 has_permission / 不查 workspace（平台级，D-002）
acceptance:
  - 无 Authorization header → 401
  - 合法 shk_live_ API Key → 通过（ApiKeyService.authenticate 返回 User）
  - 合法 JWT → 通过（get_current_user）
  - 非法/过期/吊销 token → 401
  - 不做 workspace 权限检查
verify:
  - cd backend && uv run ruff format --check app/modules/platform_sync && uv run ruff check app/modules/platform_sync
  - cd backend && uv run mypy app/modules/platform_sync/auth.py
  - 鉴权行为由 task-07 端点测试覆盖（401/合法 APIKey/合法 JWT/非法）
constraints:
  - 不复用 get_current_principal（它不接受 Bearer=APIKey，auth_deps.py:156-170；require_platform_sync 是新逻辑，Grill B-004）
  - ApiKeyService.authenticate 自带 startswith 前缀兜底（api_key_service.py:206），但 require_platform_sync 仍显式分流避免 JWT 误走 APIKey 扫库
  - 失败用现有 app.core.errors 的 AuthTokenMissing/AuthTokenInvalid（401 语义，对齐 auth_deps 风格）
---
