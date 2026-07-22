---
id: task-01
title: 新增 frontend/src/middleware.ts——UA 检测 + NextResponse.rewrite 到 /m/
title_zh: 移动端设备分流中间件（UA rewrite，防 FOUC）
author: qinyi
created_at: 2026-07-22 23:47:21
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-01]
decision_ids: [D-002@v2, D-005]
allowed_paths:
  - frontend/src/middleware.ts
  - frontend/src/middleware.test.ts
provides:
  - contract: MobileRewrite
    fields: [rewriteToMobile, isMobileUserAgent]
expects_from: {}
goal: >
  新增 Next.js middleware（design §5.1 / D-002@v2），服务端按 UA 把移动请求 rewrite 到 /m/ 移动路由段，
  彻底消除首屏 FOUC 且地址栏 URL 不变；桌面 UA 与异常 UA 默认不 rewrite（走桌面，R-02）；
  matcher 精确限定 /ppm/*、/workspaces、/login，排除 /api、/_next、静态资源（R-07）。
implementation:
  - 新建 frontend/src/middleware.ts，导出纯函数 isMobileUserAgent(ua)：正则匹配 iPhone / Android(Mobile) / Windows Phone / BlackBerry，显式排除 iPad 与 Android Tablet（落实 D-005 平板走桌面）
  - 导出 rewriteToMobile(req)：移动 UA 返回 NextResponse.rewrite(new URL('/m' + pathname + search, req.url))；否则 NextResponse.next()
  - 默认导出 middleware(req) 包裹判定；config.matcher 用白名单精确匹配 /ppm/:path*、/workspaces/:path*、/login（自然排除 /api、/_next、静态资源）
  - UA 为空 / 异常 / 不可识别一律不 rewrite（默认桌面，R-02）；不读 cookie（layout 是 client component，D-002@v2）
  - 新建 middleware.test.ts：移动 UA rewrite 到 /m/、桌面 UA 不 rewrite、UA 异常默认桌面、平板不 rewrite、query 串保留、matcher 不拦 /api 与 /_next
acceptance:
  - 手机 UA 访问 /ppm/workbench、/ppm/task-plans、/ppm/problem-list、/workspaces、/login 被 rewrite 到 /m/ 原 path，地址栏 URL 不变（FR-01）
  - 桌面 UA 不 rewrite；UA 为空 / 异常不 rewrite（R-02）
  - 平板 UA（iPad / Android Tablet）不 rewrite（D-005）
  - /api、/_next、静态资源不被 middleware 拦截（R-07）
  - middleware 单测全绿；桌面路由 git diff 为空（零回归）
verify:
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm exec vitest run src/middleware.test.ts
  - cd frontend && pnpm test
constraints:
  - 桌面零回归：不改 app/(dashboard)/**、app-shell.tsx、(auth)/login、tokens.ts、lib/**
  - UA 检测用轻量正则（R-09），不引入重型 UA 库；异常默认桌面
  - matcher 精确限定目标页面，禁止全路由拦截（R-07 性能）
  - 不在 middleware 读 cookie / 不做客户端设备判断（D-002@v2 服务端定型）；/m/ 直接访问的兜底由 Wave2 app/m/layout 承接，非本任务
---

# task-01 · 移动端设备分流中间件

依据 design §5.1（D-002@v2）/ FR-01 / R-02 / R-07。matcher 命中目标页 → isMobileUserAgent 判定 → rewriteToMobile 改写到 /m/；异常 / 桌面放行。本任务只做 middleware + 单测，不写 /m/ 路由（由 Wave2 的 app/m/layout 承接）。
