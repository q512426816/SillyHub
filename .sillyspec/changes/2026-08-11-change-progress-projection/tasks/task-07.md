---
id: task-07
title: platform_sync inbox workspace wiring + workspace_router + schema
title_zh: platform_sync 收件箱取 workspace 加 workspace_router 两新端点加 schema（WORKSPACE_WRITE）
author: qinyi
created_at: 2026-08-11 20:27:34
priority: P0
depends_on: [task-04, task-05, task-06]
blocks: []
decision_ids: [D-005@v1, D-006@v1]
allowed_paths:
  - backend/app/modules/platform_sync/router.py
  - backend/app/modules/platform_sync/workspace_router.py
  - backend/app/modules/platform_sync/schema.py
  - backend/app/main.py
expects_from:
  task-04:
    - contract: PlatformSyncTokenService.create
      needs: [token]
  task-05:
    - contract: require_platform_sync
      needs: [user, workspace_id]
  task-06:
    - contract: upsert_progress
      needs: [workspace_id, change_name]
    - contract: list_lightweight
      needs: [workspace_id]
    - contract: get_progress
      needs: [workspace_id, change_name]
provides:
  - contract: PlatformSyncTokenCreateResponse
    fields: [token, workspace_id]
  - contract: ResolveByRootPathRequest
    fields: [root_path]
  - contract: ResolveByRootPathResponse
    fields: [workspace_id, token]
goal: >
  改 router.py 三端点从 require_platform_sync 取 workspace_id 透传 service，新增 workspace_router.py 两新端点与 schema.py 三模型，resolve-by-root-path 反查 workspace 后校验 WORKSPACE_WRITE 不通过返 403 反查不到返 404。
implementation:
  - router.py 三端点解包 require_platform_sync 返回的 user 与 workspace_id 元组，透传 workspace_id 给 upsert_progress 与 list_lightweight 与 get_progress，_user 保留不消费
  - 新增 workspace_router.py，APIRouter 自带前缀 workspaces 与无前缀 changes router 分离避免 GET 尾斜杠 redirect，沿用 mcp_gateway router 的 require_permission WORKSPACE_WRITE 模式
  - POST 单 workspace 下 platform-sync-tokens 端点依赖 require_permission WORKSPACE_WRITE，调 PlatformSyncTokenService.create 签发返 201 与明文 token 与 workspace_id
  - POST resolve-by-root-path 鉴权走 Bearer 或 JWT，body 取 root_path 调 workspace service 反查活跃 workspace，反查不到返 404，无 WORKSPACE_WRITE 返 403，通过后调 token_service.create 签发返 workspace_id 与明文 token
  - schema.py 新增三个 Pydantic 模型 PlatformSyncTokenCreateResponse 与 ResolveByRootPathRequest 与 ResolveByRootPathResponse，字段对齐 design §7 与契约
acceptance:
  - 收件箱三端点鉴权升级后 shpsync_ 上行按 workspace_id 隔离写入，shk_live_ 过渡期 workspace_id 为 None 不崩走 fallback
  - POST platform-sync-tokens 鉴权 WORKSPACE_WRITE，viewer 调用返 403，owner 或 developer 返 201 与明文 token 一次返回
  - POST resolve-by-root-path 反查不到活跃 workspace 返 404，反查到但调用者无 WORKSPACE_WRITE 返 403，正常返 200 与 workspace_id 与明文 token
verify:
  - cd backend && python -m pytest tests/modules/platform_sync -q
constraints:
  - resolve-by-root-path 无 WORKSPACE_WRITE 返 403 与反查不到活跃 workspace 返 404 是硬约束不可缺
  - token create 的 created_by 记调用者 user，明文 token 仅 201 一次返回不落明文只存 sha256
  - 收件箱三端点按 workspace 严格隔离，workspace_router 自带前缀 workspaces 与 changes router 分离
  - main.py 须 import workspace_router 并 include_router 注册（参照 main.py:47/580 platform_sync_router 模式 prefix 加 /api），否则新端点不可达
  - 代码须兼容 Windows 与 Linux 与 macOS
---
