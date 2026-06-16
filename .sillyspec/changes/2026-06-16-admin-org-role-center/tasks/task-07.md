---
id: task-07
title: 前端鉴权 layout + 导航分组 + settings 剥离
priority: P0
estimated_hours: 2
depends_on: [task-06]
blocks: [task-09, task-10, task-11]
allowed_paths:
  - frontend/src/app/(dashboard)/admin/layout.tsx
  - frontend/src/components/app-shell.tsx
  - frontend/src/app/(dashboard)/settings/page.tsx
  - frontend/src/lib/settings.ts
author: WhaleFall
created_at: 2026-06-16T15:27:48
---

# task-07: 前端鉴权与导航骨架

## 修改文件

- `frontend/src/app/(dashboard)/admin/layout.tsx`（新增）：客户端鉴权组件，包住 `/admin/*` 三页面，无权限重定向 `/`
- `frontend/src/components/app-shell.tsx`（修改）：左侧导航新增「系统管理」分组，含用户/组织/角色三个 `NavLink`
- `frontend/src/app/(dashboard)/settings/page.tsx`（修改）：删除 `UsersTab` + `UserDetailDrawer` + 相关 import/state/类型/tab 渲染分支
- `frontend/src/lib/settings.ts`（修改）：删除 `listUsers` / `createUser` / `updateUser` / `deleteUser` / `listUserSessions` / `listUserAudit` / `revokeSession` / `revokeAllSessions` / `listUserWorkspaces` / `resetUserPassword` 等用户管理函数（迁至 task-08 的 `lib/admin.ts`）

## 实现要求

### admin/layout.tsx — 客户端鉴权

- `"use client"` 顶级指令
- 复用现有 `(dashboard)/layout.tsx` 模式（`useSession().hydrated` + `useEffect` + `router.replace`）
- 鉴权逻辑用本地 `hasAdminPermission(user)` 判断：`user.is_platform_admin === true` 或当前用户至少持有一项 ADMIN 组权限（user:* / organization:* / role:*）
- 权限数据来源：现有 `useSession().user` 仅含 `id` / `email` / `displayName`，**未带 `is_platform_admin` / `permissions`**。本任务需扩展 `SessionUser` 接口（在 `stores/session.ts` 中新增 `is_platform_admin?: boolean` 和 `permissions?: string[]` 两个字段，可选字段避免破坏旧数据），并在 `/api/auth/me` 返回时由登录链路填充（task-06 后端 schema 已含 `is_platform_admin`，前端 hydrate 逻辑不动；如未填充则保守认为无 admin 权限并重定向）
- 无权限时：`router.replace("/")` + toast「无系统管理权限」
- 渲染时仍走 `<AppShell>{children}</AppShell>` 包裹，与 DashboardLayout 视觉一致

伪代码：

```tsx
"use client";
import { useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/stores/session";
import { AppShell } from "@/components/app-shell";
import { toast } from "@/components/ui/toast";  // 或现有 toast 机制

function hasAdminPermission(user: SessionUser | null): boolean {
  if (!user) return false;
  if (user.is_platform_admin) return true;
  const perms = user.permissions ?? [];
  return perms.some((p) =>
    p.startsWith("user:") ||
    p.startsWith("organization:") ||
    p.startsWith("role:")
  );
}

export default function AdminLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { hydrated, user, accessToken } = useSession();

  useEffect(() => {
    if (!hydrated) return;
    if (!accessToken) {
      router.replace("/login");
      return;
    }
    if (!hasAdminPermission(user)) {
      toast.error("无系统管理权限");
      router.replace("/");
    }
  }, [hydrated, accessToken, user, router]);

  if (!hydrated) return null;
  if (!accessToken) return null;
  if (!hasAdminPermission(user)) return null;

  return <AppShell>{children}</AppShell>;
}
```

### app-shell.tsx — 新增「系统管理」分组

- 在现有 `SYSTEM_NAV` 之前或 `MANAGEMENT_NAV` 之后，新增 `ADMIN_NAV: NavItem[]` 常量
- 三项均使用 `absolute: true` + `matchPattern`，沿用现有 `renderNavLink` 渲染管线（无 workspaceId 时也保持可点击）
- 仅在当前会话有 admin 权限时渲染该分组（`hasAdminPermission` 复用，可提取到 `lib/permission.ts` 或同文件内辅助函数）。否则该分组整体不渲染，避免普通用户看到无权限入口

新增结构：

```tsx
const ADMIN_NAV: NavItem[] = [
  { href: "/admin/users", icon: "\u{1F465}", label: "用户", absolute: true, matchPattern: "/admin/users" },
  { href: "/admin/organizations", icon: "\u{1F3E2}", label: "组织", absolute: true, matchPattern: "/admin/organizations" },
  { href: "/admin/roles", icon: "\u{1F511}", label: "角色", absolute: true, matchPattern: "/admin/roles" },
];

// 渲染处：
{hasAdminPermission(user) && (
  <>
    {renderGroupTitle("系统管理")}
    {ADMIN_NAV.map(renderNavLink)}
  </>
)}
```

### settings/page.tsx — 剥离 UsersTab

- 删除 import：`createUser` / `listUsers` / `listUserAudit` / `listUserSessions` / `listUserWorkspaces` / `resetUserPassword` / `revokeAllSessions` / `revokeSession` / `AuditLogRead` / `RevokeAllResponse` / `UserRead` / `UserListResponse` / `UserSessionRead` / `UserWorkspaceRead`（保留 `listSettings` / `updateSettings`）
- 从 `Tab` 类型联合中移除 `"users"`，从 `TABS` 数组中删除对应项
- 删除 `UsersTab` 组件（约 133–398 行）和 `UserDetailDrawer` 组件（约 400–722 行）
- 删除 `DrawerTab` 类型 + `UserRead` / `UserSessionRead` 等仅被 UsersTab 使用的本地类型
- 移除主页面渲染中的 `{tab === "users" && <UsersTab />}` 分支
- 默认 tab 维持 `"workspace"`（已是默认值，无需调整）

### lib/settings.ts — 移除用户函数

- 删除第 35–179 行全部用户管理相关导出：`UserRead` / `UserListResponse` / `UserCreateRequest` / `UserUpdateRequest` / `UserListParams` / `listUsers` / `createUser` / `updateUser` / `deleteUser` / `UserSessionRead` / `UserWorkspaceRead` / `RevokeAllResponse` / `AuditLogRead` / `listUserSessions` / `listUserAudit` / `revokeSession` / `revokeAllSessions` / `listUserWorkspaces` / `resetUserPassword`
- 保留：`SettingRead` / `SettingsBulkRead` / `SettingsUpdateResponse` / `listSettings` / `updateSettings`（仅平台键值配置）
- 删除后该文件仅承载 settings 域，无残留 import

## 接口定义

### AdminLayout 组件

```ts
interface AdminLayoutProps {
  children: ReactNode;
}
// 行为：客户端鉴权 + AppShell 包裹
// 副作用：useEffect 内 router.replace("/") + toast.error
// 返回值：null（未 hydrate / 未登录 / 无权限）或 <AppShell>{children}</AppShell>
```

### hasAdminPermission 辅助函数

```ts
function hasAdminPermission(user: SessionUser | null): boolean;
// 输入：useSession().user（含可选 is_platform_admin + permissions）
// 输出：是否持任意 ADMIN 组权限或 is_platform_admin
// 副作用：无（纯函数，便于单测）
```

### SessionUser 扩展（stores/session.ts）

```ts
interface SessionUser {
  id: string;
  email: string;
  displayName: string;
  is_platform_admin?: boolean;   // 新增，可选（旧数据兼容）
  permissions?: string[];        // 新增，可选（旧数据兼容）
}
```

## 边界处理

1. **未 hydrate 时不重定向**：`if (!hydrated) return;` + `if (!hydrated) return null;`，避免 SSR / persist rehydrate 时闪烁或误判
2. **普通用户访问 `/admin/*`**：`hasAdminPermission` 返回 false → `router.replace("/")` + toast「无系统管理权限」→ 渲染 `null`，不泄漏任何管理 UI 文案
3. **持 USER_READ 但无 USER_WRITE 的管理员**：能进入 `/admin/users` 列表（layout 不卡），但具体页面的写按钮（创建/编辑/删除）由 task-11 在页面层根据 `permissions.includes("user:write")` 控制，本任务不实现
4. **`lib/settings.ts` 删除函数后历史 import 报错**：必须同步删除 `settings/page.tsx` 中所有对已删函数的 import 和调用（见上「剥离 UsersTab」清单），运行 `pnpm build` 检查无残留引用
5. **toast 提示文案**：统一使用「无系统管理权限」，与 requirements FR-14 一致；toast 选用项目现有机制（如 `sonner` 或自研 `components/ui/toast`）
6. **SessionUser 字段未填充的兼容**：后端 `/api/auth/me` 若未返回 `permissions`，前端 `user.permissions ?? []` 视为空数组，`hasAdminPermission` 仅凭 `is_platform_admin` 判断；若两者都缺则保守重定向。本任务**不**修改 `/api/auth/me` 调用链路（如需补充字段由 task-06 或后续 patch 处理）
7. **AppShell 渲染顺序**：「系统管理」分组位置固定在 Management 与 System 之间，collapsed 状态下复用 `renderGroupTitle` 折叠逻辑，不破坏视觉一致性
8. **NavLink 可见性**：非 admin 用户完全不渲染 ADMIN_NAV 分组（不仅是禁用态），避免提示存在但不可达的入口

## 非目标

- 不实现 `/admin/users` / `/admin/organizations` / `/admin/roles` 三个具体页面（task-09 / task-10 / task-11）
- 不实现 `lib/admin.ts` admin API 客户端（task-08）
- 不修改后端 `/api/auth/me` 返回 schema（若需补字段另起任务）
- 不重构 settings/page.tsx 的其他 tab（Workspace / Agent / Security / Integrations 保持现状）
- 不引入新的 toast 库，复用现有 UI 机制

## 参考

- `design.md` §6（前端文件清单：admin/layout.tsx / app-shell.tsx / settings/page.tsx / lib/settings.ts 四项）
- `requirements.md` FR-14（前端 /admin 路由鉴权）+ FR-15（前端 settings 剥离 + 左侧导航新增「系统管理」分组）
- 现有 `(dashboard)/layout.tsx` 鉴权模式（`hydrated` + `accessToken` 双重判断 + `router.replace`）
- 现有 `app-shell.tsx` NavLink 渲染管线（`NavItem` 接口 + `renderNavLink` + `renderGroupTitle`）
- 现有 `stores/session.ts` SessionUser 接口（仅 3 字段，本任务扩展为 5）

## TDD 步骤

1. **写单测**：在 `frontend/src/app/(dashboard)/admin/__tests__/layout.test.tsx` 写 `hasAdminPermission` 纯函数单测（覆盖：null / is_platform_admin=true / 含 user:read / 仅含 workspace:read / 空 permissions 数组）
2. **跑失败**：`pnpm test -- layout` 应全部失败（函数未实现 + 组件未存在）
3. **实现**：按上述伪代码创建 `admin/layout.tsx` + 扩展 `SessionUser` + 提取 `hasAdminPermission`（放 `lib/permission.ts` 便于复用与测试）
4. **跑通**：单测全绿 + `pnpm typecheck`
5. **手动验证**：本地起 `pnpm dev`，用普通用户登录访问 `/admin/users`，应自动重定向 `/` + 弹 toast；用平台管理员访问应进入页面骨架（页面内容 task-09+ 实现）
6. **剥离验证**：访问 `/settings`，确认 tab 列表不含「用户管理」，无残留 UsersTab 渲染
7. **构建验证**：`pnpm build` 通过，无 unused import / undefined symbol

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | 普通用户登录后访问 `/admin/users` | 自动重定向 `/` + toast「无系统管理权限」，URL 不停留在 `/admin/*` |
| AC-02 | 平台管理员（is_platform_admin=true）访问 `/admin/users` | 正常渲染（页面内容由 task-09 填充，layout 不卡） |
| AC-03 | 持 `user:read` 但无 `user:write` 的用户访问 `/admin/users` | layout 放行进入页面，页面写按钮 disabled（task-11 实现） |
| AC-04 | 普通用户登录后侧边栏 | 不显示「系统管理」分组，无 admin 入口提示 |
| AC-05 | 平台管理员登录后侧边栏 | 显示「系统管理」分组，含用户/组织/角色三个 NavLink，点击路由正确 |
| AC-06 | 访问 `/settings` | Tab 列表仅含 Workspace/Agent/Security/Integrations，无「用户管理」 |
| AC-07 | `pnpm build` | 0 错误 0 警告（无 unused import / undefined symbol / 类型缺失） |
| AC-08 | `pnpm test -- layout` | `hasAdminPermission` 单测全绿（≥5 用例） |
| AC-09 | `lib/settings.ts` 文件 | 仅含 SettingRead/SettingsBulkRead/SettingsUpdateResponse/listSettings/updateSettings，无用户函数残留 |
| AC-10 | 未 hydrate 状态下访问 `/admin/*` | 不发生重定向，渲染 null（无闪烁、无 hydration warning） |
