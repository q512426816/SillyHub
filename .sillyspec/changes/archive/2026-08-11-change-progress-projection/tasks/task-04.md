---
id: task-04
title: platform_sync token_service create/authenticate
title_zh: 新建 PlatformSyncTokenService 签发与鉴权（shpsync_ 明文一次 + hash 查表派生 user/workspace）
author: qinyi
created_at: 2026-08-11 20:27:34
priority: P0
depends_on: [task-01]
blocks: []
requirement_ids: [FR-01]
decision_ids: [D-001@v1]
allowed_paths:
  - backend/app/modules/platform_sync/token_service.py
expects_from:
  task-01:
    - contract: PlatformSyncTokenORM
      needs: [id, workspace_id, created_by, token_hash, name, scope, last_used_at, revoked_at, created_at]
provides:
  - contract: PlatformSyncTokenService.create
    fields: [token]
  - contract: PlatformSyncTokenService.authenticate
    fields: [user, workspace_id]
goal: >
  新建 token_service.py 落 PlatformSyncTokenService.create（shpsync_ 明文一次 + 库存 sha256）与 authenticate（hash 查表派生 user=created_by 对应 User 与 workspace_id），为 task-05 auth 派生 workspace 提供原语。
implementation:
  - 前缀常量 shpsync_，明文 secrets.token_urlsafe(32) 拼前缀，hash 用 sha256 hex，参照 mcp_gateway/service.py 同名私有函数
  - create 入参 workspace_id 与 name 与 scope 与 created_by，构造 ORM 写库 commit refresh 返回 (row, 明文)，明文仅本次返回，token_hash 与明文绝不入 structlog 仅记 token_id 与 workspace_id 与 name
  - authenticate 入参明文，先判 shpsync_ 前缀不符返 None 不查库，再按 sha256 等值查未吊销行，命中按 created_by FK 读 users 表得 User 组装 PlatformSyncTokenPrincipal(user, workspace_id, token_id) 返回并刷 last_used_at
acceptance:
  - create 返回 shpsync_ 明文一次，库内只存 sha256 hex 无明文无 key_prefix 无 expires_at
  - authenticate 按 hash 一次等值命中未吊销行并派生 user 与 workspace_id，未知或已吊销或前缀错返 None，同一明文反复调用幂等读不引缓存层
verify:
  - cd backend && python -m pytest app/modules/platform_sync/tests -k token_service -q
  - cd backend && python -m ruff check app/modules/platform_sync/token_service.py
constraints:
  - token 明文只在 create 响应返回一次，库存 sha256 hex，无 key_prefix 列无 expires_at 列（design §8.1）
  - 不复制 McpToken Redis 缓存与 last_used_at 节流，进度同步低频非每请求热路径，shpsync_ 与 shk_live_ 与 shmcp_ 三套前缀常量独立互不复用
  - User 必须来自 created_by 对应 users 行（design §7），不查 X-API-Key 表
  - 代码兼容 Windows、Linux、macOS
---
