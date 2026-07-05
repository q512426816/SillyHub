---
author: WhaleFall
created_at: 2026-06-18T09:35:00
---

# task-01：新增 menu-permissions.ts

> Wave 1 / 优先级 P0 / 无前置依赖
> 关联设计：`design.md` §5.1（数据结构）、§5.2（19 菜单权限映射表）
> 关联需求：`requirements.md` FR-01（数据源单一化）、FR-02（menuKey 唯一）、FR-03（权限 key 合法）

## 修改文件

- [ ] 新增 `frontend/src/lib/menu-permissions.ts`

## 上下文摘要（核对依据）

### 后端 Permission 枚举（36 个值，来自 `backend/app/modules/auth/permissions.py`）

```
platform:admin              platform:billing           platform:audit:read
workspace:read              workspace:write            workspace:admin          workspace:member:manage
change:create               change:read                change:update            change:approve           change:archive
task:read                   task:create                task:assign              task:run_agent           task:cancel              task:approve
code:read                   code:write                 code:review              code:merge
deploy:staging              deploy:production          deploy:rollback
tool:shell_exec             tool:network               tool:database            tool:secret:read
user:read                   user:write                 user:login:manage
organization:read           organization:write
role:read                   role:write
```

⚠️ 后端 **不含** `component:*` / `incident:*`，相关菜单用 `workspace:read` 兜底。

### 现有 NavItem 字段语义（来自 `app-shell.tsx`）

- `href`：路由路径，相对路径会拼成 `/workspaces/{id}/{href}`，绝对路径直接用
- `icon`：emoji 字符串，例如 `"\u{1F3E0}"`
- `matchPattern`：用于 active 高亮判断（`pathname.startsWith(matchPattern)` 或 `pathname.includes(matchPattern)`）
- `absolute`：true 时视为绝对路径，不拼 workspace 前缀

### 旧 PERMISSION_GROUPS 字段语义（来自 `admin.ts`）

- `PermissionWithGroup.key`：permission 标识，对齐后端枚举
- `PermissionWithGroup.name`：中文展示名
- `PermissionWithGroup.description?`：可选描述

## 实现要求

### 类型定义（按 §5.1）

- `MenuSection`：`"overview" | "management" | "admin" | "system"` 字面量联合类型
- `PermissionItem`：字段 `key: string` / `name: string` / `description?: string`
- `MenuPermissionGroup`：字段 `section` / `menuKey` / `menuLabel` / `icon` / `href` / `matchPattern?` / `absolute?` / `permissions: PermissionItem[]`
- 严禁使用 `any`

### MENU_PERMISSION_GROUPS（19 条，全部字段明示）

按 section 分组、section 内按下面顺序排列。每条至少包含 `section` / `menuKey` / `menuLabel` / `icon` / `href` / `permissions`；`matchPattern` / `absolute` 在沿用现有 `app-shell.tsx` NavItem 时给出。

#### section = "overview"（8 条）

1. **workspaces**
   - `menuKey: "workspaces"` / `menuLabel: "Workspace 首页"` / `icon: "\u{1F3E0}"` / `href: "/workspaces"` / `absolute: true`
   - `permissions`: `[{ key: "workspace:read", name: "Workspace 查看" }]`

2. **components**
   - `menuKey: "components"` / `menuLabel: "项目组组件"` / `icon: "\u{1F4E6}"` / `href: "components"` / `matchPattern: "/components"`
   - `permissions`: `[{ key: "workspace:read", name: "Workspace 查看" }]`
   - ⚠️ 兜底：后端无 `component:*`，用 `workspace:read`。RBAC 仍由 `/api/workspaces/{id}/components` 按 workspace 成员关系校验。

3. **topology**
   - `menuKey: "topology"` / `menuLabel: "拓扑图"` / `icon: "\u{1F5FA}"` / `href: "components/topology"` / `matchPattern: "/components/topology"`
   - `permissions`: `[{ key: "workspace:read", name: "Workspace 查看" }]`
   - ⚠️ 兜底：同 components，后端无 `component:*`，用 `workspace:read`。

4. **changes**
   - `menuKey: "changes"` / `menuLabel: "变更中心"` / `icon: "\u{1F504}"` / `href: "changes"` / `matchPattern: "/changes"`
   - `permissions`: `change:create` / `change:read` / `change:update` / `change:approve` / `change:archive` 全部 5 个（名称沿用 `admin.ts`：变更创建 / 变更查看 / 变更更新 / 变更审批 / 变更归档）

5. **scan-docs**
   - `menuKey: "scan-docs"` / `menuLabel: "扫描文档"` / `icon: "\u{1F4C4}"` / `href: "scan-docs"` / `matchPattern: "/scan-docs"`
   - `permissions`: `[{ key: "workspace:read", name: "Workspace 查看" }]`
   - ⚠️ 兜底：后端无专门 scan 权限，沿用 `workspace:read`。

6. **runtime**
   - `menuKey: "runtime"` / `menuLabel: "运行时"` / `icon: "\u{26A1}"` / `href: "runtime"` / `matchPattern: "/runtime"`
   - `permissions`: `[{ key: "workspace:read", name: "Workspace 查看" }, { key: "task:read", name: "任务查看" }]`
   - 备注：运行时面板展示任务列表，故加入 `task:read`。

7. **knowledge**
   - `menuKey: "knowledge"` / `menuLabel: "知识 & 日志"` / `icon: "\u{1F4DA}"` / `href: "knowledge"` / `matchPattern: "/knowledge"`
   - `permissions`: `[{ key: "workspace:read", name: "Workspace 查看" }]`
   - ⚠️ 兜底：后端无 `knowledge:*`，用 `workspace:read`。

8. **releases**
   - `menuKey: "releases"` / `menuLabel: "发布"` / `icon: "\u{1F680}"` / `href: "releases"` / `matchPattern: "/releases"`
   - `permissions`: `deploy:staging`（预发部署）/ `deploy:production`（生产部署）/ `deploy:rollback`（回滚）3 个

#### section = "management"（6 条）

9. **git-identities**
   - `menuKey: "git-identities"` / `menuLabel: "Git 身份管理"` / `icon: "\u{1F511}"` / `href: "/settings/git-identities"` / `absolute: true` / `matchPattern: "/settings/git-identities"`
   - `permissions`: `[{ key: "user:read", name: "用户查看" }, { key: "user:write", name: "用户编辑" }]`
   - 备注：与用户管理共享权限域（Git 身份归属用户）。

10. **api-keys**
    - `menuKey: "api-keys"` / `menuLabel: "API Keys"` / `icon: "\u{1F4A1}"` / `href: "/settings/api-keys"` / `absolute: true` / `matchPattern: "/settings/api-keys"`
    - `permissions`: `[{ key: "platform:admin", name: "平台超级管理员" }]`
    - 备注：后端 `_require_platform_admin` 强制。

11. **agent**
    - `menuKey: "agent"` / `menuLabel: "Agent 控制台"` / `icon: "\u{1F916}"` / `href: "agent"` / `matchPattern: "/agent"`
    - `permissions`: `task:read`（任务查看）/ `task:run_agent`（任务执行）/ `task:cancel`（任务取消）/ `tool:shell_exec`（Shell 工具）/ `tool:network`（网络工具）/ `tool:database`（数据库工具）/ `tool:secret:read`（密钥读取）共 7 个

12. **approvals**
    - `menuKey: "approvals"` / `menuLabel: "审批中心"` / `icon: "✅"` / `href: "approvals"` / `matchPattern: "/approvals"`
    - `permissions`: `[{ key: "task:approve", name: "任务审批" }, { key: "change:approve", name: "变更审批" }]`
    - 备注：跨 task/change 审批。

13. **audit**
    - `menuKey: "audit"` / `menuLabel: "审计中心"` / `icon: "\u{1F4DC}"` / `href: "audit"` / `matchPattern: "/audit"`
    - `permissions`: `[{ key: "platform:audit:read", name: "平台审计读取", description: "跨工作空间的平台级审计日志访问" }]`

14. **incidents**
    - `menuKey: "incidents"` / `menuLabel: "事件"` / `icon: "\u{1F6A8}"` / `href: "incidents"` / `matchPattern: "/incidents"`
    - `permissions`: `[{ key: "workspace:read", name: "Workspace 查看" }]`
    - ⚠️ 兜底：后端无 `incident:*`，用 `workspace:read`。

#### section = "admin"（3 条）

15. **users**
    - `menuKey: "users"` / `menuLabel: "用户"` / `icon: "\u{1F465}"` / `href: "/admin/users"` / `absolute: true` / `matchPattern: "/admin/users"`
    - `permissions`: `user:read`（用户查看）/ `user:write`（用户编辑）/ `user:login:manage`（登录权限管理）3 个

16. **organizations**
    - `menuKey: "organizations"` / `menuLabel: "组织"` / `icon: "\u{1F3E2}"` / `href: "/admin/organizations"` / `absolute: true` / `matchPattern: "/admin/organizations"`
    - `permissions`: `organization:read`（组织查看）/ `organization:write`（组织编辑）2 个

17. **roles**
    - `menuKey: "roles"` / `menuLabel: "角色"` / `icon: "\u{1F511}"` / `href: "/admin/roles"` / `absolute: true` / `matchPattern: "/admin/roles"`
    - `permissions`: `role:read`（角色查看）/ `role:write`（角色编辑）2 个

#### section = "system"（2 条）

18. **runtimes**
    - `menuKey: "runtimes"` / `menuLabel: "Daemon 运行时"` / `icon: "\u{1F5A5}"` / `href: "/runtimes"` / `absolute: true` / `matchPattern: "/runtimes"`
    - `permissions`: `[{ key: "platform:admin", name: "平台超级管理员" }]`
    - 备注：平台级 daemon 管理。

19. **settings**
    - `menuKey: "settings"` / `menuLabel: "设置"` / `icon: "⚙️"` / `href: "/settings"` / `absolute: true` / `matchPattern: "/settings"`
    - `permissions`: `[{ key: "platform:admin", name: "平台超级管理员" }, { key: "user:read", name: "用户查看" }]`
    - 备注：入口设置页，普通用户也可查看自己的设置。

### 兜底说明汇总（菜单级，必须保留注释）

在实现文件中对下列菜单的 `permissions` 上方加 `// 兜底：后端无 xxx:* 权限，使用 workspace:read` 注释：

- `components` / `topology`（无 `component:*`）
- `scan-docs`（无 `scan:*`）
- `knowledge`（无 `knowledge:*`）
- `incidents`（无 `incident:*`）

## 接口定义

```typescript
export type MenuSection = "overview" | "management" | "admin" | "system";

export interface PermissionItem {
  /** 权限标识，必须命中后端 Permission 枚举 */
  key: string;
  /** 中文展示名 */
  name: string;
  /** 可选描述 */
  description?: string;
}

export interface MenuPermissionGroup {
  /** 所属 section，决定渲染分组 */
  section: MenuSection;
  /** 唯一 key，关联 nav 渲染与 picker 折叠状态 */
  menuKey: string;
  /** 菜单中文展示名 */
  menuLabel: string;
  /** emoji 图标字符串 */
  icon: string;
  /** 路由路径，relative 时拼 workspace 前缀，absolute 时直接用 */
  href: string;
  /** active 高亮判断依据，沿用 NavItem.matchPattern 语义 */
  matchPattern?: string;
  /** 是否绝对路径（不拼 workspace 前缀） */
  absolute?: boolean;
  /** 该菜单可见所需的权限列表（任一命中即可见） */
  permissions: PermissionItem[];
}

export const MENU_PERMISSION_GROUPS: MenuPermissionGroup[] = [
  /* 19 条按上述顺序排列 */
];

/** section 固定渲染顺序，供 AppShell / Picker 使用 */
export const MENU_SECTION_ORDER: MenuSection[] = [
  "overview",
  "management",
  "admin",
  "system",
];

/** section 中文标题，供 AppShell 渲染分组标题使用 */
export const MENU_SECTION_LABEL: Record<MenuSection, string> = {
  overview: "Overview",
  management: "Management",
  admin: "系统管理",
  system: "System",
};
```

## 边界处理

1. **menuKey 唯一性**：19 个 menuKey 互不重复。测试遍历后用 `Set` 比较长度。本任务清单已在上面明示全部 19 个 key，不允许在实现时新增 / 重命名。
2. **兜底权限合理性**：后端无 `component:*` / `incident:*` / `scan:*` / `knowledge:*`，统一用 `workspace:read` 作为可见性兜底。理由：相关接口（`/api/workspaces/{id}/components` 等）已通过 workspace 成员关系校验，无细粒度 permission。如未来需要精细控制，另起变更扩后端枚举（不在本变更范围）。
3. **icon 字段类型**：统一用 `string`，emoji 以 `\u{XXXX}` Unicode 转义形式写入（与现有 `app-shell.tsx` 一致），避免 git/BOM 编码问题；纯符号（✅ / ⚙️）可直接写字符。
4. **空 permissions 数组**：禁止出现 `permissions: []`。每个菜单至少 1 个权限（FR-03 / 设计 §11）。本任务清单 19 条全部 ≥1 个 permission。
5. **section 枚举值边界**：`section` 只允许 4 个字面量。若未来新增 section，必须同时更新 `MENU_SECTION_ORDER` 与 `MENU_SECTION_LABEL`，否则 AppShell 渲染会缺标题。
6. **absolute 与 matchPattern 配合**：absolute 路径菜单（如 `/admin/users`）必须给出 `matchPattern` 以支持 active 高亮；relative 路径菜单（workspace 内）的 `matchPattern` 用于 `pathname.includes` 判断。所有现有 NavItem 字段必须 1:1 迁移，不得遗漏。
7. **href 与 href 不冲突**：`/settings/git-identities` 与 `/settings` 都以 `/settings` 为前缀，matchPattern 必须用完整前缀（`/settings/git-identities` vs `/settings`）避免误判 active。

## 非目标

本任务 **不做** 以下事情（留给后续 task）：

- ❌ 不改后端代码（`permissions.py` / `RoleSeed` / RBAC resolver 完全不动）
- ❌ 不改 `frontend/src/lib/admin.ts`（不删 `PERMISSION_GROUPS`，留给 task-05）
- ❌ 不改 `frontend/src/lib/permission.ts`（不写 `hasAnyPermission` / `canSeeMenu` / `visibleMenusBySection`，留给 task-02）
- ❌ 不改 `frontend/src/components/app-shell.tsx`（不删 4 个 NAV 常量，留给 task-08）
- ❌ 不改 `frontend/src/components/admin-role-permission-picker.tsx`（不切换数据源，留给 task-06）
- ❌ 不写任何运行时逻辑（helper / hook / 组件），本任务只产出**纯数据 + 类型定义**
- ❌ 不引入新依赖（`pnpm add` 禁止）

## TDD 步骤

### 步骤 1：先写测试（红）

新建 `frontend/src/lib/__tests__/menu-permissions.test.ts`，至少覆盖：

- `MENU_PERMISSION_GROUPS.length === 19`
- 所有 `menuKey` 唯一：`new Set(groups.map(g => g.menuKey)).size === 19`
- 每个 group 的 `permissions.length >= 1`
- 所有 `permissions[*].key` 全部命中下列后端枚举集合（36 个值硬编码到测试中做 allowlist）：
  ```
  platform:admin, platform:billing, platform:audit:read,
  workspace:read, workspace:write, workspace:admin, workspace:member:manage,
  change:create, change:read, change:update, change:approve, change:archive,
  task:read, task:create, task:assign, task:run_agent, task:cancel, task:approve,
  code:read, code:write, code:review, code:merge,
  deploy:staging, deploy:production, deploy:rollback,
  tool:shell_exec, tool:network, tool:database, tool:secret:read,
  user:read, user:write, user:login:manage,
  organization:read, organization:write,
  role:read, role:write
  ```
- section 分布断言：`overview === 8`、`management === 6`、`admin === 3`、`system === 2`
- `MENU_SECTION_ORDER` 长度 4 且与 `MENU_SECTION_LABEL` 的 key 完全一致

### 步骤 2：跑测试，确认失败

```bash
pnpm test menu-permissions
```

应失败（模块不存在 / import 报错）。

### 步骤 3：实现 `menu-permissions.ts`

按本文档「实现要求」与「接口定义」落地，类型与数据。

### 步骤 4：重跑测试，确认通过

```bash
pnpm test menu-permissions
```

应全绿。

### 步骤 5：typecheck

```bash
pnpm typecheck
```

应通过，无 `any`。

## 验收标准

| 验收项 | 通过标准 |
|---|---|
| 文件存在 | `frontend/src/lib/menu-permissions.ts` 创建成功 |
| 19 条数据 | `MENU_PERMISSION_GROUPS.length === 19`，section 分布为 overview 8 / management 6 / admin 3 / system 2（符合 design.md §5.2） |
| menuKey 唯一 | 19 个 menuKey 互不相同（FR-02） |
| 权限 key 合法 | 所有 `permission.key` 命中后端 Permission 枚举（FR-03），无拼写错误 |
| 兜底注释齐全 | `components` / `topology` / `scan-docs` / `knowledge` / `incidents` 5 个菜单在 permissions 上方有 `// 兜底：...` 注释 |
| 类型严格 | 无 `any`，`pnpm typecheck` 通过 |
| 字段完整 | 每条至少有 `section` / `menuKey` / `menuLabel` / `icon` / `href` / `permissions`；absolute 菜单给出 `matchPattern` |
| NavItem 字段无遗漏 | 与 `app-shell.tsx` 中的 4 个 NAV 常量字段一一对应（icon / href / matchPattern / absolute 全部迁移） |
