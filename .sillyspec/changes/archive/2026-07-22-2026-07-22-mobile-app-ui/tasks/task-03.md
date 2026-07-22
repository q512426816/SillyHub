---
id: task-03
title: 新增 frontend/src/lib/auth/route-guard.ts 移动端守卫
title_zh: 移动端路由守卫（镜像桌面，不改桌面 layout）
author: qinyi
created_at: 2026-07-22 23:47:21
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-08]
decision_ids: [R-10]
allowed_paths:
  - frontend/src/lib/auth/route-guard.ts
  - frontend/src/lib/auth/route-guard.test.ts
provides:
  - contract: RouteGuard
    fields: [useMobileRouteGuard, MOBILE_WORKSPACE_WHITELIST]
expects_from: {}
goal: >
  新建 lib/auth/route-guard.ts（design §5.2 / §9 / R-10），实现移动端登录守卫 + 工作区白名单守卫，
  语义镜像 (dashboard)/layout.tsx 现有 useSession / WORKSPACE_WHITELIST 逻辑但按 /m 前缀适配；
  (dashboard)/layout.tsx 一字不改（桌面零回归）；单测镜像桌面守卫行为 + 注释锚点防漂移。
implementation:
  - 导出 MOBILE_WORKSPACE_WHITELIST：桌面 WORKSPACE_WHITELIST（/workspaces,/admin,/settings,/ppm,/runtimes,/account，见 (dashboard)/layout.tsx:14）的 /m 前缀版
  - 导出 useMobileRouteGuard() hook（"use client"）：复用 useSession 的 hydrated / accessToken；!hydrated 等；!accessToken → router.replace('/m/login')
  - 工作区守卫镜像桌面 CB-3 顺序（(dashboard)/layout.tsx:44-52）：先判 /m/workspaces/:id 放行，再判 MOBILE_WORKSPACE_WHITELIST 前缀（精确或带 /），否则 replace('/m/workspaces')
  - 文件头注释锚点：「语义镜像 app/(dashboard)/layout.tsx:14,21-52；改桌面守卫须同步本文件 + 单测」（R-10 防漂移）
  - 新建 route-guard.test.ts：未登录 → /m/login、白名单放行、/m/workspaces/:id 放行、依赖工作区页 → /m/workspaces，用例与桌面守卫一一对应
acceptance:
  - 未登录访问受保护 /m 页 → 重定向 /m/login（不回桌面 /login）
  - 白名单 /m 路径放行；/m/workspaces/:id 放行；依赖工作区路径 → /m/workspaces
  - (dashboard)/layout.tsx git diff 为空（桌面零回归，R-10 核心约束）
  - 单测全绿，用例与桌面守卫一一对应
verify:
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm exec vitest run src/lib/auth/route-guard.test.ts
  - cd frontend && pnpm test
constraints:
  - 不改 app/(dashboard)/layout.tsx、app-shell.tsx（桌面零回归，R-10 核心约束）
  - 守卫是客户端 hook（/m/layout 为 client component，与桌面同形态），不做服务端 cookie 判定
  - 注释锚点必须指向 (dashboard)/layout.tsx 具体行号，防双向漂移
  - 本任务只提供守卫，不挂到 app/m/layout（接线属另一任务）
---

# task-03 · 移动端路由守卫

依据 design §5.2 / §9 / R-10、FR-08、(dashboard)/layout.tsx:14,21-52。策略 A（移动独立守卫，桌面不改）：把桌面 useSession 登录守卫 + 工作区白名单守卫在 /m 前缀下重实现，供 Wave2 app/m/layout.tsx 调用 useMobileRouteGuard()。
