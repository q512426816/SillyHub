---
id: task-05
title: 新增 app/m/layout.tsx——渲染 MobileAppShell + 接 route-guard 守卫（处理 /m 前缀白名单）
title_zh: 移动路由 layout 外壳
author: qinyi
created_at: 2026-07-22 23:47:21
priority: P0
depends_on: [task-03, task-04]
blocks: []
requirement_ids: [FR-02, FR-08]
decision_ids: []
allowed_paths:
  - frontend/src/app/m/layout.tsx
provides: [{contract: MobileLayout, fields: [MobileLayoutShell]}]
expects_from: [{contract: RouteGuard, needs: [useMobileRouteGuard]}, {contract: MobileShell, needs: [MobileAppShell]}]
goal: >
  新增 app/m/layout.tsx（client，默认导出 MobileLayoutShell），作为 /m/* 移动路由段统一外壳：
  渲染 task-04 的 MobileAppShell + 接 task-03 的 useMobileRouteGuard 守卫。桌面 (dashboard)/layout.tsx 不动（FR-08 零回归）。
implementation:
  - 'use client；从 @/components/mobile/mobile-app-shell 导入 MobileAppShell；从 @/lib/auth/route-guard 导入 useMobileRouteGuard'
  - 'export default function MobileLayoutShell({children})：调 useMobileRouteGuard()，strip /m 前缀后按桌面同款 WORKSPACE_WHITELIST 判定：未登录→/m/login；非白名单且无 wsId→/m/workspaces'
  - 'useSession 取 hydrated/accessToken，未 hydrate 或无 token 时 return null（镜像桌面 layout:54-55 防 FOUC）'
  - '守卫通过 return <MobileAppShell>{children}</MobileAppShell>；/m/login 判为公开页避免登录页无限重定向'
acceptance:
  - 手机访问 /m/ppm/workbench 渲染 MobileAppShell（顶栏+内容+底部 5 Tab），当前 Tab 高亮
  - 未登录访问受保护 /m/* 重定向 /m/login（不空白、不卡死）
  - /m 白名单正确：/m/ppm、/m/workspaces、/m/login 放行；非白名单无 wsId → /m/workspaces
  - store 未 hydrate 时 return null，无首屏闪烁
  - 桌面 (dashboard)/layout.tsx、app-shell.tsx git diff 为空
verify:
  - cd frontend && pnpm typecheck && pnpm lint
  - cd frontend && pnpm test
constraints:
  - 桌面 (dashboard)/layout.tsx 与 app-shell.tsx 不改（FR-08 零回归）；移动端独立 route-guard + 注释锚点（R-10）
  - 复用 useSession store，不另建认证；/m/ 直接访问也能渲染（兜底无死链）
---

# task-05 · 移动路由 layout 外壳

依据 design §5.2/§9/R-10。/m/* 统一外壳：渲染 MobileAppShell + 接 route-guard 守卫（strip /m 前缀按桌面白名单语义判定）。
