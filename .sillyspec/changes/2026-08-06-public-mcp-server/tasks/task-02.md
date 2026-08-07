---
id: task-02
title: McpToken service + management HTTP API (issue/validate/revoke + Redis cache + CRUD)
title_zh: McpToken 服务与管理 HTTP API（签发/校验/吊销 + Redis 缓存复用 + CRUD）
author: qinyi
created_at: 2026-08-06 13:52:28
priority: P0
depends_on: [task-01]
blocks: [task-03]
requirement_ids: [FR-02]
decision_ids: [D-002@v1]
allowed_paths:
  - backend/app/modules/mcp_gateway/service.py
  - backend/app/modules/mcp_gateway/router.py
  - backend/app/main.py
provides: []
expects_from: []
goal: >
  建 McpTokenService（签发/校验/吊销，复用 ApiKeyService 的 Redis 缓存模式）加 workspace 级
  管理 HTTP API（POST/GET/DELETE /workspaces/<wid>/mcp-tokens），并在 main.py include_router
  注册 mcp_gateway router（G-1）。校验走 sha256(token_hash) 唯一索引 O(1) 加正/负缓存；DB 只存 sha256 hash 不存明文。
implementation:
  - service.py McpTokenService.create：生成 shmcp_ 前缀加 secrets.token_urlsafe(32) 明文；token_hash=sha256(明文) 入库（design §8.1 非 bcrypt，MCP 每请求校验需 token_hash 唯一索引 O(1)）；落 workspace_id/scope/created_by，返回 (row, 明文)
  - authenticate(plaintext)：算 sha256 → 正缓存 auth:mcptoken:<sha256> 命中即返 (workspace_id, scope)；未命中按 token_hash 唯一索引查 mcp_tokens 且 revoked_at IS NULL，命中写正缓存并节流刷 last_used_at（复用 api_key_service._mark_used），无匹配写负缓存；缓存读写 try/except 降级，redis 故障回退直查 DB（对齐 _cache_get/_cache_set/_cache_delete）
  - revoke(token_id, workspace_id)：UPDATE revoked_at=now（WHERE id+workspace_id+revoked_at IS NULL 幂等）并按 token_hash 精确 DEL 缓存（revoke 知 token_hash 直删，比 ApiKeyService 前缀 SCAN 更简）
  - router.py：建 APIRouter 前缀 /workspaces、tag mcp-tokens；POST /<wid>/mcp-tokens 签发（请求体 name+scope 列表，响应 id+明文 token 仅一次+scope+created_at）、GET /<wid>/mcp-tokens 列表（不返明文，含 last_used_at/revoked_at）、DELETE /<wid>/mcp-tokens/<id> 返 204；鉴权用 require_permission(Permission.WORKSPACE_WRITE) 依赖
  - main.py 加 mcp_router 导入并 app.include_router(mcp_router, prefix="/api")（G-1 注册步骤，落 /api/workspaces/<wid>/mcp-tokens）
acceptance:
  - POST 返回明文 token 仅一次，DB token_hash=sha256(明文) 无明文列；GET 不含明文含 last_used_at/revoked_at；DELETE 后 authenticate 返 None（缓存同步清，无 TTL 放行窗口）
  - 命中缓存不查库、redis 故障降级直查仍通过；三端点经 require_permission(WORKSPACE_WRITE) 越权 403；main.py include_router 后路由实际可达
verify:
  - cd backend && uv run pytest app/modules/mcp_gateway -q --no-cov
constraints:
  - 签发明文仅返回一次，DB 只存 sha256(token_hash)，不存明文（design §8.1）
  - 复用 ApiKeyService Redis 缓存模式（正/负缓存 sha256 key + best-effort 降级 + last_used 节流），不复制其 bcrypt O(n) 扫描
  - 管理 API 鉴权 require_permission(Permission.WORKSPACE_WRITE) 或 WORKSPACE_ADMIN（RBAC 层级满足）
  - token_hash 与明文均不入日志/响应（仅 create 返回一次明文，R-06）
  - 不改 mcp_tokens 表结构（task-01 范围）；middleware 注入归 task-03
---
