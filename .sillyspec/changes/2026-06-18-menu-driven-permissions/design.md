---
author: WhaleFall
created_at: 2026-06-18T09:00:00
---

# 设计：菜单按权限驱动显隐

> 变更名：2026-06-18-menu-driven-permissions
> 类型：前端重构（数据结构 + 渲染逻辑）
> 影响范围：frontend/src/lib/{admin,permission,menu-permissions}.ts、frontend/src/components/{app-shell,admin-role-permission-picker}.tsx、相关单测
> 不影响：backend（Permission 枚举与 RBAC 校验完全保留）

## 1. 背景

当前前端权限粒度粗：

- `frontend/src/components/app-shell.tsx` 用 `hasAdminPermission(user)` 一次性判断是否显示整个「系统管理」分组（用户/组织/角色三个菜单一起出现），只要用户拥有 `user:*` / `organization:*` / `role:*` 任意前缀权限，三个菜单全部显示。
- `frontend/src/lib/admin.ts` 的 `PERMISSION_GROUPS`（6 大类）只服务于 `AdminRolePermissionPicker` 渲染，与菜单结构脱钩。
- `frontend/src/lib/permission.ts` 仅有 `hasAdminPermission` 一个 helper。

业务诉求：

- **菜单按权限显隐**：用户只看到自己有权访问的菜单。
- **权限配置按菜单分组**：picker 中以菜单为单位组织权限，让管理员直观知道勾选的权限会影响哪个菜单显示。
- **平台管理员短路**：`is_platform_admin = true` 时显示全部菜单。
- **后端校验保留**：前端隐藏只是 UX 优化，所有 `/api/admin/*` 仍走后端 RBAC 校验。

## 2. 设计目标

1. 引入 `MENU_PERMISSION_GROUPS`（扁平 list）作为菜单展示与权限规则的**单一数据源**。
2. `AppShell` 不再写死 4 个 NAV 常量，全部从 `MENU_PERMISSION_GROUPS` 按 section 过滤 + 权限判断渲染。
3. `AdminRolePermissionPicker` 改为按 `section → menu → permission` 三级渲染，每菜单支持折叠/全选/已选数量。
4. `permission.ts` 提供 `hasAnyPermission`、`canSeeMenu`、`visibleMenusBySection` 三个 helper。
5. 完全废弃 `PERMISSION_GROUPS`，删除相关类型与 helper（保留 `hasAdminPermission` 做向后兼容，标 deprecated 注释）。
6. 覆盖全部 19 个菜单，未在用户原始需求中列出的菜单按"合理默认权限"分配（见 §5 表）。

## 3. 非目标

- ❌ 不动后端代码（Permission 枚举、RoleSeed、RBAC resolver）。
- ❌ 不新增 Permission key（若发现菜单需要后端没有的 key，用兜底权限覆盖并在 §5 标注）。
- ❌ 不修改菜单的视觉/UI（icon、布局、collapse 按钮全部保留）。
- ❌ 不实现菜单粒度的服务端校验增强（现有 `/api/admin/*` 校验已足够）。
- ❌ 不做权限变更后的实时菜单刷新（依赖用户重新登录或 dashboard mount 时的 `fetchMe`，已在 ql-20260617-007 实现）。
- ❌ 不重写 `Permission.group()` 后端方法（仅前端使用旧分组）。

## 4. 拆分判断

不需要拆分。原因：

- 单一功能（菜单按权限显隐 + picker 重组），3 个区域必须协同改动，耦合度高。
- 不涉及 3+ 角色视图、跨页面状态流转。
- 任务数 < 10。

## 5. 总体方案

### 5.1 数据结构（`frontend/src/lib/menu-permissions.ts` 新增）

```typescript
export type MenuSection = "overview" | "management" | "admin" | "system";

export interface PermissionItem {
  key: string;          // e.g. "user:read"，需对齐 backend Permission 枚举
  name: string;         // 中文展示名
  description?: string;
}

export interface MenuPermissionGroup {
  section: MenuSection;
  menuKey: string;           // 唯一 key，关联 nav 与 picker
  menuLabel: string;
  icon: string;
  href: string;
  matchPattern?: string;     // 用于 active 高亮，复用现有 NavItem.matchPattern 语义
  absolute?: boolean;        // 是否绝对路径（vs workspace 相对）
  permissions: PermissionItem[];
}

export const MENU_PERMISSION_GROUPS: MenuPermissionGroup[] = [ /* 19 条 */ ];
```

### 5.2 19 个菜单的权限分配

| section | menuKey | menuLabel | permissionAny | 备注 |
|---|---|---|---|---|
| overview | workspaces | Workspace 首页 | [workspace:read] | 入口菜单 |
| overview | components | 项目组组件 | [workspace:read] | 后端无 component:*，用 workspace:read 兜底 |
| overview | topology | 拓扑图 | [workspace:read] | 同上 |
| overview | changes | 变更中心 | [change:create, change:read, change:update, change:approve, change:archive] | 用户列明 |
| overview | scan-docs | 扫描文档 | [workspace:read] | 兜底 |
| overview | runtime | 运行时 | [workspace:read, task:read] | 运行时面板涉及任务 |
| overview | knowledge | 知识 & 日志 | [workspace:read] | 兜底 |
| overview | releases | 发布 | [deploy:staging, deploy:production, deploy:rollback] | 用户列明 |
| management | git-identities | Git 身份管理 | [user:read, user:write] | 与用户管理共享权限域 |
| management | api-keys | API Keys | [platform:admin] | 后端 `_require_platform_admin` 强制 |
| management | agent | Agent 控制台 | [task:read, task:run_agent, task:cancel, tool:shell_exec, tool:network, tool:database, tool:secret:read] | 用户列明 |
| management | approvals | 审批中心 | [task:approve, change:approve] | 跨 task/change 审批 |
| management | audit | 审计中心 | [platform:audit:read] | 用户列明 |
| management | incidents | 事件 | [workspace:read] | 后端无 incident:*，兜底 |
| admin | users | 用户 | [user:read, user:write, user:login:manage] | 用户列明 |
| admin | organizations | 组织 | [organization:read, organization:write] | 用户列明 |
| admin | roles | 角色 | [role:read, role:write] | 用户列明 |
| system | runtimes | Daemon 运行时 | [platform:admin] | 平台级 |
| system | settings | 设置 | [platform:admin, user:read] | 入口设置页 |

⚠️ 兜底说明：后端 `Permission` 枚举（`backend/app/modules/auth/permissions.py`）目前不含 `component:*` / `incident:*`。本变更不扩枚举，相关菜单用 `workspace:read` 作为可见性兜底。后端 RBAC 仍按既有接口路径校验（如 `/api/workspaces/{id}/components` 已通过 workspace 成员关系判断）。

### 5.3 工具函数（`frontend/src/lib/permission.ts` 修改）

```typescript
// 新增
export function hasAnyPermission(user: SessionUser | null, perms: string[]): boolean;
// platform_admin 短路 OR perms 与 user.permissions 有交集
export function canSeeMenu(user: SessionUser | null, group: MenuPermissionGroup): boolean;
export function visibleMenusBySection(user: SessionUser | null, section: MenuSection): MenuPermissionGroup[];

// 保留（标 @deprecated，下一步迭代再清理引用）
export function hasAdminPermission(user: SessionUser | null): boolean;
```

### 5.4 Picker 重组（`frontend/src/components/admin-role-permission-picker.tsx` 修改）

渲染层级：

```
section（4 个：overview/management/admin/system，固定顺序）
  └─ menu（来自 MENU_PERMISSION_GROUPS.filter(g => g.section === section)）
       ├─ [全选 checkbox] menuLabel （已选 X/Y）
       └─ permission[]（checkbox grid，已存在样式）
```

交互：

- section 默认全展开（与现有「分组全展开」一致）
- menu 折叠状态独立维护（`useState<Set<string>>`）
- 全选逻辑：menu.permissions.every(in selected) 判断全选态
- 取消全选：filter 移除该 menu 全部 permission key
- 已选数量显示：`（X/Y）`

### 5.5 AppShell 改造（`frontend/src/components/app-shell.tsx` 修改）

删除 4 个常量：`OVERVIEW_NAV` / `MANAGEMENT_NAV` / `SYSTEM_NAV` / `ADMIN_NAV`。

渲染逻辑：

```tsx
{(["overview", "management", "admin", "system"] as MenuSection[]).map((section) => {
  const menus = visibleMenusBySection(user, section);
  if (menus.length === 0) return null;
  return (
    <Fragment key={section}>
      {renderGroupTitle(SECTION_LABEL[section])}
      {menus.map(renderNavLink)}
    </Fragment>
  );
})}
```

`NavItem` 接口扩展：增加可选 `menuKey`，但因为新的渲染全部来自 `MENU_PERMISSION_GROUPS`，NavItem 接口实际上可被 MenuPermissionGroup 替代。`resolveHref` / `isActive` 等纯函数保留，操作对象从 NavItem 切换到 MenuPermissionGroup（字段兼容）。

### 5.6 admin.ts 清理

删除：`PermissionGroup`、`PermissionWithGroup`、`PERMISSION_GROUPS`、`ALL_PERMISSIONS`、`GROUP_LABEL` 常量。

保留：所有 API client 函数（listUsers/createUser/listRoles 等）和 DTO interface（UserRead/RoleRead 等）。

### 5.7 测试

新增：

- `frontend/src/lib/__tests__/permission.test.ts`：`hasAnyPermission` / `canSeeMenu` / `visibleMenusBySection` 单测，覆盖 6 个手工验证矩阵。
- `frontend/src/lib/__tests__/menu-permissions.test.ts`：`menuKey` 唯一性、`permissions[].key` 全部命中后端 Permission 枚举、每个 menu 至少 1 个 permission。

修改：

- `frontend/src/components/__tests__/admin-role-permission-picker.test.tsx`：适配新数据源（按 section→menu 渲染），验证全选/折叠交互。

## 6. 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 新增 | frontend/src/lib/menu-permissions.ts | MENU_PERMISSION_GROUPS 数据源 + 类型定义 |
| 修改 | frontend/src/lib/permission.ts | 新增 hasAnyPermission/canSeeMenu/visibleMenusBySection |
| 修改 | frontend/src/lib/admin.ts | 删除 PERMISSION_GROUPS 等 6 大类相关 export |
| 修改 | frontend/src/components/app-shell.tsx | 删除 4 个 NAV 常量；改用 visibleMenusBySection 渲染 |
| 修改 | frontend/src/components/admin-role-permission-picker.tsx | 切换数据源到 MENU_PERMISSION_GROUPS；按 section→menu→permission 渲染 |
| 新增 | frontend/src/lib/__tests__/permission.test.ts | 3 个 helper 单测 |
| 新增 | frontend/src/lib/__tests__/menu-permissions.test.ts | 数据完整性单测 |
| 修改 | frontend/src/components/__tests__/admin-role-permission-picker.test.tsx | 适配新数据源 |

## 7. 接口定义

无新增对外接口。内部 TypeScript 接口已在 §5.1 / §5.3 给出。

## 8. 数据模型

无变更。本变更纯前端，不涉及数据库表或字段。

## 9. 兼容策略

| 场景 | 当前行为 | 新行为 |
|---|---|---|
| 平台管理员登录 | 看到全部菜单 | 不变（`canSeeMenu` 内部短路） |
| 拥有 `user:*` 任一权限的普通用户 | 看到「系统管理」3 个菜单全部 | 只看到匹配的菜单（只有 user:read → 只看到「用户」） |
| 只有 `workspace:read` 的用户 | 看到所有 OVERVIEW + MANAGEMENT + SYSTEM 菜单 | 看到 OVERVIEW 全部 + MANAGEMENT 中 git-identities/incidents + SYSTEM 都看不到（无 platform:admin） |
| 无任何权限的用户（理论不应存在） | 看到所有菜单 | 看不到任何菜单（仅显示品牌 + 退出按钮） |
| 角色编辑 picker | 6 大类分组 | 4 个 section × N 个 menu 分组，结构变化但功能等价 |
| `/api/admin/*` 后端校验 | 不变 | 不变 |

回退路径：如新方案出现问题，可单独 revert picker 改动（恢复 PERMISSION_GROUPS），AppShell 改动可单独保留（visibleMenusBySection 内部对 platform_admin 兜底，普通用户即使配置错误最多少看几个菜单，不会越权）。

## 10. 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | 后端无 component:* / incident:* 权限，相关菜单只能用 workspace:read 兜底，权限粒度变粗 | P2 | 在 §5.2 标注；如需精细控制，后续变更扩展后端 Permission 枚举 |
| R-02 | 已登录用户的 session.permissions 可能为空（ql-20260617-007 前） | P2 | ql-007 已在 dashboard layout mount 时 fetchMe 刷新；本变更不额外处理 |
| R-03 | AppShell 改动后菜单结构变化，可能与某些 e2e 测试断言冲突 | P2 | 执行前 grep `AppShell`/`OVERVIEW_NAV`/`MANAGEMENT_NAV` 在测试中的引用，按需调整 |
| R-04 | AdminRolePermissionPicker 测试改动可能破坏现有 CI | P1 | ruff/jest 测试本地跑通后再 commit；保留旧测试断言的核心场景（展开/全选/数量） |
| R-05 | permission.ts 同时保留新旧 helper 可能让调用方混淆 | P3 | `hasAdminPermission` 标 @deprecated，grep 全部调用点切换到新 helper 后再清理 |

## 11. 自审

| 检查项 | 结论 |
|---|---|
| 需求覆盖（19 菜单全覆盖 / picker 重组 / 3 个 helper / is_platform_admin 短路 / 后端校验保留） | ✅ 全覆盖 |
| 约束一致性（不改后端、不扩 Permission 枚举、不新增表） | ✅ 与 §3 非目标一致 |
| 真实性（菜单/权限 key 来自 backend Permission 枚举或标注兜底） | ✅ §5.2 已标注 |
| YAGNI（无未来功能、无未使用代码） | ✅ 旧 helper 标 deprecated 而非立即删除，避免连锁修改 |
| 验收标准可测 | ✅ §5.7 测试清单 + 用户原始需求中的 6 个手工验证矩阵 |
| 非目标清晰 | ✅ §3 明确 6 项不做 |
| 兼容策略 | ✅ §9 提供 5 种场景对比 + 回退路径 |
| 风险识别 | ✅ §10 列 5 项 P1-P3 风险 |

⚠️ 自审存疑：

- 后端 Permission 枚举没有 `component:*` / `incident:*` —— 当前用 `workspace:read` 兜底是否合理？设计选择：是。理由是当前 `/api/workspaces/{id}/components` 和 `/api/workspaces/{id}/incidents` 都依赖 workspace 成员关系而非细粒度权限。如未来需要更细粒度，另起变更扩枚举。
