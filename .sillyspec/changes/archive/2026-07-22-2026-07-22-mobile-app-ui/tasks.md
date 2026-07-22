---
author: qinyi
created_at: 2026-07-22 22:35:31
---
# 任务清单（Tasks）— 移动端 App UI

> 本清单为 brainstorm 阶段的**粗粒度**任务（按 Phase 分组）。进入 `sillyspec run plan` 后将细化为 Wave 分组、显式依赖关系、每个 Task 的实现步骤与测试用例。

## Phase 0：基础设施（设备分流 + 外壳 + 登录 + 断点）

- **task-01** [FR-01]：新增 `frontend/src/middleware.ts`，UA 检测 + `NextResponse.rewrite()` 到 `/m/`，matcher 精确限定目标页面、排除静态资源；UA 异常默认不 rewrite。含 middleware 单测。
- **task-02** [FR-02, FR-08]：新增 `frontend/src/app/m/layout.tsx`，移动外壳 + 登录/工作区守卫（从 `(dashboard)/layout.tsx` 抽公共守卫函数复用，避免漂移）。
- **task-03** [FR-03]：新增 `frontend/src/app/m/login/page.tsx` 移动登录页，复用现有 auth。
- **task-04** [FR-09]：`frontend/src/styles/tokens.ts` 新增 `breakpoint` token。

## Phase 1：移动组件库

- **task-05** [FR-02]：`components/mobile/mobile-app-shell.tsx` / `mobile-tab-bar.tsx`（底部 5 Tab）/ `mobile-top-bar.tsx`。
- **task-06** [FR-05, FR-06]：通用件 `mobile-card-list.tsx`（全功能：动作集/批量选择/分页/headerActions）、`mobile-filter-drawer.tsx`、`mobile-detail-sheet.tsx`（新建/编辑/别名/工作区创建绑定全屏表单）、`mobile-action-menu.tsx`、`mobile-batch-bar.tsx`、`mobile-export-button.tsx`。含组件单测。

## Phase 2：个人工作台移动

- **task-07** [FR-04]：`app/m/ppm/workbench/page.tsx`，卡片流（待办/快捷入口/统计），复用 `lib/*` 数据；全功能入口对齐桌面。

## Phase 3：计划任务移动

- **task-08** [FR-05]：`app/m/ppm/task-plans/page.tsx`，MobileCardList 承载任务卡片 + 新建/编辑/导出/批量删除/执行/进详情/筛选；分页对接现有 page/page_size。

## Phase 4：问题清单移动

- **task-09** [FR-06]：`app/m/ppm/problem-list/page.tsx`，同 task-08 模式（卡片列表 + 全功能 + FilterDrawer）。

## Phase 5：工作区选择移动

- **task-10** [FR-07]：`app/m/workspaces/page.tsx`，工作区卡片列表 + 创建/绑定/别名（全做）；工作区详情之后功能提示「请在电脑端打开」（D-006）。

## Phase 6：文档 + 验收

- **task-11** [FR-09]：`.sillyspec/docs/SillyHub/scan/FRONTEND_PAGE_STYLE.md` 新增「移动端 App UI」章节，更新原「移动端非目标」条款。
- **task-12**：验收测试——middleware rewrite、移动外壳、MobileCardList、各移动页、守卫一致性、桌面零回归（桌面文件 git diff 为空）、`pnpm test/typecheck/lint/build` 全绿。

## 依赖关系（粗，plan 阶段细化）

- task-01（middleware）→ task-02（layout）→ task-05（外壳组件）→ 各页面 task（07~10）。
- task-06（通用组件库）→ task-08/09（列表页依赖 MobileCardList 全家桶）。
- task-03（登录）可与 task-02 并行。
- task-04（断点）独立，最早可做。
- task-11/12（文档/验收）最后。

## 待 plan 阶段细化项（design §12 存疑）

1. middleware matcher 精确范围（哪些路径 rewrite、登录页处理、`/m/` 直接访问兜底）。
2. 移动/桌面登录守卫公共函数抽取点。
3. UA 检测库选型（正则 vs `ua-parser-js`）。
4. 各列表页功能在移动视图的具体承载（哪些动作进 ActionMenu / 详情页），结合各页实际字段定。
