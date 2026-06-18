---
author: WhaleFall
created_at: 2026-06-18T09:35:00
---

# task-08：AppShell 按 section + 权限渲染

## 修改文件

- [ ] 修改 `frontend/src/components/app-shell.tsx`

## 依据文档

- 设计文档 §5.5（AppShell 改造）：`F:\WorkNew\SillyHub\.sillyspec\changes\2026-06-18-menu-driven-permissions\design.md`
- 需求 FR-07（AppShell 按 section 渲染） / FR-12（旧 NAV 常量清理）：`F:\WorkNew\SillyHub\.sillyspec\changes\2026-06-18-menu-driven-permissions\requirements.md`
- 验收规则（grep 无匹配）：`F:\WorkNew\SillyHub\.sillyspec\changes\2026-06-18-menu-driven-permissions\plan.md`

## 现状摘要（必读已确认）

当前 `app-shell.tsx` 含：

- 自定义 `interface NavItem { href; icon; label; matchPattern?; absolute? }`
- 4 个常量：`OVERVIEW_NAV` / `MANAGEMENT_NAV` / `SYSTEM_NAV` / `ADMIN_NAV`（共 19 条 NavItem，与 `MENU_PERMISSION_GROUPS` 的 19 条一一对应）
- 纯函数 `resolveHref(item: NavItem)` / `isActive(item: NavItem)`
- 内部渲染函数 `renderNavLink(item: NavItem)` / `renderGroupTitle(title: string)`
- 现状分组渲染：Overview 直接渲染、Management 由 `renderGroupTitle` 包裹、系统管理由 `hasAdminPermission(user)` 守护、System 直接渲染
- 品牌区 / 用户头像区 / 退出按钮 / collapse 折叠按钮（与导航数据无关，必须保留）

新数据源字段映射关系（`MenuPermissionGroup` vs 旧 `NavItem`）：

| NavItem 字段 | MenuPermissionGroup 字段 | 说明 |
|---|---|---|
| `href` | `href` | 完全一致 |
| `icon` | `icon` | 完全一致 |
| `label` | `menuLabel` | 仅字段名变化 |
| `matchPattern?` | `matchPattern?` | 完全一致 |
| `absolute?` | `absolute?` | 完全一致 |
| — | `section` / `menuKey` / `permissions` | 新增字段，AppShell 不直接消费（由 `visibleMenusBySection` 在前置过滤阶段使用） |

## 实现要求

### 删除

- `const OVERVIEW_NAV: NavItem[] = [...]`（第 21-30 行整块）
- `const MANAGEMENT_NAV: NavItem[] = [...]`（第 32-39 行整块）
- `const SYSTEM_NAV: NavItem[] = [...]`（第 41-44 行整块）
- `const ADMIN_NAV: NavItem[] = [...]`（第 46-50 行整块）
- `interface NavItem { ... }`（第 13-19 行）—— 全部切换为 `MenuPermissionGroup`，无外部消费方
- 现状 Section 渲染块（第 204-228 行 `<nav>` 内部内容）—— 含 Overview inline 标题 + 4 段 `.map(renderNavLink)`
- `import { hasAdminPermission } from "@/lib/permission"`—— 新方案用 `visibleMenusBySection` 内部的短路逻辑替代，不再直接调用 `hasAdminPermission`

### 保留

- `resolveHref` 纯函数：参数类型从 `NavItem` 改为 `MenuPermissionGroup`，函数体不变（`absolute` / `href` 字段名一致）
- `isActive` 纯函数：参数类型同上，函数体不变
- `renderNavLink` 内部组件：参数类型与字段访问同步切换（详见「renderNavLink 改造」），className / icon 渲染 / 折叠文案 / 无 workspace 时禁用样式 全部保持现状
- `renderGroupTitle(title: string)`：签名与样式完全保留
- 用户头像 `displayName`、退出按钮 `onLogout`、品牌区（Multi-Agent Platform / SillySpec Native）
- collapse 折叠状态：`COLLAPSED_KEY`、`collapsed` state、`useEffect` 持久化、`toggleCollapsed`、侧栏宽度 / 主内容 margin 全部保留
- `useWorkspaceId` hook 保留
- `useSession` 调用与 `user` 变量保留

### 新增

- `import { visibleMenusBySection } from "@/lib/permission"`（task-02 产出）
- `import { MENU_PERMISSION_GROUPS, type MenuSection } from "@/lib/menu-permissions"`（task-01 产出）
  - 注意：`MENU_PERMISSION_GROUPS` 仅用于类型推导（如需），实际过滤由 `visibleMenusBySection` 完成；如果代码中未直接引用 list，可只 import `type MenuSection`
- `import { Fragment } from "react"`（追加到现有 react import 列表）
- `const SECTION_LABEL: Record<MenuSection, string> = { overview: "Overview", management: "Management", admin: "系统管理", system: "System" }`
  - 注：现状 Overview / Management / System 用英文标题，"系统管理" 用中文。本表保持完全一致以避免视觉回归
- `const SECTION_ORDER: MenuSection[] = ["overview", "management", "admin", "system"]`
  - 顺序依据 design.md §5.5 与 FR-07

### 渲染逻辑（替换 `<nav>` 内部第 205-227 行）

```tsx
<nav className="flex-1 overflow-y-auto px-3 pt-2 pb-4">
  {SECTION_ORDER.map((section) => {
    const menus = visibleMenusBySection(user, section);
    if (menus.length === 0) return null;  // section 内无可见菜单则连标题一起隐藏
    return (
      <Fragment key={section}>
        {renderGroupTitle(SECTION_LABEL[section])}
        {menus.map((menu) => renderNavLink(menu))}
      </Fragment>
    );
  })}
</nav>
```

说明：

- 不再使用 `hasAdminPermission(user)` 守护「系统管理」section，改由 `visibleMenusBySection(user, "admin")` 内部判断（platform_admin 短路或 user/organization/role 任一权限命中）
- 不再 inline 写 Overview 标题，统一走 `renderGroupTitle(SECTION_LABEL[section])`，保证视觉一致
- `Fragment` 而非 `<>`，因为需要 `key`

### renderNavLink 改造

签名从 `renderNavLink(item: NavItem)` 改为 `renderNavLink(menu: MenuPermissionGroup)`。函数体内字段访问替换：

| 原访问 | 新访问 |
|---|---|
| `item.href` | `menu.href` |
| `item.icon` | `menu.icon` |
| `item.label` | `menu.menuLabel` |
| `item.matchPattern` | `menu.matchPattern` |
| `item.absolute` | `menu.absolute` |

不再需要单独传 `permissionAny` 或在 `renderNavLink` 内部做权限判断——`visibleMenusBySection` 已在调用方完成过滤。

`isActive(menu)` / `resolveHref(menu)` 内部字段访问也同步切换（这两函数的字段名与 NavItem 完全一致，仅参数类型签名变）。

### 行为兼容（与 design.md §9 兼容策略对齐）

- `is_platform_admin = true`：`visibleMenusBySection` 内部短路，对每个 section 都返回该 section 全部 menu，最终用户看到全部 19 个菜单（与现状一致）
- 拥有部分 `user:*` 权限的普通用户：「系统管理」section 仅渲染 `canSeeMenu` 命中的菜单（如只有 `user:read` 仅渲染「用户」）
- 只有 `workspace:read` 的用户：Overview 全显 + Management 部分（git-identities/incidents 兜底命中 workspace:read）+ System 不渲染（无 platform:admin）+ Admin 不渲染
- 无任何匹配权限的 section：整个 section（含 `renderGroupTitle` 输出）不渲染——`menus.length === 0` 提前 `return null`

## 接口定义

```typescript
import type { MenuSection, MenuPermissionGroup } from "@/lib/menu-permissions";

const SECTION_LABEL: Record<MenuSection, string> = {
  overview: "Overview",
  management: "Management",
  admin: "系统管理",
  system: "System",
};

const SECTION_ORDER: MenuSection[] = ["overview", "management", "admin", "system"];

// 类型切换（无需 export，文件内私有）
function resolveHref(menu: MenuPermissionGroup): string;
function isActive(menu: MenuPermissionGroup): boolean;
function renderNavLink(menu: MenuPermissionGroup): JSX.Element;
function renderGroupTitle(title: string): JSX.Element;
```

## 边界处理

1. **`user === null`（未登录/dashboard fetchMe 未完成）**：`visibleMenusBySection(null, section)` 返回 `[]`，所有 section 跳过，侧栏只剩品牌区 + 用户区（显示「用户」）+ 折叠按钮。与现状 `hasAdminPermission(null) === false` 行为一致或更安全。
2. **`user.permissions === []`**：同上——非 platform_admin 且无任何权限，全部 section 跳过。
3. **某个 section 的全部 menu 都不可见**：`menus.length === 0` 提前 return null，`renderGroupTitle` 不被调用，section 标题与 menu 列表都不渲染（这是与现状的关键差异：现状 Overview/Management/System 的标题永远显示）。
4. **`menu.matchPattern` 为 `undefined`**：`isActive` 内部已有兜底——`absolute` 走 `pathname === item.href`，相对路径走 `pathname === full || pathname.startsWith(full + "/")`。无需额外处理。
5. **`menu.absolute === true`**：`resolveHref` 直接返回 `menu.href`，不加 workspace 前缀（与现状一致）。
6. **无 workspace 上下文（`workspaceId === null` 且菜单非 absolute）**：`hasWorkspace` 为 false，`renderNavLink` 渲染禁用态 span（保留现状行为）。
7. **`is_platform_admin === true` 但 `permissions === []`**：`visibleMenusBySection` 内部短路返回全部 menu，platform_admin 仍看到全部 19 个菜单。
8. **Section 渲染顺序与现状差异**：现状「系统管理」夹在 Management 与 System 之间；新顺序为 overview → management → admin → system，相对位置不变，视觉无回归。

## 非目标

- 不修改 dashboard layout 的 `fetchMe` 调用（ql-20260617-007 已实现 session 填充）
- 不修改用户头像 / 退出按钮 / 品牌区 DOM 结构与样式
- 不改 `collapsed` 状态管理与 localStorage 持久化逻辑
- 不写自动化测试（AppShell 是 UI 组件，依赖 task-10 手工验证 6 个用例矩阵；该组件无现有单测，本变更不补）
- 不实现菜单搜索 / 快捷键 / 拖拽排序等新功能
- 不动 `useWorkspaceId` hook 的正则与逻辑
- 不动 `onLogout` 的 fetch / clear / router.replace 流程
- 不删除 `hasAdminPermission` 函数本身（design.md §5.3 决定保留并标 `@deprecated`，由 task-02 处理）；仅删除 AppShell 中的 import 与调用

## TDD 步骤

1. **删除 4 个 NAV 常量 + NavItem 接口** → 运行 `pnpm typecheck`，预期 `resolveHref` / `isActive` / `renderNavLink` 的参数类型报错（`NavItem` 未定义）
2. **引入 `SECTION_LABEL` / `SECTION_ORDER` + `visibleMenusBySection`** → 把 3 个函数的参数类型从 `NavItem` 切到 `MenuPermissionGroup`，字段访问同步改名
3. **改造 `<nav>` 渲染块** → 用 `SECTION_ORDER.map` + `Fragment` 替换原 4 段渲染
4. **运行 `pnpm typecheck`** → 通过，无 `any`
5. **运行 `pnpm lint`** → 既有 warning 数不增加
6. **手工验证 task-10 的 6 个用例矩阵**：
   - 只有 `user:read` → 仅看到「用户」菜单（admin section 只渲染 1 条）
   - 只有 `organization:read` → 仅看到「组织」菜单
   - 只有 `role:read` → 仅看到「角色」菜单
   - 拥有任意 `task:*` 或 `tool:*` → 看到「Agent 控制台」（management section）
   - 无 admin 前缀权限的用户不显示「系统管理」section（admin section 整体隐藏）
   - `is_platform_admin = true` → 看到 19 个菜单全显
7. **视觉回归检查**：菜单图标、间距、active 高亮、折叠态、品牌区、用户区全部与改造前一致

## 验收标准

| 验收项 | 通过标准 |
|---|---|
| 4 个 NAV 常量删除 | `grep -rE "OVERVIEW_NAV\|MANAGEMENT_NAV\|SYSTEM_NAV\|ADMIN_NAV" frontend/src/` 无匹配 |
| NavItem 接口删除 | `grep -r "interface NavItem\|: NavItem\|<NavItem>" frontend/src/components/app-shell.tsx` 无匹配 |
| hasAdminPermission 引用清理 | `grep "hasAdminPermission" frontend/src/components/app-shell.tsx` 无匹配（函数本身在 permission.ts 中保留） |
| visibleMenusBySection 使用 | `app-shell.tsx` 中 `import { visibleMenusBySection }` 存在，`<nav>` 内调用一次 |
| SECTION_LABEL / SECTION_ORDER 定义 | 两个常量都存在，顺序为 `overview / management / admin / system` |
| section 全空时标题隐藏 | 某个 section 返回空数组时不渲染 `renderGroupTitle`（代码 `if (menus.length === 0) return null` 存在） |
| platform_admin 全显 | `is_platform_admin = true` 用户登录后看到全部 19 菜单（task-10 手工验证） |
| 视觉无回归 | icon / 布局 / collapse / active 高亮 / 品牌区 / 用户区与改造前一致（task-10 截图对比） |
| typecheck 通过 | `pnpm typecheck` 无错（无 `any`） |
| lint 通过 | `pnpm lint` 既有 warning 数不增加 |
| section 渲染顺序固定 | `<nav>` 内 section 顺序为 overview → management → admin → system，不随用户权限变化重排 |
| 19 条菜单全覆盖（platform_admin） | platform_admin 登录后侧栏菜单条目数 = `MENU_PERMISSION_GROUPS.length` = 19 |
| active 高亮行为不变 | 切换路由时 `isActive(menu)` 与改造前判断逻辑一致（matchPattern / absolute / workspace 相对路径） |
| 折叠态文案不丢 | collapse 时 menu 图标保留，hover title 显示 `menu.menuLabel` |

## 风险与回退

- **R-08-1（视觉差异）**：原 Overview inline 标题与 `renderGroupTitle` 样式可能存在微小差异。**应对**：改造后 Overview section 也走 `renderGroupTitle`，与 Management/System 视觉对齐；如发现差异，调整 `SECTION_LABEL` 文案而非样式。现状 Overview inline 标题使用 `px-2 pt-3 pb-1`，`renderGroupTitle` 使用 `px-2 pt-5 pb-1`——首个 section 顶部留白会增大 8px 左右，可接受；如要严格保持，可在 SECTION_ORDER 第一项渲染前不加 `pt-5`，但本任务不做此优化。
- **R-08-2（platform_admin 路径回归）**：若 task-02 的 `visibleMenusBySection` 对 platform_admin 短路实现有误，会导致管理员少看菜单。**应对**：task-04 单测覆盖；task-08 实现完成后必须手工用 platform_admin 账号登录验证，比对 19 个菜单是否全部出现。
- **R-08-3（无 workspace 上下文渲染异常）**：所有 overview/management menu 都是相对路径，无 workspace 时 `hasWorkspace=false`，全部进入禁用态。**应对**：保留 `renderNavLink` 中无 workspace 分支（`!hasWorkspace` 时返回 `<span>` 而非 `<Link>`），行为与现状一致。
- **R-08-4（task-01/02 未完成时的依赖）**：本任务依赖 task-01（menu-permissions.ts）与 task-02（permission.ts 新增 helper）。若二者未合并，本任务无法通过 typecheck。**应对**：严格按 Wave 顺序执行，task-08 必须在 task-01/02 之后；如必须前置预演，可在本地临时 stub `visibleMenusBySection` 函数，但 commit 前移除 stub。
- **R-08-5（Fragment key 警告）**：React 列表渲染需要稳定 key，本任务使用 `<Fragment key={section}>` 而非 `<>`，避免 key 警告。`menu.href` 已天然唯一，`renderNavLink` 内部 `<Link key={menu.href}>` 保留。
- **回退**：本任务改动可单独 revert——恢复 4 个 NAV 常量 + NavItem 接口 + hasAdminPermission 调用即可。`visibleMenusBySection` / `MENU_PERMISSION_GROUPS` 的存在不影响回退。回退步骤：(1) git revert task-08 commit；(2) 确认 task-01/02 的产出文件未被删除；(3) 重启 frontend 容器（task-10 流程）。

## 实现顺序清单

- [ ] Step 1：读完整 `app-shell.tsx`，确认现状 19 条 NavItem 与 design.md §5.2 的 19 条 MenuPermissionGroup 完全对齐
- [ ] Step 2：删除 `interface NavItem` 与 4 个 NAV 常量
- [ ] Step 3：删除 `import { hasAdminPermission }`
- [ ] Step 4：新增 import（`Fragment`、`visibleMenusBySection`、`MenuSection` / `MenuPermissionGroup` 类型）
- [ ] Step 5：新增 `SECTION_LABEL` 与 `SECTION_ORDER` 常量
- [ ] Step 6：改造 `resolveHref` / `isActive` 参数类型与字段访问
- [ ] Step 7：改造 `renderNavLink` 参数类型与字段访问（`menu.label` → `menu.menuLabel` 是关键差异）
- [ ] Step 8：替换 `<nav>` 内部 4 段渲染为 `SECTION_ORDER.map` + `Fragment`
- [ ] Step 9：运行 `pnpm typecheck`，修复任何类型错误
- [ ] Step 10：运行 `pnpm lint`，确认 warning 数不增加
- [ ] Step 11：grep 验收（`OVERVIEW_NAV|MANAGEMENT_NAV|SYSTEM_NAV|ADMIN_NAV`、`hasAdminPermission`、`NavItem` 在 app-shell.tsx 中均无匹配）
- [ ] Step 12：提交 task-08 commit，等待 task-10 手工验证
