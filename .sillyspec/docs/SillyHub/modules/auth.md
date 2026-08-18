---
schema_version: 1
doc_type: module-card
module_id: auth
author: qinyi
created_at: 2026-08-18 01:45:00
---

# 认证与权限管理（auth）

## 定位
后端鉴权功能域：用户登录（限流 + 滑块验证码防爆破）、JWT/refresh token 签发轮换与吊销、自助改密、API Key 生命周期、RBAC 权限模型（平台级 + 工作空间级两层）、启动时 seed 管理员与 RBAC 种子。
权限校验的 FastAPI 装配在 core.auth_deps，权限判定的数据聚合在本模块 rbac。

不负责：用户/角色/组织的运维管理（admin）、端点级权限声明（各业务模块用 core.auth_deps）。

## 契约摘要
- **API（prefix=/auth）**：
  - `POST /login`（TokenPair）；`GET /captcha/confirm` + `POST /captcha/verify`（登录前无鉴权）；`POST /refresh`；`POST /logout`（204）；`POST /change-password`（204）；`GET /me`（用户信息 + 工作空间角色分配）。
  - API Key：创建（明文仅创建时一次性返回）/列表/吊销。
- **登录防爆破**（CaptchaService，状态全在 Redis、服务本身无状态）：
  - 同 IP 60s 窗口限流，超阈拒绝并提示稍后再试。
  - 累计失败达阈值后强制滑块验证：未过验证码再错返回 423 `need_captcha`（前端据此弹「我不是机器人」）。
  - 已过验证码后的密码错如实返回 401（避免「验证→又让验证」死循环，token 一次性已消费）；爆破防护不降——每次试密码仍须先过验证码且受 IP 限流约束。
  - 登录成功清失败计数；captcha_id 与 captcha_token 均一次性；Redis 故障降级放行不阻断登录可用性。
- **AuthService**：
  - `login(account, password)`——account 字段名保留但语义是纯登录名 username（strip+lower 唯一查询，email 不再作登录账号）；失败响应统一 AuthInvalidCredentials 不泄露账号存在性。
  - `refresh` 消费旧 token 轮换签新（`_consume_refresh_token` + `_mark_session_rotated`，带 grace 窗口防并发刷新竞态）。
  - `logout_session_by_refresh / revoke_all_user_sessions` 会话吊销；`_mark_session_revoked` 撤销标记。
  - `change_password`：verify 旧密 → hash 新密 → 撤销其他会话 → 审计 → 末尾统一 commit（事务原子）。
- **ApiKeyService**：
  - 明文只存哈希；`authenticate`：负缓存拒无效 key 探测 → 正缓存 user_id → 回 DB 实时校验用户 active（绝不放行已失效用户）→ bcrypt 放 `asyncio.to_thread` 不阻塞事件循环。
  - `revoke` 按 key_prefix SCAN 清正缓存（否则被吊销 key 在 TTL 内仍可用）；`last_used_at` 写入受节流（默认 60s，0=每次写）避免行锁串行化雪崩。
  - 缓存层 try/except 降级，Redis 不可用回退 bcrypt 路径。
- **权限模型**：`Permission(StrEnum)` 全部权限点 + `PermissionGroup` 分组（AUDIT/WORKSPACE/PLATFORM/ADMIN/CHANGE/AGENT/PPM 等）；rbac 提供 `collect_permissions*`（平台级 / 全部 / everywhere 任意工作空间聚合）、`has_permission`、`list_user_workspace_roles`、`allowed_workspace_ids`；读侧接 core.permission_cache（Redis + 熔断）。
- **启动 seed**：`bootstrap_admin_and_seed_rbac`（管理员账号三元组来自 Settings 的 platform_bootstrap_admin_* + RBAC 种子）与 `seed_platform_admin_role`。
- **数据**：User / Session / Role / RolePermission / ApiKey / UserWorkspaceRole（均继承 BaseModel）。

## 关键逻辑
```
# 登录
check_rate_limit(ip) → assert_captcha_if_needed(失败达阈值) → AuthService.login(纯 username)
  → 失败: record_login_failure → 达阈值且未过验证码 → 423 need_captcha；已过验证码 → 401 如实
  → 成功: _issue_token_pair(access+refresh) + clear_login_failures

# refresh 轮换
_consume_refresh_token(校验+作废旧 token) → _issue_token_pair → _mark_session_rotated

# API Key 认证（与 JWT 并列通道）
_extract_api_key → authenticate: 负缓存拒 → 正缓存 user_id → DB 实时校验 active → bcrypt to_thread

# 权限
require_permission(p) → rbac.has_permission(user, p, ws?) ← core.permission_cache（Redis+熔断降级）
```

## 注意事项
- 种子写入时间必须用 naive UTC（`datetime.now(UTC).replace(tzinfo=None)`）对齐 TIMESTAMP WITHOUT TIME ZONE 列——aware 时间会致 asyncpg 拒写、backend 启动循环崩溃（历史事故）。
- 调整权限点需同步四处：Permission 枚举、RBAC seed、前端权限矩阵、core.permission_cache 失效策略。
- refresh token 轮换后旧 token 立即失效；`TokenPayload.email` 可空（username-only 账号签发不崩），仅作识别用途。
- API key 缓存/节流配置在 Settings（`auth_api_key_cache_ttl` / `auth_api_key_negative_cache_ttl` / `auth_api_key_last_used_throttle_seconds`），0=禁用对应机制。
- 登录限流/验证码 Redis 故障降级放行是刻意取舍（可用性优先），勿改成硬失败。
- bootstrap admin 邮箱查重在历史验证中暴露过预存缺陷，新增启动 seed 逻辑注意幂等（重启不重复建号）。

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
