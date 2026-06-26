---
schema_version: 1
doc_type: module-card
module_id: auth
source_commit: ba87eec
author: qinyi
created_at: 2026-06-24T01:16:33
---
# auth

## 定位
后端「鉴权」功能域：负责用户登录、JWT/refresh token 签发与校验、API Key 管理、RBAC 权限（平台级 + 工作空间级）。通过 `core.auth_deps` 的 FastAPI 依赖项把权限校验注入到所有受保护端点；启动时 seed 管理员账号与 RBAC 种子数据。

## 契约摘要
- API（prefix=/auth）：`POST /api/auth/login`、`/refresh`、`/me`，以及 API Key 管理（创建/列出/吊销）。
- `AuthService`：`login(username, password)` → 纯 username 查询 + 密码校验 + 签发 token 对（email 不再作登录账号，D-001）；`refresh(refresh_token)` → 消费并换新；`logout_session_by_refresh` / `revoke_all_user_sessions` 会话吊销；`_issue_token_pair` 内部签发。
- `ApiKeyService`：`create`（生成明文 + 哈希存储，仅创建时返回明文）、`list_for_user`、`revoke`、`authenticate(plaintext)`（按前缀定位 + 哈希比对 + `_mark_used`）。P0 性能优化（2026-06-27）：`authenticate` 加 Redis 正/负缓存——正缓存 `auth:apikey:{key_prefix}:{sha256}` 存 user_id（命中后仍查 DB 实时校验 active/未删除，绝不放行已失效用户），负缓存 `auth:apikey:neg:{sha256}` 防无效 key 探测穿透；bcrypt `verify_refresh_token` 放 `asyncio.to_thread` 不阻塞事件循环；`revoke` 按 `key_prefix` SCAN 清正缓存（否则被吊销 key 在 TTL 内仍可用）；缓存层 try/except 降级，redis 不可用回退原 bcrypt 路径。`_mark_used` 写 `last_used_at` 受 `settings.auth_api_key_last_used_throttle_seconds`（默认 60s）节流：窗口内重复认证跳过 UPDATE，避免每请求写同一行导致行锁串行化雪崩（ql-20260627-001-a3f2）。
- `Permission(StrEnum)` / `PermissionGroup`：枚举全部权限点，按 `group()` 归入 AUDIT/WORKSPACE/PLATFORM/ADMIN/CHANGE/AGENT/PPM 等组。
- `rbac`：`collect_permissions*`（all / platform / everywhere）、`has_permission`、`list_user_workspace_roles`、`allowed_workspace_ids`，按工作空间范围聚合权限。
- 启动 seed：`bootstrap_admin_and_seed_rbac`（建管理员 + 种 RBAC）、`seed_platform_admin_role`。

## 关键逻辑
```
# 登录签发
login → _lookup_active_user_by_username → 密码 verify → _issue_token_pair(access+refresh)  # 纯 username 查询(D-001),email 分支已移除
# 权限校验（端点）
require_permission(p) → get_current_user → rbac.has_permission(user, p, ws?)
# 工作空间作用域
allowed_workspace_ids(user) → collect_permissions_everywhere 聚合所有 ws 角色
# API Key 认证（与 JWT 并列）
_extract_api_key → ApiKeyService.authenticate(明文) → User
```

## 注意事项
- refresh token 哈希存储，`_consume_refresh_token` 校验后即作废旧 token 并签新（轮换），`_mark_session_revoked` 标记会话撤销。
- API Key 明文仅在创建时一次性返回，数据库只存哈希；`authenticate` 失败不应泄露「用户存在与否」差异。
- 权限分平台级与工作空间级两层，`collect_permissions_everywhere` 用于判断「任意 ws 内是否拥有某权限」。
- RBAC 种子与管理员账号在应用启动时注入，调整权限点需同步更新 seed 与前端权限矩阵。
- 登录仅认 username（D-001 纯登录名），email 不再作为登录账号识别；User.email 可空，非空仍全局唯一（D-003）。

## 变更索引
- ql-20260627-001-a3f2 | API key 认证 last_used_at 时间节流（默认 60s），消除每请求 UPDATE 同一行致行锁串行化的生产性能雪崩。
- 2026-06-27-p0-perf-optimization | `ApiKeyService.authenticate` 加 Redis 正/负缓存 + bcrypt 放 `asyncio.to_thread` 异步化（生产根因：cost12 同步阻塞单事件循环）+ `revoke` 按 key_prefix 清缓存；缓存降级保证 redis 不可用仍可认证。配置 `auth_api_key_cache_ttl`/`auth_api_key_negative_cache_ttl`。

## 人工备注
<!-- MANUAL_NOTES_START -->
<!-- MANUAL_NOTES_END -->
