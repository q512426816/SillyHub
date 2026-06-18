---
author: WhaleFall
created_at: 2026-06-18T09:21:52
---

# Proposal

## 动机

SillyHub 当前菜单显隐只看「用户是否拥有任意 admin 前缀权限」，导致只要给了 `user:read` 一个权限，用户/组织/角色三个菜单全部出现；而 picker 又按 6 大功能类目分组配置权限，跟菜单完全脱钩——管理员勾选权限时根本不知道这会影响哪个菜单显示。本次变更把权限分组对齐菜单结构，并按权限粒度独立控制每个菜单的显隐。

## 关键问题

1. **菜单显隐粒度过粗**：`AppShell` 用 `hasAdminPermission(user)` 一次性判断整个「系统管理」分组，用户/组织/角色三个菜单同生共死。只有 `user:read` 的用户看到全部 3 个菜单，进入「组织」页面后被后端 403 拒绝，体验割裂。
2. **picker 分组与菜单脱钩**：`PERMISSION_GROUPS` 按 PLATFORM/ADMIN/WORKSPACE/AGENT/CHANGE/AUDIT 6 大类分组，管理员勾选时无法预判权限对菜单的影响。新增菜单时既要改 `AppShell` 的 NAV 常量又要改 `PERMISSION_GROUPS`，两套结构容易漂移。
3. **权限工具函数单一**：`permission.ts` 只有 `hasAdminPermission`，无法表达「这个菜单需要任一以下权限」的语义，业务方只能在前端到处写 `user.permissions?.some(p => p.startsWith('user:'))` 这种重复代码。

## 变更范围

- 新增 `frontend/src/lib/menu-permissions.ts`：定义扁平 `MENU_PERMISSION_GROUPS`（19 条，覆盖现有所有菜单）。
- 修改 `frontend/src/lib/permission.ts`：新增 `hasAnyPermission` / `canSeeMenu` / `visibleMenusBySection`。
- 修改 `frontend/src/lib/admin.ts`：删除 `PERMISSION_GROUPS` 及相关 export。
- 修改 `frontend/src/components/app-shell.tsx`：删除 4 个 NAV 常量，改用 `visibleMenusBySection` 渲染。
- 修改 `frontend/src/components/admin-role-permission-picker.tsx`：按 `section → menu → permission` 三级渲染。
- 新增/修改单测覆盖 3 个 helper + picker 重组 + 数据完整性。

## 不在范围内（显式清单）

- 不修改 backend `Permission` 枚举（不新增 `component:*` / `incident:*` 等键）。
- 不修改 backend RBAC resolver 或任何 `/api/admin/*` 端点。
- 不新增数据库表或字段。
- 不实现权限变更后的实时菜单刷新（依赖 dashboard mount 时的 `fetchMe`，ql-20260617-007 已实现）。
- 不重写菜单视觉样式（icon、布局、collapse 全部保留）。
- 不立即删除 `hasAdminPermission`（标 `@deprecated` 保留向后兼容，下一步迭代清理）。

## 成功标准（可验证）

- ✅ 19 个菜单全部在 `MENU_PERMISSION_GROUPS` 中有定义，`menuKey` 唯一。
- ✅ 单测覆盖：只有 `user:read` → 只看到「用户」菜单；只有 `organization:read` → 只看到「组织」；只有 `role:read` → 只看到「角色」。
- ✅ 单测覆盖：拥有任意 `task:*` 或 `tool:*` 权限 → 看到「Agent 控制台」。
- ✅ 单测覆盖：无 admin 前缀权限的用户不显示「系统管理」section。
- ✅ 单测覆盖：`is_platform_admin = true` 时显示全部菜单。
- ✅ Picker 中权限按 menuKey 分组，每菜单可独立折叠/全选，显示已选数量。
- ✅ `frontend/src/lib/admin.ts` 中 `PERMISSION_GROUPS` / `PermissionGroup` / `PermissionWithGroup` 三个 export 完全删除。
- ✅ `pnpm typecheck && pnpm lint && pnpm test` 全绿。
- ✅ 后端 `/api/admin/*` 行为不变（手工 curl 验证 401/403 路径未回归）。
