---
id: task-11
title: 工作区选择移动视图 app/m/workspaces 卡片列表+创建/绑定/别名；详情及之后提示电脑端
title_zh: 工作区选择移动视图
author: qinyi
created_at: 2026-07-22 23:47:21
priority: P0
depends_on: [task-07]
blocks: []
requirement_ids: [FR-07]
decision_ids: [D-003, D-006, D-008]
allowed_paths:
  - frontend/src/app/m/workspaces/page.tsx
provides: [{contract: WorkspacesMobilePage, fields: [WorkspacesMobilePage]}]
expects_from: [{contract: MobileComponents, needs: [MobileCardList, MobileDetailSheet]}]
goal: >
  新增 app/m/workspaces/page.tsx（FR-07）：工作区卡片列表 + 创建/绑定/编辑别名（D-008 全做）；选中工作区不进 /workspaces/[id] 详情，
  而是提示「请在电脑端打开」（D-006）。
implementation:
  - '数据复用：listWorkspaces/updateWorkspace(display_alias) @/lib/workspaces；fetchMyBindings @/lib/workspace-binding；listDaemonInstances/listDaemonRuntimes @/lib/daemon；listUsers @/lib/admin；useDaemonStatusMap @/lib/workspace-daemon-status；useSession/useNotify'
  - '承载：MobileCardList(卡片 别名/名称/slug/类型/daemon 徽标三态 online/offline/unbound；筛选 q/type/status/owner，PAGE_SIZE=12) + MobileDetailSheet(创建对齐 createWorkspace；别名调 updateWorkspace(id,{display_alias}))；未绑定 daemon 绑定复用现有 WorkspaceBindingDialog'
  - '点卡片：已绑定→提示「请在电脑端打开」不导航；未绑定→唤起绑定；禁 router.push(/workspaces/[id])'
acceptance:
  - 卡片列表可浏览，搜索/类型/状态/人员筛选与分页与桌面一致；daemon 徽标三态正确
  - 创建工作区、编辑别名、daemon 绑定三项移动端可用（D-008）
  - 点工作区不进详情，统一提示「请在电脑端打开」（D-006）
verify:
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm test
constraints:
  - 复用 lib/workspaces + workspace-binding + workspace-daemon-status 数据层，禁止自写请求（D-003）
  - 工作区详情及之后功能不渲染，提示「请在电脑端打开」（D-006）
  - 与桌面列表功能对齐、创建/绑定/别名全做（D-008）；桌面 (dashboard)/workspaces/** 不改（零回归）；触摸≥44×44px、正文≥14px
---

# task-11 · 工作区选择移动视图

依据 design §5.3/FR-07/D-006。工作区卡片列表 + 创建/绑定/别名全做；详情提示电脑端。
