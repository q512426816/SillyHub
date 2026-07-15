---
id: task-08
title: "top-bar.tsx 顶栏下拉加个人中心入口 + 路由白名单"
title_zh: 顶栏个人中心入口
author: WhaleFall
created_at: 2026-07-15 11:24:44
priority: P1
depends_on: [task-07]
blocks: []
requirement_ids: [FR-08]
allowed_paths:
  - frontend/src/components/top-bar.tsx
  - frontend/src/app/(dashboard)/layout.tsx
goal: >
  顶栏头像下拉菜单新增「个人中心」入口跳 /account，并确认 /account 在路由白名单。
implementation:
  - 在 frontend/src/components/top-bar.tsx 用户下拉菜单加「个人中心」项，链接 /account（先读确认下拉结构是否存在，不存在则补建）
  - 检查 (dashboard)/layout.tsx 路由守卫/白名单，按既有 /admin/users 模式把 /account 加入（如需要）
acceptance:
  - 顶栏下拉有「个人中心」入口（AC-09）
  - 点击跳 /account 且不被路由守卫拦截
verify:
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm lint
constraints:
  - 先读 top-bar.tsx 确认下拉结构；不存在则补建
  - 路由白名单按既有 /admin/users 模式
---

# task-08：顶栏个人中心入口

## 依据
- design.md §5.2（顶栏入口）、§9 AC-09
- 既有代码已确认：`frontend/src/components/top-bar.tsx` 右侧已有 shad/ui `DropdownMenu` 用户头像下拉（第 145-176 行），内含「个人设置」「切换平台」「退出登录」三项。下拉结构**已存在**，无需补建。
- 「个人设置」项（第 165 行）当前是裸 `DropdownMenuItem` 无 onClick/href，是挂「个人中心」入口的天然位置。

## 实现要点
1. 读 `top-bar.tsx` 确认下拉结构（已确认存在）。
2. 在用户下拉菜单「个人设置」位置改造或新增「个人中心」`DropdownMenuItem`：
   - 用 `router.push("/account")`（与既有「切换平台」项的 `onClick={() => router.push(switchHref)}` 模式一致，router 已在第 85 行取）。
   - 图标用 lucide `UserRound` / `CircleUser`（与既有 lucide 图标 import 风格一致，第 4 行 import 区）。
3. 检查 `(dashboard)/layout.tsx` 是否有路由守卫/白名单（参考 `layout.test.tsx` 对 `/admin/users` 的白名单断言），按既有模式把 `/account` 加入（如存在守卫）。

## 验收（AC-09）
- 顶栏头像下拉有「个人中心」入口
- 点击跳 `/account` 且不被路由守卫拦截

## 约束
- 下拉结构已存在，不补建（仅需加菜单项）
- 路由跳转用既有 `router.push` 模式，不引 next/link 混用
- 路由白名单按既有 `/admin/users` 模式
