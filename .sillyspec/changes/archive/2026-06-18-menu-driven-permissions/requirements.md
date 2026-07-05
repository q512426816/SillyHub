---
author: WhaleFall
created_at: 2026-06-18T09:21:52
---

# Requirements

## 角色

| 角色 | 说明 |
|---|---|
| 平台管理员 | `is_platform_admin = true`，短路所有权限检查 |
| 系统管理员（自定义角色） | 拥有 `user:*` / `organization:*` / `role:*` 中至少一项权限 |
| 工作区成员 | 仅拥有 `workspace:read` 等基础权限 |
| 普通开发者 | 拥有 `task:*` / `change:*` 等业务权限 |
| 无权用户 | 理论上不应存在；作边界用例覆盖 |

## 功能需求

### FR-01: 数据源单一化

Given `frontend/src/lib/menu-permissions.ts` 已定义 19 条 `MENU_PERMISSIONGroup`
When 任意组件需要"列出某 section 下的菜单"或"查询某 menuKey 的权限"
Then 全部从 `MENU_PERMISSION_GROUPS` 读取，不再有第二份数据源

### FR-02: menuKey 唯一性

Given `MENU_PERMISSION_GROUPS` 已就绪
When 测试遍历所有条目
Then 19 个 `menuKey` 互不重复（`workspaces` / `components` / `topology` / `changes` / `scan-docs` / `runtime` / `knowledge` / `releases` / `git-identities` / `api-keys` / `agent` / `approvals` / `audit` / `incidents` / `users` / `organizations` / `roles` / `runtimes` / `settings`）

### FR-03: 权限 key 合法性

Given `MENU_PERMISSION_GROUPS[*].permissions[*].key`
When 测试用 backend `Permission` 枚举值集合校验
Then 所有 key 都在枚举内（无拼写错误、无废弃值）

### FR-04: hasAnyPermission 语义

Given 用户 `permissions = ["user:read"]`
When 调用 `hasAnyPermission(user, ["user:write", "user:login:manage"])`
Then 返回 `false`

Given 用户 `permissions = ["user:read"]`
When 调用 `hasAnyPermission(user, ["user:read", "organization:read"])`
Then 返回 `true`

Given 用户 `is_platform_admin = true`
When 调用 `hasAnyPermission(user, [])`
Then 返回 `true`（短路）

Given 用户为 `null`
When 调用 `hasAnyPermission(null, ["user:read"])`
Then 返回 `false`

### FR-05: canSeeMenu 语义

Given 用户 `permissions = ["user:read"]`，菜单 group = `{ menuKey: "users", permissions: [{key:"user:read"},{key:"user:write"},{key:"user:login:manage"}] }`
When 调用 `canSeeMenu(user, group)`
Then 返回 `true`

Given 用户 `permissions = ["organization:read"]`，同一 users 菜单 group
When 调用 `canSeeMenu(user, group)`
Then 返回 `false`

Given 用户 `is_platform_admin = true`，任意 group
When 调用 `canSeeMenu(user, group)`
Then 返回 `true`

### FR-06: visibleMenusBySection 过滤

Given 用户 `permissions = ["user:read"]`
When 调用 `visibleMenusBySection(user, "admin")`
Then 返回仅 1 条（`menuKey: "users"`），不含 `organizations` / `roles`

Given 用户 `permissions = ["workspace:read"]`
When 调用 `visibleMenusBySection(user, "system")`
Then 返回空数组（无 `platform:admin`）

Given 用户 `is_platform_admin = true`
When 调用 `visibleMenusBySection(user, "admin")`
Then 返回全部 3 条（users/organizations/roles）

### FR-07: AppShell 按 section 渲染

Given 用户已登录且 dashboard layout 完成 mount（`fetchMe` 已填充 `permissions`）
When 渲染 `<AppShell>`
Then 侧栏按固定顺序展示 `overview` / `management` / `admin` / `system` 四组
And 每个 section 内只渲染 `canSeeMenu` 为 true 的菜单
And section 内菜单全部不可见时整个 section 标题也隐藏

### FR-08: Picker 三级渲染

Given `AdminRolePermissionPicker` 接收 `permissions` prop
When 渲染
Then 顶层显示 4 个 section（固定顺序 overview → management → admin → system）
And section 下渲染该 section 的 menu 列表
And 每个 menu 显示：折叠按钮 + 全选 checkbox + menuLabel + 已选数量（X/Y）
And 展开后显示该 menu 的 permission grid

### FR-09: Picker 全选交互

Given menu `users` 的 3 个 permission 全部已选
When 用户点击 `users` 的全选 checkbox
Then `onChange` 被调用，3 个 permission 全部从列表移除

Given menu `users` 的 3 个 permission 部分选中
When 用户点击 `users` 的全选 checkbox
Then `onChange` 被调用，3 个 permission 全部加入列表（不影响其他 menu 的选中状态）

### FR-10: Picker 折叠状态独立

Given menu `users` 折叠，`organizations` 展开
When 用户切换 `users` 折叠状态
Then `organizations` 折叠状态不变

### FR-11: admin.ts 清理

When 在仓库中 `grep -r "PERMISSION_GROUPS\|PermissionGroup\|PermissionWithGroup" frontend/src/`
Then 无任何匹配（除 `@deprecated` 注释中的引用）

### FR-12: AppShell 旧常量清理

When 在仓库中 `grep -rE "OVERVIEW_NAV|MANAGEMENT_NAV|SYSTEM_NAV|ADMIN_NAV" frontend/src/`
Then 无任何匹配

## 非功能需求

- **兼容性**：保留 `hasAdminPermission`（标 `@deprecated`），不立即删除避免连锁修改。
- **可回退**：AppShell 改动可单独 revert，picker 改动可单独 revert，互不依赖。
- **可测试**：所有 helper 是纯函数，单测 100% 覆盖；picker 改动有集成测试。
- **性能**：`MENU_PERMISSION_GROUPS` 19 条目，`.filter` 操作 O(N)，无可观测开销。
- **后端无关**：本变更纯前端，CI 不需要 backend 测试。
- **类型安全**：`pnpm typecheck` 必须通过，禁止 `any`。
