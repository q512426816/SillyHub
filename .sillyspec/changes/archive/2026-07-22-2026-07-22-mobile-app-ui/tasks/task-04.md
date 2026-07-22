---
id: task-04
title: 新增 components/mobile 移动外壳 + 底部 TabBar + 顶栏 + 单测
title_zh: 移动外壳与底部 5 Tab 组件
author: qinyi
created_at: 2026-07-22 23:47:21
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-02]
decision_ids: [D-001, D-004]
allowed_paths:
  - frontend/src/components/mobile/mobile-app-shell.tsx
  - frontend/src/components/mobile/mobile-tab-bar.tsx
  - frontend/src/components/mobile/mobile-top-bar.tsx
  - frontend/src/components/mobile/mobile-tab-bar.test.tsx
provides:
  - contract: MobileShell
    fields: [MobileAppShell, MobileTabBar, MobileTopBar]
expects_from: {}
goal: >
  新建移动外壳三件套（design §5.2 / §5.4 / D-001 / D-004 / FR-02）：MobileAppShell = MobileTopBar + 内容区 + 固定底部 MobileTabBar；
  底部 5 Tab（工作台 / 计划任务 / 问题清单 / 我的 / 平台切换），当前页高亮，点击跳对应路径（手机访问由 task-01 middleware 自动 rewrite 到 /m/）。
  不复用 / 不改桌面 app-shell.tsx（D-001 独立 App UI，桌面零回归）。
implementation:
  - mobile-top-bar.tsx（"use client"）：移动顶栏，props 接 title 与可选 onBack（返回箭头）
  - mobile-tab-bar.tsx（"use client"）：底部固定 5 项——工作台→/ppm/workbench、计划任务→/ppm/task-plans、问题清单→/ppm/problem-list、我的→/account、平台切换→/workspaces；用 usePathname 前缀匹配高亮当前项
  - mobile-app-shell.tsx：组合 MobileTopBar + <main>{children}</main> + MobileTabBar；移动容器宽度，底部留 padding 避让 TabBar
  - 触摸热区 ≥44×44px、正文 ≥14px（requirements 非功能需求 / R-04）；样式走 Tailwind + tokens，不引桌面 AppShell 折叠 / localStorage
  - mobile-tab-bar.test.tsx：渲染 5 Tab、文案与目标路径正确、当前路径高亮、点击触发导航（vi.mock next/navigation）
acceptance:
  - MobileAppShell 渲染顶栏 + 内容 + 底部 5 Tab（FR-02）
  - 5 Tab 文案与目标路径正确；当前页对应 Tab 高亮
  - 平台切换 Tab → /workspaces（FR-02）
  - 最小触摸目标 44×44px、正文 ≥14px（R-04）
  - components/app-shell.tsx、top-bar.tsx、components/layout/** git diff 为空（桌面零回归）
verify:
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm exec vitest run src/components/mobile/mobile-tab-bar.test.tsx
  - cd frontend && pnpm test
constraints:
  - 桌面零回归：不动 components/app-shell.tsx、top-bar.tsx、components/layout/**（D-001 独立移动 UI）
  - 仅移动端组件，不引入桌面折叠 / 侧边栏 / localStorage 逻辑
  - TabBar 链接用原始路径（/ppm/*、/workspaces、/account），由 task-01 middleware 负责 rewrite 到 /m/
  - 不消费 task-01/02/03 产物（本任务独立）；shell 内不嵌守卫（守卫在 app/m/layout，属另一任务）
---

# task-04 · 移动外壳 + 底部 5 Tab

依据 design §5.2 / §5.4、D-001 / D-004、FR-02。MobileAppShell 三段式（顶栏 + 内容 + 底栏），TabBar 用原始路径（middleware 自动 rewrite 到 /m/）；由 Wave2 app/m/layout.tsx 渲染（本任务只提供组件，不挂路由）。
