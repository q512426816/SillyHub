---
author: WhaleFall
created_at: 2026-06-18T09:21:52
---

# Tasks

> 任务名仅列出名称与对应文件路径，实现细节在 plan 阶段展开。

## Task 列表

- [ ] T-01: 新增 `frontend/src/lib/menu-permissions.ts`，定义 `MenuSection` / `PermissionItem` / `MenuPermissionGroup` 类型与 19 条 `MENU_PERMISSION_GROUPS` 常量
- [ ] T-02: 修改 `frontend/src/lib/permission.ts`，新增 `hasAnyPermission` / `canSeeMenu` / `visibleMenusBySection`，`hasAdminPermission` 标 `@deprecated`
- [ ] T-03: 新增 `frontend/src/lib/__tests__/menu-permissions.test.ts`，覆盖 menuKey 唯一性 + permission key 合法性
- [ ] T-04: 新增 `frontend/src/lib/__tests__/permission.test.ts`，覆盖 `hasAnyPermission` / `canSeeMenu` / `visibleMenusBySection` 全部 GWT 用例
- [ ] T-05: 修改 `frontend/src/lib/admin.ts`，删除 `PERMISSION_GROUPS` / `PermissionGroup` / `PermissionWithGroup` 三个 export，保留 API client
- [ ] T-06: 修改 `frontend/src/components/admin-role-permission-picker.tsx`，切换数据源到 `MENU_PERMISSION_GROUPS`，按 section → menu → permission 三级渲染
- [ ] T-07: 修改 `frontend/src/components/__tests__/admin-role-permission-picker.test.tsx`，适配新数据源 + 验证 section/menu/permission 三级结构 + 全选/折叠交互
- [ ] T-08: 修改 `frontend/src/components/app-shell.tsx`，删除 4 个 NAV 常量（`OVERVIEW_NAV` / `MANAGEMENT_NAV` / `SYSTEM_NAV` / `ADMIN_NAV`），改用 `visibleMenusBySection` 渲染
- [ ] T-09: 跑 `pnpm typecheck && pnpm lint && pnpm test`，修复回归
- [ ] T-10: 重建 frontend Docker 镜像，手工验证 6 个用例矩阵（用户原始需求 §8）
