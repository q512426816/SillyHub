---
schema_version: 1
doc_type: module-card
module_id: app-layouts
source_commit: ba87eec
author: qinyi
created_at: 2026-06-24T01:02:00
---
# app-layouts

## 定位
App Router 的两层布局骨架。`RootLayout` 是全站根布局（html/body + antd 全局 Provider + 元数据）；`DashboardLayout` 包裹所有 `(dashboard)` 路由组页面，负责 session hydrate 守卫与 `AppShell`（侧边栏+顶栏）骨架挂载。二者共同构成"鉴权后业务页"的外壳。

## 契约摘要
- `RootLayout`（`app/layout.tsx`）：导出 `metadata`；渲染 `<html lang="zh-CN" suppressHydrationWarning>` + `<body>`，body 内仅包一层 `<AntdProviders>{children}</AntdProviders>`。所有全局样式/主题/dayjs locale/Antd 静态方法都在 AntdProviders 内就绪。
- `DashboardLayout`（`app/(dashboard)/layout.tsx`）：签名 `({ children }: { children: ReactNode })`；从 `useSession()` 取 `hydrated` / `accessToken`；hydrate 完成且具备 token 才渲染 `<AppShell>{children}</AppShell>`，否则返回 null（避免未登录闪烁业务内容）。鉴权跳转由下游页面/AppShell 处理。

## 关键逻辑
- DashboardLayout 守卫（伪代码）：
  ```
  const { hydrated, accessToken } = useSession()
  if (!hydrated || !accessToken) return null
  return <AppShell>{children}</AppShell>
  ```
- RootLayout 极薄，所有运行时 Provider 下沉到 `AntdProviders`（ConfigProvider locale=zhCN + theme + AntApp 静态方法 + dayjs.locale）。

## 注意事项
- DashboardLayout 的 `return null` 只是"不渲染业务区"，不是登录跳转入口；实际未登录跳 `/login` 的逻辑在 AppShell / 各页面内。
- 根布局改动影响全站，AntdProviders 的 theme/token 调整会级联到所有 antd 组件，需回归。
- `suppressHydrationWarning` 用于容忍主题/dark mode 类名导致的 html 属性 hydration 差异，勿随意移除。

## 人工备注
<!-- MANUAL_NOTES_START -->
<!-- MANUAL_NOTES_END -->
