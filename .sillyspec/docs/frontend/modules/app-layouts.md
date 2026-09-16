---
schema_version: 1
doc_type: module-card
module_id: app-layouts
author: qinyi
created_at: 2026-08-18 01:45:00
---

# 桌面端布局骨架（app-layouts）

## 定位
App Router 桌面端布局骨架（5 个 layout.tsx，不含移动端 `frontend/app/m/layout.tsx`——那属于 app-mobile-pages）。`RootLayout` 是全站根（Provider 三层嵌套）；`DashboardLayout` 是业务区外壳（登录守卫 + 工作区守卫 + AppShell）；其余三个是域内子布局（admin 准入 / workspace 详情骨架 / workbench 动态渲染），各自解决一个具体问题。

## 契约摘要
- `RootLayout`（`frontend/app/layout.tsx`，server）：metadata title "SillyHub"；`<html lang="zh-CN" suppressHydrationWarning>` + inter 字体 body，嵌套 `AntdRegistry → AntdProviders → AppProviders`——antd SSR 样式抽取 / ConfigProvider（zhCN + theme）/ 数据层 Provider（react-query 等，`@/lib/providers`）分别在这两层就绪。
- `DashboardLayout`（`frontend/app/(dashboard)/layout.tsx`，client）三个 effect：
  - 登录守卫：hydrate 后无 accessToken → `replace("/login")`。
  - 会话保鲜：登录后 best-effort `fetchMe()` 刷新用户（失败静默，交给下一次 API 调用处理）。
  - 工作区守卫：先放行 `/workspaces/:id`（有 wsId），再比对 `WORKSPACE_WHITELIST` 前缀（`/workspaces /admin /settings /ppm /runtimes /account /agent-profiles /sessions`），都不中 → `replace("/workspaces")`。
  - 渲染层 `!hydrated || !accessToken → null`，通过则 `<AppShell>{children}`。
- `AdminLayout`（`frontend/admin/layout.tsx`，client）：管理员准入（denied → replace "/"），详见 app-admin-pages 卡。
- `WorkspaceDetailLayout`（`frontend/workspaces/[id]/layout.tsx`，client）：默认 `<main max-w-[1440px]>` + `WorkspaceBindingGuard` + `WorkspaceTabs` 包 children；`changes` / `components` 路径判 standalone 直接渲染（不加 Tabs/容器，宽表页独占，宽度由 dashboard layout 统一管理）。
- `WorkbenchLayout`（`frontend/ppm/workbench/layout.tsx`，server）：仅 `export const dynamic = "force-dynamic"`——"use client" 页不能导出 route segment config，借 server layout 强制壳 HTML 不缓存（默认 static 预渲染会打 s-maxage 一年缓存，rebuild 后浏览器仍拿旧 chunk 引用、新功能不显示）。

## 关键逻辑
```
DashboardLayout 守卫序: 登录(hydrated && !token → replace /login)
  → 工作区(wsId 正则 ^\/workspaces\/[^/]+ 先于白名单前缀,
    防 /workspaces/xxx 被白名单 /workspaces 前缀误吞成重定向循环)
WorkspaceDetailLayout: isStandalone(changes|components) ? <children/> : guard+tabs
```

## 注意事项
- 登录跳转已收敛到 DashboardLayout 自身；改 WORKSPACE_WHITELIST 时同步 `frontend/src/lib/auth/route-guard.ts` 的 `MOBILE_WORKSPACE_WHITELIST`（移动端镜像，R-10 防漂移锚点）。
- 新增平台级（不依赖工作区）路由必须加进白名单，否则登录后被弹回选择器（agent-profiles / sessions 都曾踩此坑）。
- RootLayout 改动影响全站；`AppProviders` 是数据层 Provider 挂载点，新全局 Provider 加在那层而非根布局。
- `suppressHydrationWarning` 容忍 html 属性 hydration 差异，勿移除。
- `dynamic = "force-dynamic"` 只能写在 server layout；给 client 页面加需沿用 workbench 本模式。

## quick-5621ff55 增量（全路由 force-dynamic 根治部署旧壳缓存，ql-20260916-012-b5b2）

- **根布局 `export const dynamic = "force-dynamic"`**：Next 默认把客户端页面 static 预渲染并打 `Cache-Control: s-maxage=31536000, stale-while-revalidate`（实测全站含 /login），重新部署后浏览器/共享缓存继续用旧 HTML 壳（引用旧 chunk）→ 新代码永不生效（用户实证 /sessions 部署后无变化、后端日志仍见旧版 /runs 扇出；ppm/workbench/layout.tsx 当年逐页修过同款）。根布局一次覆盖全部路由：壳 HTML 每次 SSR + `private, no-cache, no-store`；`/_next/static/*` 内容哈希 immutable 缓存不受影响。全站页面均为客户端运行时取数，无 SSG 诉求，SSR 空壳代价可忽略。

## 人工备注
<!-- MANUAL_NOTES_START -->
<!-- MANUAL_NOTES_END -->
