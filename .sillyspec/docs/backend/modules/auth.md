---
schema_version: 1
doc_type: module-card
module_id: auth
source_commit: ba87eec
author: qinyi
created_at: 2026-06-24T01:08:51
---
# auth
## 定位
认证、鉴权与会话管理。负责登录/刷新/登出/me、API Key 管理，以及 RBAC（用户-角色-权限，按 workspace 隔离 + 平台级）。被绝大多数业务模块依赖。
## 契约摘要
- `POST /api/auth/login` → TokenPair：账号或邮箱登录，签发 access+refresh。
- `POST /api/auth/refresh` → TokenPair：消费 refresh 换新对。
- `POST /api/auth/logout`：按 refresh 注销单个 session。
- `GET /api/auth/me` → MeResponse：当前用户 + 各 workspace 角色。
- API Key：`POST /api/auth/api-keys`（创建）、`GET /api/auth/api-keys`、`DELETE /api/auth/api-keys/{id}`（吊销）。
- `AuthService`：login/refresh/logout_session_by_refresh/revoke_all_user_sessions。
- `ApiKeyService`（api_key_service.py）：API Key 生命周期与校验。
- rbac.py：`collect_permissions_*`（platform/all/everywhere/has_permission）权限集合查询。
- bootstrap：`bootstrap_admin_and_seed_rbac` / `seed_platform_admin_role` 启动期建表与种子。
- 模型：User/Session/Role/RolePermission/ApiKey/UserWorkspaceRole。
## 关键逻辑
```
login(account, password):
  user = 按 @ 区分 email/username 查询
  verify 口令（passlib bcrypt），统一错误防枚举
  若 user.login_enabled=False → AuthUserLoginDisabled
  _issue_token_pair → 写 Session → commit
```
## 注意事项
- 登录错误信息固定，避免账号枚举；登录权限闸在口令校验之后才查。
- refresh token 以 hash 存库，单次使用，登出即标 revoked。
- rbac 对 admin.model.UserRole 是延迟 import（platform 级角色存 admin），改 admin 表结构会影响权限收集。
- 平台级 `PLATFORM_ADMIN` 拥有全部权限，新增权限枚举要同步补种子。
## 人工备注
<!-- MANUAL_NOTES_START -->
- refresh token 轮换加 grace window(2026-06-24-concurrent-refresh-revoke):被 rotate 的旧 token 在 `auth_refresh_grace_seconds`(默认 60s)内再次提交 → 重新签发新对、**不**触发 revoke_all(并发刷新误杀兜底);超窗口才按重放吊销。`Session.rotated_at` 记录轮换时刻(grace 判定锚点),logout 不写。
- access TTL 默认 30min(`auth_access_ttl_minutes`,原 15)。
- `_consume_refresh_token` 返回三元组 `(user, session, is_grace)`;refresh / logout_session_by_refresh 两调用点。
<!-- MANUAL_NOTES_END -->
