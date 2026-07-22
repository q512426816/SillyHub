---
author: qinyi
created_at: 2026-07-22 22:35:31
---
# 提案书（Proposal）

## 动机

现有前端（`frontend/`，Next.js 14 + antd v6 + Tailwind）按**桌面后台**设计，手机端**完全不可用**。用户需要在手机上使用 PPM（个人工作台、计划任务、问题清单）与 SillyHub 工作区选择页。本提案为手机端提供独立的 App UI，与桌面 web UI 并存，靠设备类型自动分流。

## 关键问题（现有方案为何不够）

1. **AppShell 无移动分支**：`app-shell.tsx` 固定侧边栏 `w-[260px]` + 主内容 `ml-[260px]`，手机上侧边栏盖住内容、内容被 260px 左边距吃掉，任何页面在手机都无法正常显示。
2. **整套 UI 桌面假设、无响应式基础**：无断点 token、无移动导航、业务代码零 `useMediaQuery`；搜索区固定 `grid-cols-4`、表格横向滚动、Modal 固定 `width=520`，全是桌面布局。
3. **原样式系统明确排除移动端**：`2026-06-21-frontend-style-system/design.md` §3 把「响应式移动端适配」列为非目标——本次是对该决策的方向性反转。

## 变更范围

- 新增 Next.js `middleware.ts`：按 UA 自动 rewrite 移动设备到 `/m/` 移动路由段（用户 URL 不变，服务端定型无 FOUC）。
- 新增独立移动路由段 `app/m/`：layout（移动外壳 + 登录守卫）+ 登录页 + PPM 三页 + workspaces 移动视图。
- 新增移动组件库 `components/mobile/`：MobileAppShell / TabBar（底部 5 Tab）/ TopBar / MobileCardList（全功能替代表格）/ FilterDrawer / DetailSheet / ActionMenu / BatchBar / ExportButton。
- 移动功能与**桌面对齐**（新建/编辑/导出/批量删除/执行/详情/别名/工作区创建绑定）。
- 数据层 100% 复用现有 `lib/*` 函数、Zustand stores、OpenAPI 类型。
- `tokens.ts` 新增 breakpoint token；`FRONTEND_PAGE_STYLE.md` 新增「移动端 App UI」章节。

## 不在范围内（显式清单）

- ❌ 其他页面移动版：runtimes / settings / admin / changes / agent-run 等。
- ❌ SillyHub 工作区详情及其后续功能（changes/spec 等）：手机端提示「请在电脑端打开」。
- ❌ 暗色模式（当前未启用）。
- ❌ 平板（768~1024px）：走桌面 web UI。
- ❌ 后端任何改动（无 API/表结构/migration）。

## 成功标准（可验证）

- 手机（≤768px）访问 `/ppm/workbench`、`/ppm/task-plans`、`/ppm/problem-list`、`/workspaces`，显示移动 App UI，可浏览且全功能可操作。
- 电脑访问同一 URL，显示桌面 web UI，渲染产物与当前**完全一致**（桌面文件 git diff 为空）。
- middleware 服务端 rewrite，手机首屏直接为移动版，**无 FOUC**。
- 底部 5 Tab 导航正确；「平台切换」可到 workspaces。
- 移动视图数据与桌面同源（复用 `lib/*`，不自写请求）。
- 移动端功能与桌面对齐：新建/编辑/导出/批量删除/执行/进详情/别名/工作区创建绑定均可用。
- 工作区详情之后的功能在手机端提示去电脑端。
- `pnpm test` / `pnpm typecheck` / `pnpm lint` / `pnpm build` 全绿，零桌面回归。
