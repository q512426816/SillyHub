---
id: task-02
title: 修改 frontend/src/app/page.tsx — 登录态 redirect("/workspaces")、未登录 redirect("/login")，删双入口标题页
title_zh: 落地页改重定向到工作区选择器
author: qinyi
created_at: 2026-07-09 22:47:13
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-03]
decision_ids: [D-001@v1]
allowed_paths:
  - frontend/src/app/page.tsx
---

## 目标

把根路径 `/`（`app/page.tsx`）从"双入口标题页"（进入工作区 / 进入项目管理平台）改为自动分流：登录态跳工作区选择器 `/workspaces`，未登录跳 `/login`。落实 design §5 P2 + D-001（登录后直接进选择器，取代标题页）。

## 实现

- 现状：`app/page.tsx` 是纯 server component（无 `"use client"`、无 `useSession`），渲染标题页 + 两个 `<Link>`（`/workspaces`、`/ppm/project-plans`）+ `<HealthCard/>` + `<ServerStatusCard/>`。本次整体删除这些 UI。
- 改为 **client component**（因为登录态来自 `useSession` 的 `hydrated` + `accessToken`，token 在 localStorage，server 端读不到——design §3 已否决 middleware 方案）：
  - 顶部加 `"use client"`。
  - `import { useRouter } from "next/navigation"`、`import { useEffect } from "react"`、`import { useSession } from "@/stores/session"`。
  - 组件体内取 `const { hydrated, accessToken } = useSession()` + `const router = useRouter()`。
  - `useEffect`：若 `!hydrated` 直接 return（等 zustand persist 恢复，避免 SSR/首帧误判闪烁——对齐 R-01 一致化策略）；`hydrated` 后 `accessToken ? router.replace("/workspaces") : router.replace("/login")`。
  - 渲染期 `return null`（或极简 loading 占位），不再渲染标题页/双按钮/健康卡片。
- 用 `router.replace`（非 `redirect`）：`redirect` 是 server component 期抛错，client 组件里只能在渲染/事件中调用；用 `useEffect` + `router.replace` 与 dashboard layout 登录守卫同模式（design R-01 已点名此模式）。
- 删除不再使用的 import：`Link`、`HealthCard`、`ServerStatusCard`、`Button`。

## provides

- 改造后的 `app/page.tsx`：登录态分流到 `/workspaces`、未登录到 `/login`，标题页/双入口 UI 移除。

## expects_from

- `@/stores/session` 的 `useSession`（`hydrated` + `accessToken` 字段已存在，无需 task-01 产出）。
- `/workspaces`、`/login` 两个目标路由（现有，非本变更新增）。

## 验收标准

- 登录态访问 `/` → 跳转 `/workspaces`（选择器）。
- 未登录访问 `/` → 跳转 `/login`。
- persist 未恢复前不闪烁跳错（`hydrated` 守卫生效）。
- 标题页 / "进入工作区" / "进入项目管理平台" 双按钮 / HealthCard / ServerStatusCard 不再出现在 `/`。
- `pnpm typecheck`、`pnpm build` 通过（client component 改造无类型/构建错误）。

## 验证

- `cd frontend && pnpm test`（现有 page 相关测试若有，需同步更新断言：原断言标题/按钮文本的用例改为断言 redirect 行为或删除）
- `cd frontend && pnpm typecheck`
- `cd frontend && pnpm build`
- 手动：登录态 `http://127.0.0.1:3001/` 落 `/workspaces`；未登录落 `/login`（记忆 docker-localhost-ipv6-use-127.0.0.1 用 127.0.0.1 非 localhost）。

## 约束

- 只改 `frontend/src/app/page.tsx`（allowed_paths 限定），不动 layout / router / menu。
- 登录态判定只用 `useSession` 的 `hydrated` + `accessToken`，不引入新 store/新接口（D-006 方案 A 客户端守卫）。
- 不用 Next.js middleware（design §3 已否决：token 在 localStorage 读不到）。
- `hydrated` 未就绪前 `return null` 不跳转，避免首帧误判（R-01）。
- D-001 后台旁路入口（"平台管理/系统设置"）由 task-07 在选择器页提供，本 task 不保留标题页的 `/ppm/project-plans` 入口。
