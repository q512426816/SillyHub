---
id: task-05
title: 全局智能体档案页 + 侧边栏菜单 + ws 内页重构 + 入口
author: qinyi
created_at: 2026-08-04 13:11:27
priority: P0
depends_on: [task-03, task-04]
blocks: []
expects_from:
  - task-03 交付 AgentProfileCardGrid 卡片墙（搜索/筛选/网格）
  - task-04 交付 AgentProfileForm 重做表单（双栏预览 + 工作区上下文 selector）
requirement_ids: [FR-01, FR-10]
decision_ids: [D-001@v1, D-007@v1]
allowed_paths:
  - frontend/src/app/(dashboard)/agent-profiles/page.tsx
  - frontend/src/app/(dashboard)/workspaces/[id]/agent-profiles/page.tsx
  - frontend/src/lib/menu-permissions.ts
  - frontend/src/lib/__tests__/menu-permissions.test.ts
  - frontend/src/components/app-shell.tsx
  - frontend/src/app/(dashboard)/workspaces/[id]/page.tsx
related_tests:
  - frontend/src/lib/__tests__/menu-permissions.test.ts
goal: >
  新建 /agent-profiles 全局卡片墙页并挂侧边栏一级菜单（经 menu-permissions 数据源 + app-shell 图标），ws 内页重构复用卡片墙，同步修既有 menu-permissions 测试硬编码计数，覆盖 FR-01 独立入口与 FR-10 全局聚合视图。
implementation:
  - 新建 agent-profiles/page.tsx，用 AgentProfileCardGrid（不传 workspaceId 走 mine 聚合）+ AgentProfileForm 新建（全局页经工作区上下文 selector 提供 workspaceId）
  - 重构 workspaces/[id]/agent-profiles/page.tsx，废弃现 9 列 DataTable（useWorkspaceAgentProfiles + TableProps + Tag 列）改用 AgentProfileCardGrid 传 workspaceId 与 scopedToWorkspace 复用卡片墙；同文件 page.tsx 第 361 行 ws 详情页快捷入口保留不动
  - menu-permissions.ts 的 MENU_PERMISSION_GROUPS agent section 在 mcp 后追加 agent-profiles 条目，字段按 design §6 规格填 section 为 agent / menuKey 为 agent-profiles / menuLabel 为智能体档案 / href 为 /agent-profiles / absolute 为 true / matchPattern 为 /agent-profiles / permissions 为空数组（经 permission.ts:41 登录可见，对齐 skills D-003）
  - app-shell.tsx 顶部 lucide-react import 补 Bot，MENU_ICON_MAP 加键 /agent-profiles 映射 Bot 图标
  - 同步修 menu-permissions.test.ts 计数，L159 toHaveLength 与标题 37 改 38、L105 注释 37 改 38、EXPECTED_MENU_KEYS 加 agent-profiles、L174 与 L187 section 分布 agent 由 4 改 5；并给 L194「每 menu 至少 1 permission」用例补 agent-profiles 例外（permissions 空数组否则断言失败，现仅放行 skills）
acceptance:
  - 侧边栏智能体分组出现智能体档案一级菜单，点击直达 /agent-profiles
  - ws 内页复用 AgentProfileCardGrid 渲染 workspace 预筛档案，原表格移除
  - menu-permissions.test.ts 全部用例通过（计数/分布/例外同步后）且 permission.ts:41 空 perms 登录可见语义保持
verify:
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm test menu-permissions
constraints:
  - 菜单 permissions 空数组对所有登录用户可见，不动鉴权链与后端 Permission 枚举，不破坏 ws 详情页快捷入口与 useWorkspaceAgentProfiles 原 CRUD 契约；UI 中文遵循 FRONTEND_PAGE_STYLE token
---
