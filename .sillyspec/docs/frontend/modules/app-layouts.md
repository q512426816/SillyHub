---
schema_version: 1
doc_type: module-card
module_id: app-layouts
author: qinyi
created_at: 2026-06-10T16:55:00
---

# app-layouts

## 定位
Next.js App Router 布局组件，负责页面外壳和路由级别的通用逻辑。包含根布局和 Dashboard 布局两个层级。

## 契约摘要
- `app/layout.tsx` — 根布局：加载 globals.css、设置 metadata（title/description）、设置 `lang="zh-CN"`、`suppressHydrationWarning`
- `app/(dashboard)/layout.tsx` — Dashboard 布局：认证守卫（未登录重定向到 `/login`）、包裹 `AppShell` 侧边栏组件
- `app/(auth)/` 路由组不包含布局文件，直接使用根布局

## 关键逻辑
- Dashboard 布局等待 Zustand persist 水合（`hydrated === true`）后再做认证判断
- 未水合或无 accessToken 时返回 null（防止闪烁）
- 认证通过后渲染 `<AppShell>{children}</AppShell>`

## 注意事项
- 根布局是 Server Component（无 "use client"），Dashboard 布局是 Client Component
- 修改认证逻辑需要同时考虑 hydration 时序问题

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
