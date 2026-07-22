---
id: task-06
title: 新增 app/m/login/page.tsx 移动登录页，复用桌面 username auth，登录后回目标移动页
title_zh: 移动登录页
author: qinyi
created_at: 2026-07-22 23:47:21
priority: P0
depends_on: [task-01, task-05]
blocks: []
requirement_ids: [FR-03]
decision_ids: []
allowed_paths:
  - frontend/src/app/m/login/page.tsx
provides: [{contract: MobileLoginPage, fields: [MobileLoginPage]}]
expects_from: [{contract: MobileRewrite, needs: [rewriteToMobile]}, {contract: MobileLayout, needs: [MobileLayoutShell]}]
goal: >
  新增 app/m/login/page.tsx（client，导出 MobileLoginPage），移动 App 风格登录页。复用桌面 lib/auth login + useSession store
  （同一 token，登录态与桌面互通），登录成功后回到目标移动页（FR-03）。
implementation:
  - 'use client；复用 @/lib/auth 的 login + @/stores/session 的 useSession（不另建认证，FR-03/D-003）'
  - '表单字段同桌面 account+password+记住密码，复用同一 REMBER_KEY=sillyhub.login.remember 与平台 key sillyhub.login.platform'
  - '移动 App 风格：单列全屏、LogoMark 复用 /logo.png、触摸目标≥44×44px、正文≥14px；去掉桌面左右分栏'
  - '登录后回目标：redirect/next 参数优先，否则 ppm→/ppm/workbench、sillyhub→/workspaces（middleware 自动 rewrite 到 /m/）'
  - '错误：err instanceof ApiError ? err.message : 登录失败'
acceptance:
  - 未登录手机访问受保护 /m/* → 重定向 /m/login（地址栏仍 /login，task-01 rewrite）
  - username+password 登录成功，token 写同一 useSession store（与桌面互通）
  - 登录后回到目标移动页（redirect 优先，否则默认平台页）
  - 记住密码复用桌面同一 localStorage key，回填一致
  - 登录失败展示错误
  - 桌面 (auth)/login/page.tsx git diff 为空（零回归）
verify:
  - cd frontend && pnpm typecheck && pnpm lint
  - cd frontend && pnpm test
constraints:
  - 复用现有 auth（lib/auth login + useSession store + 同一 localStorage key），不另建认证（FR-03/D-003）
  - 桌面 (auth)/login/page.tsx 不改（FR-08 零回归）
  - 依赖 task-01 middleware（/login→/m/login rewrite）与 task-05 layout（/m/login 判公开页，本页不做守卫）
---

# task-06 · 移动登录页

依据 design §5.3/FR-03。复用桌面 auth，移动 App 风格单列登录表单，登录后回目标移动页。
