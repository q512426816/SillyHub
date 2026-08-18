---
schema_version: 1
doc_type: module-card
module_id: auth
author: qinyi
created_at: 2026-08-18 01:45:00
---

# 认证与令牌（auth）

## 定位
认证、鉴权与会话管理：登录/刷新/登出/me/改密/登录验证码、API Key 生命周期、RBAC 权限集合
查询与启动期种子。是全部业务模块的鉴权入口——JWT 与 `shk_live_` API Key 两轨由本模块 +
core.auth_deps 承接；平台同步 `shpsync_`（platform_sync）与 MCP token（mcp_gateway）各自
独立鉴权，不经本模块。用户可见错误文案全中文。

## 契约摘要
- `POST /api/auth/login` → `TokenPair`：账号或邮箱登录，签发 access+refresh；
  同 IP 连续失败触发验证码闸。
- `GET /api/auth/captcha/confirm` / `POST /api/auth/captcha/verify`：
  验证码确认（生成挑战）/ 校验（消费 token）。
- `POST /api/auth/refresh` → TokenPair：消费 refresh 换新对（grace window 见注意事项）。
- `POST /api/auth/logout`（204）：按 refresh 注销单个 session。
- `POST /api/auth/change-password`（204）；`GET /api/auth/me` → 当前用户 + 各 workspace 角色。
- API Key：`POST /api/auth/api-keys` 创建（`shk_live_` 前缀明文仅创建响应返回一次）、
  `GET /api/auth/api-keys` 列表、`DELETE /api/auth/api-keys/{id}` 吊销。
- `AuthService`（service.py）：login / refresh / logout_session_by_refresh /
  revoke_all_user_sessions。
- `ApiKeyService`（api_key_service.py）：key 生命周期与校验；Redis 正/负缓存节流
  （命中负缓存直接拒，避免高频无效 key 打库）。
- `CaptchaService`（captcha_service.py）：`check_rate_limit`（IP 速率限制）、
  `record_login_failure` / `clear_login_failures`（失败计数）、`needs_captcha` /
  `assert_captcha_if_needed`（需验证码时强制校验）、`create_confirmation` /
  `verify_confirmation`（挑战-应答）；Redis 键族 `_rate_key`/`_fail_key`/
  `_confirm_key`/`_token_key` 按 IP/挑战维度隔离。
- `rbac.py`：`collect_permissions`（单 workspace）/ `collect_permissions_all` /
  `collect_permissions_platform` / `collect_permissions_everywhere` /
  `has_permission` / `list_user_workspace_roles` / `allowed_workspace_ids`——
  供 core.permission_cache 与各模块（file 等）复用的权限集合查询层。
- `permissions.py`：`PermissionGroup` + `Permission`（StrEnum，~73 个权限点）。
- bootstrap：`bootstrap_admin_and_seed_rbac` / `seed_platform_admin_role`
  启动期建管理员与 RBAC 种子（main.py lifespan 调用）。
- 模型：users / sessions（含 rotate 轮换字段）/ roles / role_permissions /
  api_keys / user_workspace_roles。

## 关键逻辑
```
login(account, password):
  account 含 @ 走邮箱否则用户名查询
  verify 口令(bcrypt); 统一错误文案防账号枚举
  login_enabled=False → 拒登; 失败累计 → 需验证码
  _issue_token_pair → 写 Session → commit
refresh: _consume_refresh_token → (user, session, is_grace)
  grace 窗口内旧 token 重签新对不吊销; 超窗按重放 revoke_all
API Key 校验: X-API-Key → Redis 正缓存 → 未命中查库(hash 匹配)
  → 回填; 无效 key 写负缓存
```

## 注意事项
- 登录错误信息固定（不区分账号不存在/密码错）防枚举；登录权限闸在口令校验之后才查。
- refresh token 以 hash 存库、单次使用；被 rotate 的旧 token 在
  `auth_refresh_grace_seconds`（默认 60s）内再提交会重签新对且**不**触发 revoke_all
  （并发刷新误杀兜底），`Session.rotated_at` 是 grace 判定锚点、logout 不写；
  access TTL 默认 30min（`auth_access_ttl_minutes`）。
- rbac 对 admin 模块的 `UserRole` 是延迟 import（平台级角色存 admin 侧），改 admin 表结构
  影响权限收集；平台级 `PLATFORM_ADMIN` 拥有全部权限，新增 Permission 枚举要同步补种子。
- 平台级 M2M（UserRole/UserOrganization，admin 模块）与 workspace 级
  UserWorkspaceRole（本模块）是两套归属，勿混用。
- 验证码/失败计数全走 Redis，清缓存即重置验证码闸；挑战 token 一次性消费
  （`_consume_captcha_token`）。
- API Key 明文只在创建响应出现一次，库里只存 hash；吊销即时生效（负缓存）。
- `allowed_workspace_ids` 是各模块做 workspace 范围过滤的统一入口（file.list 等），
  改语义影响面大。

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
