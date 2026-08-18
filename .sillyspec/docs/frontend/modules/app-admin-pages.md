---
schema_version: 1
doc_type: module-card
module_id: app-admin-pages
author: qinyi
created_at: 2026-08-18 01:45:00
---

# 后台管理页面（app-admin-pages）

## 定位
后台管理页面集合，挂在 `/admin/*` 路由组下（layout + 3 页：users / roles / organizations），负责平台级用户、角色、组织管理。所有页面共享 `admin/layout.tsx` 管理员准入校验，写操作与下钻视图多经 components-admin 的抽屉/选择器承载，数据走 lib-admin。

## 契约摘要
- `AdminLayout`（`/admin`，31 行）：hydrate 后无 token → `replace("/login")`；`hasAdminPermission(user)` 不过 → `setDenied(true)` + `replace("/")`；渲染层 denied / 无权限一律 `return null`。
- `AdminUsersPage`（`/admin/users`，898 行）：用户 CRUD + 会话/审计下钻。
  - 列表：`listUsers(params)`（分页 + status 筛选 + selectedOrgId 组织过滤）；下拉源 `Promise.allSettled([listOrganizations(), listRoles()])` 预填（失败只影响下拉不拖垮主列表）。
  - 抽屉 state：`drawer`（AdminUserDrawer，mode=create|edit）、`sessionsDrawer`（用户会话）、`auditDrawer`（用户审计）、`confirmDelete`、`resetTarget`（重置密码）五类。
- `AdminRolesPage`（`/admin/roles`）：角色列表 + 菜单权限点勾选（`AdminRolePermissionPicker`），权限分组定义在 lib-menu-permissions（MENU_PERMISSION_GROUPS）。
- `AdminOrganizationsPage`（`/admin/organizations`）：组织树/列表管理（`AdminOrganizationTree` / `AdminOrgTree` 两代树组件），含启停/删除组织。

## 关键逻辑
```
AdminLayout: !hydrated→null; !accessToken→replace(/login)
             !hasAdminPermission→denied+replace(/)→渲染 null
UsersPage:   listUsers(分页/筛选) + allSettled([orgs, roles]) 下拉源
             写成功(创建/编辑/删除/重置) → 重触发 load 刷新列表
```

## 注意事项
- 管理员判定是前端展示层屏蔽，真实鉴权在后端；`return null` / redirect 不是安全边界。
- 下拉预填用 `allSettled`：组织/角色接口失败只降级下拉，不阻塞用户列表（与旧 `Promise.all` 行为不同，勿改回）。
- 抽屉 state 多（drawer/sessionsDrawer/auditDrawer/confirmDelete/resetTarget），新增下钻入口注意 mode 区分 create/edit，复用既有 state 形态。
- 自我编辑限制在 `AdminUserDrawer`（isSelf 部分操作禁用），页面层不重复判。

## 人工备注
<!-- MANUAL_NOTES_START -->
<!-- MANUAL_NOTES_END -->
