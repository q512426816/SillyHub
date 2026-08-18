---
schema_version: 1
doc_type: module-card
module_id: lib-auth-route-guard
author: qinyi
created_at: 2026-08-18 01:45:00
---

# 移动端路由守卫（lib-auth-route-guard）

## 定位
移动端路由白名单守卫（`frontend/src/lib/auth/route-guard.ts`，102 行）。策略 A（移动独立守卫、桌面零改动）：把桌面 `app/(dashboard)/layout.tsx` 的「登录守卫 + 工作区白名单守卫」在 `/m` 前缀下重实现为可复用 hook，供 `app/m/layout.tsx` 顶层调用一次。只负责重定向副作用；未 hydrated / 未登录时渲染 null 由调用方 layout 决定。

## 契约摘要
- `useMobileRouteGuard(): void` — 两个镜像桌面 layout 的守卫 effect。
- `MOBILE_WORKSPACE_WHITELIST` — `["/workspaces", "/admin", "/settings", "/ppm", "/runtimes", "/account"]`，保持**桌面路径形态**（不含 /m 前缀），判定时先 strip `/m` 再比较，因此 `/m/ppm/x` 与 `/ppm/x` 行为一致。
- `PUBLIC_PATHS = ["/login"]` — strip 后比较；`/m/login` 是唯一公开页，不要求 auth、不判工作区。
- 配套测试：`route-guard.test.ts`（同目录）。

## 关键逻辑
```
stripped = stripMobilePrefix(pathname)   # /m→/、/m/x→/x
登录守卫: !hydrated 等; !accessToken 且非公开页 → replace /m/login?redirect={stripped}
工作区守卫(CB-3 顺序, 登录守卫已过才判):
  1. /^\/workspaces\/[^/]+/ 命中 → 放行（有 wsId 一律过）
  2. 白名单前缀命中(p===w || p.startsWith(w+"/")) → 放行
  3. 其余 → replace /m/workspaces（移动选择器）
```

## 注意事项
- R-10 防漂移锚点（文件头注释显式声明）：白名单镜像 `(dashboard)/layout.tsx:14`，登录守卫镜像 `:21-24`，工作区守卫 CB-3 顺序镜像 `:44-52`——**改桌面守卫必须同步本文件与测试**，否则两端行为分叉。
- CB-3 顺序不可倒：先判 `/workspaces/:id` 放行再判白名单前缀，否则 `/workspaces/xxx` 被前缀 `/workspaces` 误匹配造成重定向循环。
- 与桌面的语义差异仅两点：重定向目标带 `/m` 前缀（`/m/login`、`/m/workspaces`）；`/m/login` 显式公开（移动登录页与受保护页共用同一 layout，不放行会无限重定向；桌面 `/login` 在 (auth) 路由组根本不进 dashboard layout，故无需此条）。
- 白名单前缀匹配用 `=== w || startsWith(w + "/")`，避免 `/admins` 误命中 `/admin`。

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
