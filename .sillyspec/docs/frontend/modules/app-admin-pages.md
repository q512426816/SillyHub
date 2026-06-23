---
schema_version: 1
doc_type: module-card
module_id: app-admin-pages
source_commit: ba87eec
author: qinyi
created_at: 2026-06-24T01:02:00
---
# app-admin-pages

## 定位
后台管理页面集合，挂在 `/admin/*` 路由组下，负责平台级用户、角色、组织管理。所有页面共享 `admin/layout.tsx` 做管理员准入校验，UI 操作多通过 components-admin 的抽屉/对话框承载，数据走 lib-admin 客户端。

## 契约摘要
- `AdminLayout`（`/admin`）：用 `useSession()` 取 hydrated/user/accessToken，`hasAdminPermission(user)` 判定；未登录等待 hydrate，无管理员权限则渲染空（不跳转，由上层布局统一处理），通过校验才渲染 children。
- `AdminUsersPage`（`/admin/users`）：用户 CRUD + 会话/审计下钻。`listUsers(params)`（带分页/筛选）拉列表，`createUser/updateUser/deleteUser` 写操作；并行 `listOrganizations()` 与 `listRoles({size:100})` 预填表单下拉。含创建/编辑抽屉（`AdminUserDrawer`）、会话抽屉、审计抽屉三类 state。
- `AdminRolesPage`（`/admin/roles`）：角色列表 + 权限点勾选，走 lib-admin 的角色接口与 components-admin 的权限选择器。
- `AdminOrganizationsPage`（`/admin/organizations`）：组织树/列表管理。

## 关键逻辑
- AdminLayout 准入（伪代码）：
  ```
  if (!hydrated) return null            // 等 session 恢复
  if (!hasAdminPermission(user)) return null  // 静默拒绝，避免闪烁
  return <>{children}</>
  ```
- UsersPage 加载：`Promise.all([listUsers(params), listOrganizations(), listRoles({size:100})])` 一次取齐列表与下拉源。
- 写操作成功后重新触发列表刷新（复用 load 函数）。

## 注意事项
- 管理员判定基于 session user 的权限位，前端只做展示层屏蔽，真实鉴权在后端；勿把 layout 的 return null 当作安全边界。
- 角色下拉固定 `size:100`，角色数超 100 时下拉会不全（当前规模可接受）。
- 抽屉 state（drawer/sessionsDrawer/auditDrawer）较多，新增下钻入口时注意 mode 区分 create/edit。

## 人工备注
<!-- MANUAL_NOTES_START -->
<!-- MANUAL_NOTES_END -->
