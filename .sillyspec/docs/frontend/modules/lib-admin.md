---
schema_version: 1
doc_type: module-card
module_id: lib-admin
source_commit: ba87eec
author: qinyi
created_at: 2026-06-24T01:02:04
---
# lib-admin

## 定位
平台后台管理（admin）域的浏览器侧 API 客户端。统一封装后端 `/api/admin/**` 下「用户 / 组织 / 角色」三大子资源的增删改查、启停、会话管理、审计与密码重置等操作。所有请求经 `lib-api` 的 `apiFetch` 发起，错误统一抛 `ApiError`。供 `app-admin-pages`（后台页面）与 `components-admin` 调用。

## 契约摘要
按资源分组（全部 `export async function`，参数为请求体/路径 id/查询 `*Params`，返回对应 `*Read` / `*Response`）：

- 用户：`listUsers(params)` → `UserListResponse`（含分页）；`getUser` / `createUser(req)` / `updateUser(id, req)` / `deleteUser`；`listUserSessions` / `revokeUserSession` / `revokeAllUserSessions`（踢下线）；`listUserAudit`（审计日志）；`listUserWorkspaces`（用户关联工作区）；`resetUserPassword` / `disableUserLogin` / `enableUserLogin`。
- 组织：`listOrganizations` / `getOrganization` / `createOrganization` / `updateOrganization` / `disableOrganization` / `enableOrganization` / `deleteOrganization`；状态类型 `OrganizationStatus = "active" | "disabled"`。
- 角色：`listRoles` / `getRole` / `createRole` / `updateRole` / `disableRole` / `enableRole` / `deleteRole` / `listRoleUsers`；`Permission = string`（对接后端权限枚举），`RoleUserBindingType = "platform" | "workspace"`。

类型集中定义在文件头部：`UserRead` / `UserCreateRequest` / `UserUpdateRequest` / `UserListParams` / `UserSessionRead` / `AuditLogRead` / `OrganizationRead` / `OrganizationDetail` / `RoleRead` / `RoleCreateRequest` 等。

## 关键逻辑
典型 CRUD 调用模式（以角色为例）：
```
export async function createRole(req: RoleCreateRequest) {
  return apiFetch<RoleRead>("/api/admin/roles", {
    method: "POST", body: req,
  });
}
// 启停走 PATCH 子路径，返回更新后的实体
disableRole(id) → PATCH /api/admin/roles/<id>/disable → RoleRead
deleteRole(id)  → DELETE /api/admin/roles/<id> → void
```
列表查询参数 `*Params` 含 `page/page_size` 及过滤字段，由 `apiFetch` 序列化成 query（数组走重复 key）。

## 注意事项
- 该域所有端点要求调用方具备 `platform:admin` 或对应 `user:*` / `organization:*` / `role:*` 权限；401 由 apiFetch 自动刷新，403/404 透传。
- `Permission = string` 为宽松类型，实际合法值由后端 `Permission` 枚举约束（参见 `lib-menu-permissions` 注释列出的 46 个值）。
- 启停（disable/enable）与删除是三种不同操作：disable 软停用保留数据，delete 物理删除——UI 需区分二次确认。
- 重置密码 `resetUserPassword` 返回临时密码（`ResetPasswordResponse`），前端需一次性展示且不入日志。

## 人工备注
<!-- MANUAL_NOTES_START -->
<!-- MANUAL_NOTES_END -->
