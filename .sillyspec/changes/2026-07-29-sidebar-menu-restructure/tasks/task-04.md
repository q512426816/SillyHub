---
id: task-04
title: app-shell.tsx 视觉统一（图标 + 分组间距 + 高亮）
title_zh: 侧边栏菜单图标与分组视觉统一
author: qinyi
created_at: 2026-07-30 09:06:13
priority: P1
depends_on: [task-02]
blocks: [task-07]
requirement_ids: [FR-06]
decision_ids: [D-005@v1]
allowed_paths:
  - frontend/src/components/app-shell.tsx
goal: >
  统一侧边栏菜单视觉：为 3 个新菜单项（我的供应商 /settings/providers、技能管理 /settings/skills、MCP 管理 /settings/mcp）在 MENU_ICON_MAP 补充 lucide 图标，菜单图标全面收敛为 lucide 线条图标消除 emoji 混用，并统一分组标题间距与选中高亮样式；同时保证 ppm 隔离与 navHidden 过滤逻辑不被误伤（design §5.3 Phase 3，D-005@v1，FR-06）。
implementation:
  - 读透 app-shell.tsx 现有 MENU_ICON_MAP 图标映射、renderGroupTitle 分组标题、renderNavLink 菜单项渲染与 ppm 隔离（pathname.startsWith）与 navHidden 过滤逻辑。
  - 在 MENU_ICON_MAP 增加 3 条映射：/settings/providers 用 KeyRound 或 Plug 类 lucide 图标，/settings/skills 用 Sparkles 类，/settings/mcp 用 Server 类，均从 lucide-react 导入。
  - 检查全部菜单项渲染出的图标均为 lucide 线条图标，无 emoji 残留；fallback 保持 Circle。
  - 统一 renderGroupTitle 的分组标题间距（上下 padding 一致）与 renderNavLink 的选中高亮（bg-blue-50 加左侧指示条样式保持一致）。
  - 不改动 ppm 隔离过滤、navHidden 过滤、resolveHref 与 isActive 行为逻辑。
acceptance:
  - 侧边栏 3 个新菜单项（我的供应商、技能管理、MCP 管理）均渲染对应 lucide 图标而非 Circle fallback。
  - 全部菜单图标均为 lucide 线条图标，侧边栏无 emoji 图标残留。
  - 分组标题间距与选中高亮样式在各分组间视觉一致。
  - ppm 路径下仍只渲染 ppm 组、非 ppm 路径下不渲染 ppm 组；navHidden 菜单项仍被过滤。
verify:
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm vitest run src/app/(dashboard)/layout.test.tsx
  - 人工核对：grep app-shell.tsx 无 emoji 字符残留于菜单图标渲染路径。
constraints:
  - 仅允许修改 frontend/src/components/app-shell.tsx，不触碰 menu-permissions.ts 菜单数据源（属 task-02）。
  - 本任务为纯视觉与图标调整，无对外契约变更；不改动路由、权限判断、ppm 隔离与 navHidden 逻辑。
  - 图标必须统一使用 lucide-react 导入，不引入新的图标库依赖。
  - 样式沿用现有 Tailwind 工具类与前端样式系统规范，不新增全局样式文件。
---
