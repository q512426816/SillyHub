---
id: task-10
title: 前端路由+菜单 3 处 + sessions/page.tsx 两栏两态组装 + 冒烟（覆盖 FR-01, FR-02）
title_zh: 会话总入口页面组装
author: WhaleFall
created_at: 2026-08-15 09:55:21
priority: P0
depends_on: [task-11, task-12, task-13, task-14, task-15]
blocks: []
requirement_ids: [FR-01, FR-02, FR-05]
decision_ids: [D-003@v1, D-007@v1]
allowed_paths:
  - frontend/src/app/(dashboard)/sessions/page.tsx
  - frontend/src/lib/menu-permissions.ts
  - frontend/src/components/app-shell.tsx
  - frontend/src/app/(dashboard)/layout.tsx
provides: {}
expects_from:
  task-11:
    - contract: SessionListPanel
      needs: [filters, virtualList, onSelect]
  task-12:
    - contract: NewSessionForm
      needs: [machineId, agentId, providerId, profileId, prompt]
  task-14:
    - contract: SessionConfigBar
      needs: [providerCtrl, profileCtrl]
  task-15:
    - contract: CtxUsageBar
      needs: [ctxRing, quotaPill]
goal: >
  新建 /sessions 页面（左 SessionListPanel 右两态面板）并接通侧边栏一级菜单，完成总入口组装与冒烟。
implementation:
  - menu-permissions.ts agent 区加智能体会话菜单项（登录可见）
  - app-shell.tsx MENU_ICON_MAP 加 /sessions 图标；layout.tsx WORKSPACE_WHITELIST 加 /sessions
  - page.tsx 两栏布局（左 320px 列表右面板），右侧新建态用 NewSessionForm、会话态用 TurnTimeline+SessionInputBar+SessionConfigBar+CtxUsageBar 组装
  - 会话选择/新建切换、离线只读横幅、已结束横幅加重新开启
  - 页面级冒烟（渲染关键路径+路由可达）
acceptance:
  - 侧边栏出现智能体会话菜单且路由不被工作区守卫重定向
  - 左列表右面板两态切换正常
  - 端到端冒烟：新建会话到对话到切换配置到结束
verify:
  - cd frontend && pnpm exec vitest run src/app/(dashboard)/sessions
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - /runtimes 弹窗与页面并存互不影响（D-002）
  - 页面骨架对齐 FRONTEND_PAGE_STYLE 与原型
related_tests: []
---
