---
schema_version: 1
doc_type: module-card
module_id: settings
source_commit: ba87eec
author: qinyi
created_at: 2026-06-24T01:16:36
---
# settings

## 定位
平台级「键值配置中心」+ 用户/会话运维聚合入口。管理 `platform_settings` 表（key/value/updated_by/updated_at），承载平台全局开关与参数；同时 router 复用承载用户 CRUD、会话吊销、密码重置等运维端点。是后台管理员对「平台配置」与「账号管理」两类操作的统一 REST 入口。

产品视角：平台设置是「不改代码即可调全局行为」的运维杠杆（如默认分页、功能开关）。用户/会话管理是 admin 面板的核心数据源，管理员在此创建账号、重置密码、强制下线。该模块与 admin 模块在用户管理上同源（共用 UserService），是历史聚合，新功能宜分流至 admin。

## 契约摘要
- 路由：`API tag=settings`（挂根下，无独立 prefix）
  - 平台设置：`GET /settings` 批量读（`SettingsBulkRead`）、`PUT /settings` 批量更新（`SettingsUpdateResponse`，含 updated/created/skipped 计数）
  - 用户：`GET /users` 列表（搜索/筛选/分页）、`POST /users` 创建、`PATCH /users/{id}` 更新、`DELETE /users/{id}` 软删
  - 会话：`GET /users/{id}/sessions` 活跃会话列表、`DELETE /users/{id}/sessions/{sid}` 撤销单个、`POST /users/{id}/sessions/revoke-all` 全撤
  - 审计：`GET /users/{id}/audit` 用户审计日志、`GET /users/{id}/workspaces` 所属工作区+角色
  - 密码：`POST /users/{id}/reset-password`（后端生成随机密码返回明文）
- 数据模型：`PlatformSetting`（key 主键、value 字符串、updated_by 审计、updated_at）
- Schema：`SettingRead` / `SettingsBulkRead` / `SettingsUpdateRequest|Response` / `UserCreateRequest|UpdateRequest|Read|ListResponse` / `UserSessionRead` / `RevokeAllResponse` / `ResetPasswordRequest|Response`
- 依赖：`core`、`models`；`SettingsService` 当前为向后兼容的空壳 re-export，真正逻辑内联 router
- `_enrich`：把 `User` 补全为 `UserRead`（带角色/组织关联）
- 跨组件协作：前端 `lib/settings.ts` 客户端 + `(dashboard)/settings` 页面 + admin 用户抽屉
- 权限：管理操作需平台管理员权限，所有端点需认证

## 关键逻辑
平台设置批量更新：
```
existing = {row.key: row for row in query(PlatformSetting)}
for item in payload.settings:
    row = existing.get(item.key)
    if row: row.value = item.value        # update
    else: add(PlatformSetting(key, value)) # create
    row.updated_by = actor_id
commit → {updated, created, skipped}
```
用户管理与 `admin.users_service.UserService` 同源；会话吊销清理 `AuthSession`；密码重置后端生成随机密码返回明文。
- 用户更新含自保护（不能改自己状态）+ 最后管理员保护（`_active_admin_count` 防止删光管理员）
- 用户删除为软删除，同步撤销所有活跃会话 `_revoke_sessions`
- `_set_audit_context` 设置审计上下文 actor，所有写操作自动记录

### 用户列表与查询
`UserService.list_users` 支持多维查询：
- 搜索关键字（跨 username/email/display_name ilike）
- 状态过滤（enabled/disabled）
- 角色/组织过滤
- 分页（page/page_size）+ 排序（order_by/order）
- 返回 `UserListResponse` 含 items + total，前端 antd Table 服务端分页

## 注意事项
- 该 router 同时承担「平台设置」与「用户/会话管理」两类职责，是历史聚合；新功能宜走 admin 独立 router
- `SettingsService` 是空壳 re-export，真正逻辑内联在 router，改动勿误删
- 用户管理端点与 admin 模块实质同源（共用 UserService），避免两处规则发散
- 平台设置 value 统一存字符串，结构化值由调用方自行序列化
- 密码重置返回明文是因暂无邮件服务，管理员需人工告知；前端一键生成+展示+复制
- 用户列表支持搜索/筛选/分页/排序，参数较多，改动注意 Query 一致性
- 会话撤销会强制用户重新登录，操作需谨慎确认
- 平台设置的批量更新是 upsert 语义，已存在则更新、不存在则创建
- 用户创建 `_resolve_username` 在未提供用户名时由 email 派生
- 用户更新支持改组织/角色关联（`_rewrite_organizations`/`_rewrite_roles` 全量重写）
- enable/disable_login 切换登录可用性，disable 不删数据
- 会话列表 `list_sessions` 返回 AuthSession 行，revoke 按 session_id 精确撤销
- reset-password 不传 new_password 时后端生成随机强密码
- 审计日志 list_user_audit 按用户聚合，供管理员追溯操作历史
- list_users 的 order_by/order 经 SortOrder.normalize 规范化，防注入
- 用户创建后默认 enabled，disable_login 可临时封禁
- revoke-all 撤销目标用户全部会话，强制重登
- PlatformSetting 的 key 命名宜用点分命名空间（如 ppm.default_page_size）
- 批量更新跳过 null value 的项（skipped 计数）
- 前端 settings 页 + admin 用户抽屉共用 lib/settings.ts 客户端
- list_users 支持 include_disabled 控制是否含禁用用户
- 密码重置的随机密码满足复杂度要求
- PlatformSetting.updated_by 记最后修改者 user_id

## 人工备注
<!-- MANUAL_NOTES_START -->
<!-- MANUAL_NOTES_END -->
