---
schema_version: 1
doc_type: module-card
module_id: lib-admin
author: qinyi
created_at: 2026-08-18 01:45:00
---

# 后台管理 API 客户端（lib-admin）

## 定位
平台后台管理（admin）域浏览器侧 API 客户端（`lib/admin.ts`，420 行）。统一封装后端 `/api/admin/**` 下「用户 / 组织 / 角色」三大子资源的 CRUD、启停、会话管理、审计与密码重置。所有请求经 lib-api 的 `apiFetch` 发起，错误统一抛 `ApiError`。供 `app-admin-pages`（后台页面）与 `components-admin`（管理对话框）调用。

## 契约摘要
用户（无单查 getUser）：
- `listUsers(params: UserListParams)` → `UserListResponse`（含分页）。
- `createUser(req: UserCreateRequest)` / `updateUser(userId, req: UserUpdateRequest)` / `deleteUser(userId)` → void。
- 会话管理：`listUserSessions(userId)` → `UserSessionRead[]`；`revokeUserSession(userId, sessionId)`；`revokeAllUserSessions(userId)` → `RevokeAllResponse`（踢下线）。
- `listUserAudit(userId, params)` → `AuditLogRead[]`（用户维度审计日志）。
- `resetUserPassword(userId, req: ResetPasswordRequest)` → `ResetPasswordResponse`（含临时密码）。
- `disableUserLogin(userId)` / `enableUserLogin(userId)` → `UserRead`（登录黑名单开关）。

组织：
- `listOrganizations(params: OrganizationListParams)` / `getOrganization(orgId)`（唯一保留的单查 getter）。
- `createOrganization(req: OrganizationCreateRequest)` / `updateOrganization(orgId, req: OrganizationUpdateRequest)`。
- `disableOrganization(orgId)` / `enableOrganization(orgId)` / `deleteOrganization(orgId)`。
- `OrganizationStatus = "active" | "disabled"`；`OrganizationRead` / `OrganizationDetail extends OrganizationRead`（含子列表聚合）/ `OrganizationBrief`。

角色（无单查 getRole）：
- `listRoles(params: RoleListParams)` → `RoleListResponse`。
- `createRole(req: RoleCreateRequest)` / `updateRole(roleId, req: RoleUpdateRequest)`。
- `disableRole(roleId)` / `enableRole(roleId)` → `RoleRead`；`deleteRole(roleId)` → void。
- `listRoleUsers(roleId, params)` → `RoleUserListResponse`（`RoleUserBindingType = "platform" | "workspace"`）。
- `Permission = string`（宽松类型，合法值由后端枚举约束）；`RoleRead.permissions: Permission[]`；`RoleBrief`。

辅助类型：`UserRead` / `UserSessionRead` / `AuditLogRead` / `UserWorkspaceRead`（类型保留，listUserWorkspaces 函数已不存在）。

## 关键逻辑
```
// 典型 CRUD 调用模式（apiFetch 统一 JSON 序列化与 ApiError 抛错）
createRole(req)           → POST   /api/admin/roles                     → RoleRead
disableRole(id)           → PATCH  /api/admin/roles/<id>/disable        → RoleRead
deleteRole(id)            → DELETE /api/admin/roles/<id>                → void
revokeAllUserSessions(id) → POST   /api/admin/users/<id>/sessions/revoke-all

// 列表 *Params 含 page/page_size + 过滤字段，由 apiFetch 序列化成 query
// （数组走重复 key）
```

## 注意事项
- 该域端点要求 `platform:admin` 或对应 `user:*` / `organization:*` / `role:*` 权限；401 由 apiFetch 自动刷新，403/404 透传。
- `Permission = string` 为宽松类型，实际合法值见后端 Permission 枚举（lib-menu-permissions 注释列有全集）。
- disable/enable 与 delete 是三种不同操作：disable 软停用保留数据，delete 物理删除——UI 需区分二次确认。
- `resetUserPassword` 返回临时密码（`ResetPasswordResponse`），前端一次性展示且不入日志。
- 与 lib-settings 的用户管理面有历史重叠（listUsers/createUser 两处都有）：admin 域走 `/api/admin/**`，settings 域走个人设置端点，新代码按域选边勿混用。
- 用户/角色无单查 getter（getUser/getRole 已不存在），详情走列表过滤或 `OrganizationDetail` 聚合。

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
