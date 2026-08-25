---
id: task-05
title: 'floating session host component and layout mount'
title_zh: '悬浮宿主组件与全局布局挂载'
author: 'qinyi'
created_at: 2026-08-25 03:14:30
priority: P0
depends_on: [task-04]
blocks: []
requirement_ids: [FR-1, FR-2, FR-3, FR-4]
decision_ids: [D-001, D-003, D-004]
allowed_paths:
  - frontend/src/components/floating/floating-session-host.tsx
  - frontend/src/components/floating/floating-session-host.test.tsx
  - frontend/src/app/(dashboard)/layout.tsx
goal: >
  全局唯一悬浮宿主：球 + 抽屉（复用 SessionPanel mode=page）+ 最小化保活 +
  门户互斥 + 上下文条；挂载条件门控控制后台开销。
implementation:
  - 球（角标=有选中/最小化会话）；点击开/关抽屉；minimized 时点击恢复
  - 抽屉头部：标题/上下文条（感知页面名，null 降级文案）/最小化/关闭/去门户按钮
  - 左栏紧凑最近会话列表（listAgentSessions limit 10）+ 新会话（resolveDefaultMachineId 默认 Claude，未命中 PreSessionPicker 兜底）
  - 右栏 SessionPanel mode=page（sessionId key 重挂载 / preContext 预会话）
  - 挂载条件 open||minimized||sessionId 才渲染抽屉主体；最小化 CSS hidden 保挂载
  - 互斥：pathname 命中 /sessions、/workspaces/:id/sessions、/workspaces/:id/changes/:cid/sessions → 隐藏球 + 强制卸载抽屉主体
  - (dashboard)/layout.tsx AppShell 内挂载 <FloatingSessionHost/>
acceptance:
  - 渲染/互斥切换/最小化保活（hidden 不卸载断言）测试通过
  - 门户路由下球不渲染、抽屉主体卸载；离开恢复
  - tsc/eslint 0 error
verify:
  - cd frontend && pnpm exec vitest run src/components/floating
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - 不修改 session-panel.tsx / sessions-portal.tsx
  - 主题仅用 brand-*/语义 token（规则 20）
  - 壳层 store 之外不新增全局状态
---
# task-05 悬浮宿主

见 design §1/§3/§6。
