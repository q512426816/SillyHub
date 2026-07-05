---
author: WhaleFall
created_at: 2026-06-18T09:35:00
---

# task-04：permission helper 单元测试

> 任务类型：新增测试文件
> 依赖：task-02（`frontend/src/lib/permission.ts` 须导出 `hasAnyPermission` / `canSeeMenu` / `visibleMenusBySection`）+ task-01（`frontend/src/lib/menu-permissions.ts` 须导出 `MENU_PERMISSION_GROUPS` 及类型）
> 文档依据：requirements.md FR-04/05/06、design.md §5.3 + §5.7

## 修改文件

- [ ] 新增 `frontend/src/lib/__tests__/permission.test.ts`

## 实现要求

测试用 Vitest 编写，采用 GWT（Given/When/Then）风格组织 `describe` + `it`，至少覆盖以下用例。

### 1. `describe("hasAnyPermission")`

```ts
import { describe, it, expect } from "vitest";
import { hasAnyPermission } from "../permission";
import type { SessionUser } from "@/stores/session";

const mkUser = (overrides: Partial<SessionUser> = {}): SessionUser => ({
  id: "u-1",
  email: "u@example.com",
  displayName: "U",
  permissions: [],
  ...overrides,
});
```

- **Given** `user.permissions = ["user:read"]`
  **When** 调用 `hasAnyPermission(user, ["user:write", "user:login:manage"])`
  **Then** 返回 `false`（对应 FR-04 第 1 例）

- **Given** `user.permissions = ["user:read"]`
  **When** 调用 `hasAnyPermission(user, ["user:read", "organization:read"])`
  **Then** 返回 `true`（对应 FR-04 第 2 例）

- **Given** `user.is_platform_admin = true`
  **When** 调用 `hasAnyPermission(user, [])`
  **Then** 返回 `true`（短路，对应 FR-04 第 3 例）

- **Given** `user = null`
  **When** 调用 `hasAnyPermission(null, ["user:read"])`
  **Then** 返回 `false`（对应 FR-04 第 4 例）

- **Given** `user.permissions = undefined`
  **When** 调用 `hasAnyPermission(user, ["user:read"])`
  **Then** 返回 `false`（边界：缺省 permissions 字段）

### 2. `describe("canSeeMenu")`

```ts
import { canSeeMenu } from "../permission";
import { MENU_PERMISSION_GROUPS } from "../menu-permissions";
import type { MenuPermissionGroup } from "../menu-permissions";

const usersGroup: MenuPermissionGroup =
  MENU_PERMISSION_GROUPS.find((g) => g.menuKey === "users")!;
```

- **Given** `user.permissions = ["user:read"]`，`group = usersGroup`
  **When** 调用 `canSeeMenu(user, group)`
  **Then** 返回 `true`（对应 FR-05 第 1 例）

- **Given** `user.permissions = ["organization:read"]`，`group = usersGroup`
  **When** 调用 `canSeeMenu(user, group)`
  **Then** 返回 `false`（对应 FR-05 第 2 例）

- **Given** `user.is_platform_admin = true`，`group = usersGroup`（或任意 group）
  **When** 调用 `canSeeMenu(user, group)`
  **Then** 返回 `true`（短路，对应 FR-05 第 3 例）

- **Given** `user.permissions = []`，`group = usersGroup`（或任意 group）
  **When** 调用 `canSeeMenu(user, group)`
  **Then** 返回 `false`（边界：空权限 + 非管理员）

### 3. `describe("visibleMenusBySection")`

```ts
import { visibleMenusBySection } from "../permission";
import type { MenuSection } from "../menu-permissions";
```

- **Given** `user.permissions = ["user:read"]`
  **When** 调用 `visibleMenusBySection(user, "admin")`
  **Then** 返回长度 = 1 且 `result[0].menuKey === "users"`，不含 `organizations` / `roles`（对应 FR-06 第 1 例）

- **Given** `user.permissions = ["workspace:read"]`
  **When** 调用 `visibleMenusBySection(user, "system")`
  **Then** 返回空数组（无 `platform:admin`，对应 FR-06 第 2 例）

- **Given** `user.is_platform_admin = true`
  **When** 调用 `visibleMenusBySection(user, "admin")`
  **Then** 返回全部 3 条（`users` / `organizations` / `roles`，顺序与数据源一致）（对应 FR-06 第 3 例）

- **Given** `user.permissions = ["task:read"]`
  **When** 调用 `visibleMenusBySection(user, "management")`
  **Then** 返回结果至少包含 `agent`（`menuKey === "agent"`，对照 design.md §5.2 表）

- **Given** `user.permissions = ["change:read"]`
  **When** 调用 `visibleMenusBySection(user, "overview")`
  **Then** 返回结果至少包含 `changes`（`menuKey === "changes"`）

> 注：上述"至少包含"用 `.some(g => g.menuKey === "agent")` 断言，不锁死其它菜单（因为 task-01 数据可能扩展）。

## 接口定义

测试文件无对外接口。内部 import：

```ts
// 被测对象
import {
  hasAnyPermission,
  canSeeMenu,
  visibleMenusBySection,
} from "../permission";

// 测试夹具 / 类型
import {
  MENU_PERMISSION_GROUPS,
  type MenuPermissionGroup,
  type MenuSection,
} from "../menu-permissions";

// SessionUser 类型
import type { SessionUser } from "@/stores/session";
```

## 边界处理

至少覆盖以下 5 条边界场景：

1. **null user**：`hasAnyPermission(null, ...)`、`canSeeMenu(null, ...)`、`visibleMenusBySection(null, ...)` 均应返回 `false` / `[]`，不抛 TypeError。
2. **空 permissions 数组**：`user.permissions = []` 且非管理员时，三个 helper 对任何 group/section 均返回 `false` / `[]`。
3. **不存在的 section**：`visibleMenusBySection(user, "nonexistent" as MenuSection)` 返回 `[]`，不抛异常（task-01 保证类型，但运行时防御也覆盖一次）。
4. **空 group.permissions**：构造一个 mock group `{ section: "admin", menuKey: "x", permissions: [] }`，`canSeeMenu` 非管理员返回 `false`、管理员返回 `true`。
5. **is_platform_admin 与 permissions 同时为空**：`{ is_platform_admin: false, permissions: [] }` 时 `hasAnyPermission(user, ["user:read"])` 返回 `false`，验证短路逻辑只在 `is_platform_admin = true` 触发。

## 非目标

- 不测试 `hasAdminPermission` 的旧语义（已标 `@deprecated`，design.md §5.3 + R-05 已声明不维护）。
- 不测试 `MENU_PERMISSION_GROUPS` 数据本身（menuKey 唯一性、key 合法性由 task-03 负责）。
- 不测试 React 组件渲染（AppShell / Picker 的集成测试由 task-07 负责）。
- 不测试后端 RBAC（本变更纯前端）。
- 不锁定 `MENU_PERMISSION_GROUPS` 的全部条目（避免与 task-01 实现耦合，断言用 `.some` / `.map(g => g.menuKey)`）。

## TDD 步骤

1. **先写测试（红）**：在 task-02 完成前先 commit 本测试，运行 `pnpm test permission` 应报 import 失败或函数未定义。
2. **等 task-02 完成后跑（绿）**：`pnpm test permission` 应全部通过，exit code 0。
3. **故障注入验证**：临时修改 `hasAnyPermission`，删除 `is_platform_admin` 短路分支（即去掉 `if (user.is_platform_admin) return true;`），重跑测试，验证 `hasAnyPermission` 与 `canSeeMenu` 的相关用例失败（红）。
4. **恢复代码**：撤销故障注入，再次 `pnpm test permission` 应恢复全绿。

## 验收标准

| 验收项 | 通过标准 |
|---|---|
| 测试文件存在 | `frontend/src/lib/__tests__/permission.test.ts` |
| 用例数 ≥ 14 | 覆盖以上全部 GWT 用例（5 + 4 + 5 = 14，含边界） |
| 全部通过 | `pnpm test permission` exit code 0 |
| 覆盖率 ≥ 90% | `frontend/src/lib/permission.ts` 行覆盖率达 90%+（`pnpm test permission --coverage` 报告） |
| 无 any | 文件中无 `any` 类型（`grep -n ": any\|<any>" permission.test.ts` 无匹配） |
| FR 对齐 | FR-04 第 1-4 例、FR-05 第 1-3 例、FR-06 第 1-3 例逐字对齐 |
| 类型严格 | `pnpm typecheck` 通过，`SessionUser` / `MenuPermissionGroup` / `MenuSection` 全部显式 import |

## 注意事项

- **数据源稳定性**：本测试不直接 hardcode `MENU_PERMISSION_GROUPS` 的具体条目，仅通过 `menuKey` 字段索引查询（如 `.find(g => g.menuKey === "users")`），避免与 task-01 数据耦合。
- **管理员短路优先**：所有涉及 `is_platform_admin = true` 的用例，验证短路发生在权限交集判断之前（即 `perms = []` 也应返回 `true`）。
- **不可变夹具**：用 `mkUser()` 工厂函数构造 SessionUser，避免多个用例共享同一引用导致污染。
- **section 顺序不假设**：`visibleMenusBySection` 返回顺序由 `MENU_PERMISSION_GROUPS` 原始顺序决定，断言用 `map(g => g.menuKey)` 与 `toEqual([...])` 比较时需对照 task-01 的最终顺序；如担心顺序漂移，改用 `expect.arrayContaining` + 长度断言。
