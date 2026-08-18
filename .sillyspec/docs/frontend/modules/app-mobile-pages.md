---
schema_version: 1
doc_type: module-card
module_id: app-mobile-pages
author: qinyi
created_at: 2026-08-18 01:45:00
---

# 移动端页面（app-mobile-pages）

## 定位
移动端页面域：`src/app/m/` 路由组（1 layout + 8 page）+ `src/middleware.ts` UA 分流。移动手机访问桌面白名单路径时由 middleware 服务端 rewrite 到 `/m/` 前缀版本（URL 不变、零 FOUC）；`/m` 内部自成一体——独立登录页、独立外壳（components-mobile）、独立守卫（lib-auth-route-guard），认证与桌面共用同一 session store（`login()` 同一实现，登录态互通）。

## 契约摘要
- `middleware.ts`（src 根）：
  - `isMobileUserAgent(ua)` 纯函数（可单测）：UA 缺失/非字符串/空 → false（异常默认桌面）；平板先排除（iPad、不含 Mobile 的 Android，iPadOS 伪装 Macintosh 只按明文 iPad 字样排除）→ false；再匹配手机标识（iPhone / Android+Mobile / Windows Phone / BlackBerry+BB10）→ true。
  - 命中 → `NextResponse.rewrite('/m' + pathname + search)`；否则 `next()`。matcher 只命中白名单页（`/ppm/*`、`/workspaces/*`、`/login`），自然排除 `/api`、`/_next`、静态资源。
- `MobileLayoutShell`（`app/m/layout.tsx`，client）：
  - 调 `useMobileRouteGuard()` 跑登录守卫 + 工作区白名单守卫（副作用重定向：未登录 → /m/login；非白名单无 wsId → /m/workspaces）。
  - `useSession` hydrated/accessToken 决定渲染（防 FOUC，镜像桌面 dashboard layout 的 null 锚点）。
  - 守卫通过 → `<MobileAppShell activeTab>{children}</MobileAppShell>`；`/m/login` 判为公开页（strip /m 后比对 PUBLIC_PATHS），不裹 Shell、不要求 token。
- 页面（8 个）：
  - `MobileLoginPage`（/m/login）：复用桌面同源 `login()`（token/user 写入同一 store）+ 同一组 localStorage key（账号/平台）；自带全屏单列容器；`ConfirmCaptcha` + `Segmented` 平台切换；登录后回跳 redirect/next 优先（桌面路径形态，middleware 自动 rewrite 回 /m 版）。
  - `WorkspacesMobilePage`（/m/workspaces）：工作区选择器移动版。
  - `MobileAccountPage`（/m/account）：个人中心移动版。
  - `WorkbenchMobilePage`（/m/ppm/workbench）：PPM 工作台移动版。
  - `/m/ppm/` 下另有 project-plans / milestone-details / problem-list / task-plans 四个业务页（与桌面页各自独立实现）。

## 关键逻辑
```
middleware: tablet 先排除(D-005) → 手机正则命中 → rewrite('/m'+pathname+search)
            其余一律 next()（桌面/平板/异常 UA 均放行原路由）
m/layout:   activeTab = stripMobilePrefix(pathname) 后对 MOBILE_TABS
            做 isTabActive 前缀匹配（MOBILE_TABS 存桌面形态 /ppm/workbench，
            直接拿 /m/ppm/workbench 比较会全部落空；非 Tab 根页返回
            undefined 不强制高亮）
```

## 注意事项
- 与桌面 dashboard layout 的唯一语义差异：移动 /m/login 与受保护页共用本 layout，必须显式放行公开页，否则登录页空白 + 守卫无限重定向回 /m/login。
- `stripMobilePrefix` 在 `m/layout.tsx` 与 `route-guard.ts` 两处各一份定义（后者未导出），改动须两处同步（R-10 防漂移锚点）。
- `MOBILE_WORKSPACE_WHITELIST` 镜像桌面 `(dashboard)/layout.tsx` 的 WORKSPACE_WHITELIST（桌面路径形态），桌面加平台级路由须同步移动端守卫与 middleware matcher。
- 新增移动页注意两点：对应桌面路径不在 middleware matcher 白名单则手机访问不会被分流；页面是否需登录/工作区上下文取决于 route-guard 行为。
- 移动业务页与桌面页是双实现：改业务口径（列/校验/状态流转）须双向同步，勿只改一侧。

## 人工备注
<!-- MANUAL_NOTES_START -->
<!-- MANUAL_NOTES_END -->
