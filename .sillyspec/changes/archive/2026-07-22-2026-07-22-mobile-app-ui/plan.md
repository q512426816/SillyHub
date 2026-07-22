---
plan_level: full
author: qinyi
created_at: 2026-07-22 23:11:59
updated_at: 2026-07-23 00:20:00
---
# 实现计划（Plan）— 移动端 App UI

> 来源：`design.md`（含 Design Grill 复审 pass）/ `decisions.md`（D-001~008，D-002@v2）/ `requirements.md`（FR-01~09）/ `tasks.md`。
> 纯前端变更，无后端/DB/CLI 联动。middleware rewrite 经复审验证可用。
> task 编号按 Wave 出现顺序连续（task-01~13），与 `tasks/task-NN.md` 一致。

## Spike 前置验证

无。middleware rewrite 是 Next.js 标准能力、已复审验证无冲突；其余为确定的前端业务实现。design §12 待细化项在各任务内落实。

## Wave 1（基础设施 + 外壳组件，4 者并行无相互依赖）

- [x] task-01: 新增 `frontend/src/middleware.ts`——UA 检测 + `NextResponse.rewrite()` 到 `/m/`，matcher 精确限定 `/ppm/*`、`/workspaces`、`/login`，排除 `/api`、`/_next`、静态资源；UA 异常默认不 rewrite + 单测（覆盖：FR-01, D-002@v2, D-005）
- [x] task-02: `frontend/src/styles/tokens.ts` 新增 `breakpoint` token（mobile ≤768）（覆盖：FR-09）
- [x] task-03: 新增 `frontend/src/lib/auth/route-guard.ts` 移动端守卫（基于 `(dashboard)/layout.tsx` 现有语义，**不改桌面**）+ 单测镜像 + 注释锚点（覆盖：FR-08, R-10）
- [x] task-04: 新增 `components/mobile/mobile-app-shell.tsx` + `mobile-tab-bar.tsx`（底部 5 Tab）+ `mobile-top-bar.tsx` + 单测（覆盖：FR-02, D-001, D-004）

## Wave 2（移动 layout，依赖 Wave 1）

- [x] task-05: 新增 `frontend/src/app/m/layout.tsx`——渲染 task-04 的 `MobileAppShell` + 接 task-03 的 `route-guard` 守卫（处理 `/m` 前缀白名单）（依赖 task-03, task-04；覆盖：FR-02, FR-08）

## Wave 3（登录页 + 通用组件库，两者并行）

- [x] task-06: 新增 `frontend/src/app/m/login/page.tsx` 移动登录页，复用桌面 username auth，登录后回目标移动页（依赖 task-01, task-05；覆盖：FR-03）
- [x] task-07: 新增通用件 `mobile-card-list.tsx`（全功能）+ `mobile-filter-drawer.tsx` + `mobile-detail-sheet.tsx` + `mobile-action-menu.tsx` + `mobile-batch-bar.tsx` + `mobile-export-button.tsx` + 单测（覆盖：FR-05, FR-06, D-007, D-008）

## Wave 4（个人工作台移动，依赖 Wave 2/3）

- [x] task-08: 新增 `app/m/ppm/workbench/page.tsx`——卡片流，复用 `lib/ppm/*` 数据，全功能对齐桌面（依赖 task-05, task-07；覆盖：FR-04, D-003, D-008）

## Wave 5（列表页移动，两页并行，依赖 Wave 3）

- [x] task-09: 新增 `app/m/ppm/task-plans/page.tsx`——MobileCardList 任务卡片 + 新建/编辑/导出/批量删/执行/详情 + FilterDrawer + 分页（依赖 task-07；覆盖：FR-05, D-003, D-007, D-008）
- [x] task-10: 新增 `app/m/ppm/problem-list/page.tsx`——同 task-09 模式（依赖 task-07；覆盖：FR-06, D-003, D-007, D-008）

## Wave 6（工作区选择移动，依赖 Wave 3）

- [x] task-11: 新增 `app/m/workspaces/page.tsx`——工作区卡片列表 + 创建/绑定/别名；详情提示电脑端（依赖 task-07；覆盖：FR-07, D-003, D-006, D-008）

## Wave 7（文档 + 全局验收，两者并行）

- [x] task-12: `.sillyspec/docs/SillyHub/scan/FRONTEND_PAGE_STYLE.md` 新增「移动端 App UI」章节，更新原「移动端非目标」条款（覆盖：FR-09）
- [x] task-13: 全局验收测试——middleware/外壳/CardList/各页/守卫一致性/桌面零回归 + `pnpm test/typecheck/lint/build` 全绿（依赖 task-01~11；覆盖：FR-01~09）

## 任务总表

| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR / D |
|---|---|---|---|---|---|
| task-01 | middleware UA rewrite | W1 | P0 | — | FR-01, D-002@v2, D-005 |
| task-02 | tokens breakpoint | W1 | P1 | — | FR-09 |
| task-03 | route-guard 移动守卫 | W1 | P0 | — | FR-08, R-10 |
| task-04 | MobileAppShell/TabBar/TopBar | W1 | P0 | — | FR-02, D-001, D-004 |
| task-05 | app/m/layout 外壳+守卫 | W2 | P0 | task-03, task-04 | FR-02, FR-08 |
| task-06 | app/m/login 移动登录页 | W3 | P0 | task-01, task-05 | FR-03 |
| task-07 | 通用移动组件库 | W3 | P0 | — | FR-05, FR-06, D-007, D-008 |
| task-08 | 工作台移动视图 | W4 | P1 | task-05, task-07 | FR-04, D-003, D-008 |
| task-09 | 计划任务移动视图 | W5 | P0 | task-07 | FR-05, D-003, D-007, D-008 |
| task-10 | 问题清单移动视图 | W5 | P0 | task-07 | FR-06, D-003, D-007, D-008 |
| task-11 | workspaces 移动视图 | W6 | P0 | task-07 | FR-07, D-003, D-006, D-008 |
| task-12 | FRONTEND_PAGE_STYLE 文档 | W7 | P2 | — | FR-09 |
| task-13 | 全局验收测试 | W7 | P0 | task-01~11 | FR-01~09 |

## 关键路径

- **外壳→layout→工作台**：`task-04 → task-05 → task-08 → task-13`（task-08 另需 task-07）
- **组件库→列表页**：`task-07 → task-09（或 task-10）→ task-13`
- **layout→登录**：`task-05 → task-06`
- 平行独立：`task-01 → task-06`、`task-02`、`task-12`

> 无循环依赖；Wave 内任务均无相互依赖（W1 四者并行、W3 task-06/07 并行、W5 task-09/10 并行、W7 task-12/13 并行）。

## 全局验收标准

- [ ] middleware：手机 UA rewrite 到 `/m/` 且首屏无 FOUC；桌面 UA 不 rewrite；UA 异常默认桌面
- [ ] 移动外壳 + 底部 5 Tab 导航正确，「平台切换」可到 `/workspaces`
- [ ] 4 个移动页面全功能可用，与桌面对齐（D-008）
- [ ] 移动视图数据全部复用 `lib/*`，无自写请求（D-003）
- [ ] workspaces 详情及之后功能提示「请在电脑端打开」（D-006）
- [ ] 登录：手机访问受保护移动页 → 移动登录页 → 登录后回目标页，复用桌面 auth
- [ ] 桌面零回归：`app/(dashboard)/**`、`app-shell.tsx`、`(auth)/login` git diff 为空
- [ ] `pnpm test` / `pnpm typecheck` / `pnpm lint` / `pnpm build` 全绿

## 覆盖矩阵（decisions.md 当前版本）

| 决策 ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v1（独立 App UI） | task-04, task-05, task-08 | AC: 移动路由段+外壳独立于桌面 |
| D-002@v2（middleware rewrite 防 FOUC） | task-01 | AC: 首屏无 FOUC，URL 不变 |
| D-003@v1（数据层共享） | task-08, task-09, task-10, task-11 | AC: 移动视图复用 lib/*，无自写请求 |
| D-004@v1（底部 5 Tab） | task-04 | AC: 5 Tab 导航正确 |
| D-005@v1（仅手机 ≤768px） | task-01 | AC: 平板走桌面 |
| D-006@v1（SillyHub 仅列表） | task-11 | AC: 详情提示电脑端 |
| D-007@v1（表格改卡片） | task-07, task-09, task-10 | AC: MobileCardList 替代表格 |
| D-008@v1（手机端全做） | task-07, task-08, task-09, task-10, task-11 | AC: 全功能与桌面对齐 |

（D-002@v1 已 superseded，不引用。）
