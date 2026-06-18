---
author: WhaleFall
created_at: 2026-06-18T09:35:00
---

# task-02：permission.ts 新增 3 个 helper

> Wave 1 / 优先级 P0 / 无前置依赖（与 task-01 并行）
> 关联设计：`design.md` §5.3（工具函数语义）
> 关联需求：`requirements.md` FR-04（hasAnyPermission）/ FR-05（canSeeMenu）/ FR-06（visibleMenusBySection）
> 关联计划：`plan.md` Wave 1

## 修改文件

- [ ] 修改 `frontend/src/lib/permission.ts`（新增 3 个 export + 给 `hasAdminPermission` 加 `@deprecated` JSDoc）
- [ ] 新增 `frontend/src/lib/__tests__/permission.test.ts`（先红后绿，TDD）

## 上下文摘要（核对依据）

### 现有 `permission.ts` 实现要点

- 当前文件仅 13 行，导出 1 个函数 `hasAdminPermission`。
- 入参类型：`SessionUser | null`（来自 `@/stores/session`）。
- 已存在的 platform_admin 短路模式：`if (!user) return false; if (user.is_platform_admin) return true;` —— 新 helper 必须沿用同样的短路模式与 null 安全模式。
- 已存在的兜底空数组模式：`const perms = user.permissions ?? [];` —— 新 helper 必须沿用，禁止假设 `user.permissions` 一定存在。

### `SessionUser` 类型（来自 `frontend/src/stores/session.ts`）

```typescript
export interface SessionUser {
  id: string;
  email: string;
  displayName: string;
  is_platform_admin?: boolean;   // 注意：可选字段，未定义时视为 false
  permissions?: string[];        // 注意：可选字段，未定义时兜底为 []
}
```

### task-01 产出的 `MenuPermissionGroup` / `MenuSection`（来自 `frontend/src/lib/menu-permissions.ts`）

```typescript
export type MenuSection = "overview" | "management" | "admin" | "system";

export interface PermissionItem {
  key: string;
  name: string;
  description?: string;
}

export interface MenuPermissionGroup {
  section: MenuSection;
  menuKey: string;
  menuLabel: string;
  icon: string;
  href: string;
  matchPattern?: string;
  absolute?: boolean;
  permissions: PermissionItem[];   // 至少 1 条（task-01 边界 #4 保证）
}
```

⚠️ task-02 依赖 task-01 的产出文件存在，但**实现本任务时只需 import 类型**，不依赖运行时数据正确性。task-01 的 `MENU_PERMISSION_GROUPS` 数据正确性由 task-03 单独验证。

### FR-04/05/06 GWT 摘要（语义必须 1:1 对齐）

| FR | Given | When | Then |
|---|---|---|---|
| FR-04a | user.permissions = ["user:read"] | hasAnyPermission(user, ["user:write", "user:login:manage"]) | false |
| FR-04b | user.permissions = ["user:read"] | hasAnyPermission(user, ["user:read", "organization:read"]) | true |
| FR-04c | user.is_platform_admin = true | hasAnyPermission(user, []) | true（短路） |
| FR-04d | user = null | hasAnyPermission(null, ["user:read"]) | false |
| FR-05a | user.permissions = ["user:read"], group = users(3 perms) | canSeeMenu(user, group) | true |
| FR-05b | user.permissions = ["organization:read"], group = users | canSeeMenu(user, group) | false |
| FR-05c | user.is_platform_admin = true, 任意 group | canSeeMenu(user, group) | true |
| FR-06a | user.permissions = ["user:read"] | visibleMenusBySection(user, "admin") | [users]（不含 orgs/roles） |
| FR-06b | user.permissions = ["workspace:read"] | visibleMenusBySection(user, "system") | []（无 platform:admin） |
| FR-06c | user.is_platform_admin = true | visibleMenusBySection(user, "admin") | [users, organizations, roles] 全部 3 条 |

## 实现要求

### 1. `hasAnyPermission(user, perms)`

**语义**：

1. `user === null` → 返回 `false`（FR-04d）
2. `user.is_platform_admin === true` → 返回 `true`，**短路**，不再检查 perms 数组（FR-04c，即使 `perms = []` 也返回 true）
3. 否则：取 `userPermissions = user.permissions ?? []`，判断 `perms` 数组中**至少有一个**元素在 `userPermissions` 中出现（集合交集非空）
4. `perms = []` 且 `is_platform_admin = false` → 返回 `false`（无任何权限可匹配）
5. 不修改入参，纯函数

**实现提示**：

- 用 `Set` 把 `userPermissions` 转成集合后用 `perms.some(p => set.has(p))`，O(N+M)。
- 或直接 `perms.some(p => userPermissions.includes(p))`，O(N*M)，19 菜单 × 36 权限量级无性能问题，两种写法均可。
- 严禁 `any`。

### 2. `canSeeMenu(user, group)`

**语义**：

1. `user === null` → 返回 `false`
2. `user.is_platform_admin === true` → 返回 `true`（FR-05c，短路）
3. 否则：从 `group.permissions` 中提取 `key` 数组 `permKeys = group.permissions.map(p => p.key)`
4. 复用 `hasAnyPermission(user, permKeys)` —— **必须复用，不要重复实现交集逻辑**
5. 注意：task-01 边界 #4 保证 `group.permissions.length >= 1`，本函数无需处理 `group.permissions = []` 的边界（但若误传空数组，`hasAnyPermission` 会返回 false，行为安全）

**实现提示**：

```typescript
export function canSeeMenu(user: SessionUser | null, group: MenuPermissionGroup): boolean {
  if (!user) return false;
  if (user.is_platform_admin) return true;
  const permKeys = group.permissions.map((p) => p.key);
  return hasAnyPermission(user, permKeys);
}
```

⚠️ 上面的代码片段是**蓝图示意**，不是要求照抄。实现时按上面语义落地即可。

### 3. `visibleMenusBySection(user, section)`

**语义**：

1. 平台管理员短路：`user?.is_platform_admin === true` → 直接返回 `MENU_PERMISSION_GROUPS.filter(g => g.section === section)`（FR-06c，全部菜单可见）
2. 否则：`MENU_PERMISSION_GROUPS.filter(g => g.section === section).filter(g => canSeeMenu(user, g))`（FR-06a/b）
3. `user === null` → 第 2 步的 `canSeeMenu(null, g)` 全部返回 false，结果为 `[]`（无需特判）
4. 返回类型必须是 `MenuPermissionGroup[]`，**禁止**返回 `any[]` / `readonly MenuPermissionGroup[]`
5. 保持原数组顺序（即 task-01 中 `MENU_PERMISSION_GROUPS` 的声明顺序）

**实现提示**：

- 不要用 `.reduce` / `.flatMap` 等花哨写法，两个 `.filter` 链最清晰。
- section 类型必须是 `MenuSection`，不要放宽到 `string`（否则 ts 类型检查会丢失字面量约束）。

### 4. `hasAdminPermission` 标 `@deprecated`

**要求**：

- 函数体**完全保留不动**（包括 `ADMIN_PERMISSION_PREFIXES` 常量、null 安全、短路逻辑、`?? []` 兜底）。
- 在函数上方添加 JSDoc 注释块，必须包含：
  - `@deprecated` 标签
  - 说明文字：「按功能前缀判断的旧 helper，已被 `canSeeMenu` / `visibleMenusBySection` 取代。新代码请勿调用，后续清理任务会移除。」
  - 推荐替代：`visibleMenusBySection(user, "admin").length > 0`

**JSDoc 示意**（实际落地可微调措辞）：

```typescript
/**
 * @deprecated 按功能前缀（user:/organization:/role:）判断的旧 helper，
 * 已被 `canSeeMenu` / `visibleMenusBySection` 取代。新代码请勿调用，
 * 后续清理任务会移除所有引用。
 *
 * 替代方案：
 *   visibleMenusBySection(user, "admin").length > 0
 *   // 或对单个菜单精确判断
 *   canSeeMenu(user, usersMenuGroup)
 */
export function hasAdminPermission(user: SessionUser | null): boolean {
  // 函数体保持不变
}
```

⚠️ 不要修改函数体；不要修改现有的调用方（task-08 会处理 AppShell，picker 任务会处理 picker，本任务不动其他文件）。

## 接口定义

```typescript
import type { SessionUser } from "@/stores/session";
import type { MenuPermissionGroup, MenuSection } from "@/lib/menu-permissions";

/**
 * 判断用户是否拥有给定权限列表中的任意一项。
 *
 * - user 为 null → false
 * - user.is_platform_admin === true → true（短路，无视 perms）
 * - 否则：perms 与 user.permissions 有交集 → true
 */
export function hasAnyPermission(
  user: SessionUser | null,
  perms: string[],
): boolean;

/**
 * 判断用户是否能看到指定菜单。
 *
 * - user 为 null → false
 * - user.is_platform_admin === true → true（短路）
 * - 否则：group.permissions 中任一 key 在 user.permissions 中 → true
 */
export function canSeeMenu(
  user: SessionUser | null,
  group: MenuPermissionGroup,
): boolean;

/**
 * 返回某 section 下用户可见的全部菜单（保持 MENU_PERMISSION_GROUPS 声明顺序）。
 *
 * - user.is_platform_admin === true → 该 section 全部菜单
 * - 否则：过滤后只保留 canSeeMenu 为 true 的菜单
 * - user 为 null → 空数组
 */
export function visibleMenusBySection(
  user: SessionUser | null,
  section: MenuSection,
): MenuPermissionGroup[];

/** @deprecated 见上文 JSDoc 说明 */
export function hasAdminPermission(user: SessionUser | null): boolean;
```

⚠️ 入参类型严格，禁止 `any`。`perms` / `section` 不允许放宽到 `string`。

## 边界处理

1. **user === null**：3 个 helper 均返回 `false` / `[]`，禁止抛 `TypeError: Cannot read property 'permissions' of null`。FR-04d 明确要求。
2. **user.permissions === undefined**：`SessionUser.permissions` 是可选字段。用 `user.permissions ?? []` 兜底，禁止 `user.permissions.some(...)` 直调（会抛错）。
3. **user.is_platform_admin === undefined**：`SessionUser.is_platform_admin` 是可选字段。`if (user.is_platform_admin)` 在 undefined 时为 falsy，自然进入普通用户分支，**无需** `=== true` 显式判断（两种写法都可，但必须语义正确）。
4. **perms 入参为空数组**（`hasAnyPermission(user, [])`）：非平台管理员时返回 `false`（无可匹配项）；平台管理员时短路返回 `true`（FR-04c）。
5. **group.permissions 为空数组**：task-01 边界 #4 保证 `permissions.length >= 1`，本任务函数不会遇到。但若上游误传空数组，`canSeeMenu` 内部走 `hasAnyPermission(user, [])` → 非管理员返回 `false`，行为安全（菜单不可见），不会崩溃。
6. **section 字面量越界**：`visibleMenusBySection(user, "nonexistent" as MenuSection)` —— TS 编译期会拦截；运行时若绕过类型检查传入不存在的 section，`.filter(g => g.section === section)` 返回 `[]`，行为安全。
7. **重复权限 key**：`user.permissions = ["user:read", "user:read"]` —— 不影响判断（`.some` / `Set.has` 都能正确处理重复），无需去重。
8. **大小写敏感**：权限 key 大小写敏感（`"User:Read"` 与 `"user:read"` 不相等），不做归一化。后端枚举值都是小写，前端字面量也必须小写。
9. **`MENU_PERMISSION_GROUPS` 未导出或路径错误**：若 import 路径写错，TS 编译期会报错；本任务必须 import 自 `@/lib/menu-permissions`，不要相对路径 `./menu-permissions`（与现有 `@/stores/session` 风格一致）。

## 非目标

本任务 **不做** 以下事情（留给后续 task）：

- ❌ 不修改 `hasAdminPermission` 的函数体（只加 JSDoc）
- ❌ 不删除 `hasAdminPermission` 函数（design.md §5.3 明确保留做向后兼容）
- ❌ 不修改 `hasAdminPermission` 的任何现有调用方（grep 调用点由后续清理任务负责）
- ❌ 不修改后端权限解析（`backend/app/modules/auth/`）
- ❌ 不引入 React Hook（3 个 helper 都是纯函数，无副作用，可在组件外调用）
- ❌ 不引入新依赖（禁止 `pnpm add`）
- ❌ 不修改 `menu-permissions.ts`（task-01 的产出）
- ❌ 不修改 `admin.ts`（task-05 负责）
- ❌ 不修改 `app-shell.tsx`（task-08 负责）
- ❌ 不修改 `admin-role-permission-picker.tsx`（task-06 负责）

## TDD 步骤

### 步骤 1：先写测试（红）

新建 `frontend/src/lib/__tests__/permission.test.ts`，至少覆盖：

**FR-04 hasAnyPermission（≥ 5 个用例）**：

- `hasAnyPermission(null, ["user:read"]) === false`（FR-04d）
- `hasAnyPermission({ ..., is_platform_admin: true }, []) === true`（FR-04c 短路）
- `hasAnyPermission({ ..., permissions: ["user:read"] }, ["user:write", "user:login:manage"]) === false`（FR-04a）
- `hasAnyPermission({ ..., permissions: ["user:read"] }, ["user:read", "organization:read"]) === true`（FR-04b）
- `hasAnyPermission({ ..., permissions: undefined as any }, ["user:read"]) === false`（边界：permissions undefined）
- `hasAnyPermission({ ..., permissions: [] }, ["user:read"]) === false`（边界：用户无权限）
- `hasAnyPermission({ ..., permissions: ["user:read"] }, []) === false`（边界：查询列表空）

**FR-05 canSeeMenu（≥ 4 个用例）**：

- `canSeeMenu(null, usersGroup) === false`
- `canSeeMenu({ ..., is_platform_admin: true }, anyGroup) === true`（FR-05c）
- `canSeeMenu({ ..., permissions: ["user:read"] }, usersGroup) === true`（FR-05a）
- `canSeeMenu({ ..., permissions: ["organization:read"] }, usersGroup) === false`（FR-05b）

**FR-06 visibleMenusBySection（≥ 4 个用例）**：

- `visibleMenusBySection(null, "admin").length === 0`
- `visibleMenusBySection({ ..., is_platform_admin: true }, "admin").length === 3` 且 `menuKey` 集合为 `{users, organizations, roles}`（FR-06c）
- `visibleMenusBySection({ ..., permissions: ["user:read"] }, "admin").length === 1` 且 `menuKey === "users"`（FR-06a）
- `visibleMenusBySection({ ..., permissions: ["workspace:read"] }, "system").length === 0`（FR-06b，无 platform:admin）

**deprecated 标记验证**：

- 用 `@typescript-eslint/utils` 或简单 grep 验证 `hasAdminPermission` 上方 JSDoc 含 `@deprecated`。
- 或读取源码字符串断言包含 `@deprecated`。

⚠️ 测试用例中的 mock user 必须满足 `SessionUser` 类型（至少 `id` / `email` / `displayName` 必填），用 fixture 工厂函数生成。

### 步骤 2：跑测试，确认失败

```bash
pnpm test permission
```

应失败（`hasAnyPermission` / `canSeeMenu` / `visibleMenusBySection` 不存在 / import 报错）。

### 步骤 3：实现 `permission.ts`

按本文档「实现要求」与「接口定义」落地：

1. import `MenuPermissionGroup` / `MenuSection` from `@/lib/menu-permissions`
2. 实现 `hasAnyPermission`
3. 实现 `canSeeMenu`（复用 `hasAnyPermission`）
4. 实现 `visibleMenusBySection`（复用 `canSeeMenu`）
5. 给 `hasAdminPermission` 加 `@deprecated` JSDoc（函数体不动）

### 步骤 4：重跑测试，确认通过

```bash
pnpm test permission
```

应全绿。

### 步骤 5：typecheck + lint

```bash
pnpm typecheck
pnpm lint
```

应通过，无 `any`，无新增 warning。

## 验收标准

| 验收项 | 通过标准 |
|---|---|
| 3 个 helper 存在 | `hasAnyPermission` / `canSeeMenu` / `visibleMenusBySection` 全部 `export`，且 import 自 `permission.ts` 不报错 |
| `hasAdminPermission` 标 deprecated | JSDoc 含 `@deprecated` 标记，函数体原样保留（git diff 只显示新增注释） |
| platform_admin 短路 | 3 个 helper 在 `is_platform_admin = true` 时直接返回 `true` / 全部菜单（FR-04c / FR-05c / FR-06c） |
| null 安全 | `user = null` 时 3 个 helper 不抛错，分别返回 `false` / `false` / `[]`（FR-04d） |
| 无 `any` | `pnpm typecheck` 通过，TS 严格类型 |
| 复用关系正确 | `canSeeMenu` 内部调用 `hasAnyPermission`；`visibleMenusBySection` 内部调用 `canSeeMenu`（DRY，不重复实现交集逻辑） |
| 测试覆盖 FR-04/05/06 | `permission.test.ts` 至少覆盖上文 TDD 步骤 1 列出的全部 GWT 用例 |
| 函数体纯净 | 3 个 helper 均为纯函数，无副作用，无 React/Hook 依赖 |
| import 路径风格 | 使用 `@/stores/session` / `@/lib/menu-permissions` 别名路径，与现有代码一致 |
