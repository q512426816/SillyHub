---
id: task-05
title: 修改 frontend/src/app/(dashboard)/layout.tsx — 加工作区守卫 useEffect（同 useSession 登录守卫层），无 wsId 且非白名单 → router.replace("/workspaces")
title_zh: dashboard 布局加工作区守卫
author: qinyi
created_at: 2026-07-09 23:10:00
priority: P0
depends_on: []
blocks: []
allowed_paths:
  - frontend/src/app/(dashboard)/layout.tsx
---

## 目标(goal)

在 dashboard layout 内新增一个"工作区守卫"`useEffect`，与现有 `useSession` 登录守卫**同层**（D-006 方案 A 客户端守卫）。当用户访问依赖工作区的路由（即无 wsId 且不在白名单前缀内）时，自动 `router.replace("/workspaces")` 跳到工作区选择器，强制先选工作区再开放功能菜单。

覆盖：FR-02（登录强制先选工作区）、D-001（统一强制守卫）、D-006（方案 A 客户端守卫）、CB-3（守卫实现顺序：先判 `/workspaces/:id` 再判白名单前缀）。

## 实现(implementation)

修改 `frontend/src/app/(dashboard)/layout.tsx`，在现有两个 `useEffect`（登录守卫第 15-18 行、`fetchMe` 第 20-33 行）之外**新增第三个 useEffect**（同层、独立依赖数组），引入 `usePathname`（来自 `next/navigation`，与现有 `useRouter` 同模块）。

守卫逻辑（**严格按 CB-3 顺序**）：

```ts
const pathname = usePathname();

useEffect(() => {
  if (!hydrated || !accessToken) return;          // 登录守卫未过则不判工作区
  // 1. 先判 /workspaces/:id —— 有 wsId 一律放行（CB-3 关键：避免被白名单 /workspaces 误吞）
  if (/^\/workspaces\/[^/]+/.test(pathname)) return;
  // 2. 再判白名单前缀（平台级后台路由 + 选择器页本身）
  const WHITELIST = ["/workspaces", "/admin", "/settings", "/ppm", "/runtimes"];
  if (WHITELIST.some((p) => pathname === p || pathname.startsWith(p + "/"))) return;
  // 3. 其余（依赖工作区但无 wsId）→ 重定向到选择器
  router.replace("/workspaces");
}, [hydrated, accessToken, pathname, router]);
```

要点：
- **白名单语义**：白名单项 `/workspaces` 会前缀匹配 `/workspaces/xxx`，所以**必须先判 `:id` 正则再判白名单**（CB-3），否则已选工作区的页面被守卫误重定向，循环跳回选择器。
- **白名单匹配规则**：`pathname === p || pathname.startsWith(p + "/")`（精确或带 `/` 前缀，避免 `/admins` 这类误命中 `/admin`）。
- **守卫前置条件**：`hydrated && accessToken` 未满足时直接 return（复用登录守卫已校验的态，不重复判登录）。
- 守卫与现有登录守卫互不干扰：登录守卫管 `/login`，工作区守卫管 `/workspaces`，各自独立 useEffect + 依赖数组。
- 不改 `AppShell` 渲染逻辑、不碰 `if (!hydrated) return null` / `if (!accessToken) return null` 这两个早返回（守卫在 useEffect 内跑，早返回不影响）。

接口签名以 `design.md` §5 P2 + §9（白名单 = 现有平台级路由）为准。

## provides

- `frontend/src/app/(dashboard)/layout.tsx` 内的工作区守卫 `useEffect`
- 守卫白名单常量：`["/workspaces", "/admin", "/settings", "/ppm", "/runtimes"]`
- 守卫行为：无 wsId 且非白名单前缀 → `router.replace("/workspaces")`

## expects_from

- `useSession`（`@/stores/session`，现有）：`hydrated`、`accessToken` 登录态（现有登录守卫已在用）
- `useRouter` / `usePathname`（`next/navigation`，现有/新增 import）：`router.replace`、`pathname` 当前路径

## 验收标准

- [ ] `frontend/src/app/(dashboard)/layout.tsx` 新增工作区守卫 `useEffect`，与现有登录守卫同文件同层
- [ ] 守卫仅在新增 useEffect 内跑，不动现有登录守卫与 `fetchMe` 逻辑
- [ ] CB-3 顺序正确：**先判** `/^\/workspaces\/[^/]+/`（有 wsId 放行）**再判** 白名单前缀
- [ ] 白名单 = `["/workspaces", "/admin", "/settings", "/ppm", "/runtimes"]`，匹配用 `=== p || startsWith(p + "/")`
- [ ] 守卫前置 `if (!hydrated || !accessToken) return`，不重复判登录
- [ ] 守卫单测覆盖：`/workspaces/A/changes` 放行、`/admin` 放行、`/workspaces` 放行、`/agents`（无 wsId）重定向到 `/workspaces`

## 验证(verify)

```bash
cd frontend
pnpm test -- app/\(dashboard\)/layout   # 守卫单测（mock useSession/usePathname/useRouter）
pnpm typecheck
pnpm test                                 # 全量回归（记忆：改 layout/router 必跑回归，R-06）
```

## 约束(constraints)

- **方案 A 客户端守卫**（D-006，用户已定）：用 `useEffect` + `router.replace`，不引入 Next.js middleware（token 在 localStorage，middleware 读不到，见 design §3 非目标）。
- **守卫与登录守卫同层**（D-006）：都在 dashboard layout 的 useEffect，不抽到独立组件/hook。
- **CB-3 实现顺序不可颠倒**：先 `:id` 后白名单，否则 `/workspaces/xxx` 被白名单 `/workspaces` 误匹配造成重定向循环。
- 守卫有轻微闪烁（页面先渲染再重定向）属 R-01 已接受风险，与现有登录守卫模式一致。
- 仅改 `frontend/src/app/(dashboard)/layout.tsx` 一个文件（allowed_paths）；`useWorkspaceContext` 写 store 由 task-04/task-10 负责，本任务只做守卫不碰 store。
