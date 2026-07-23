---
id: task-08
title: "/ppm/workbench 页面容器（page.tsx）+ 数据装配（apiFetch+useEffect）+ app-shell 菜单加「个人工作台」项（覆盖：FR-01, D-001@v1）"
title_zh: "工作台页面容器与菜单入口"
author: qinyi
created_at: 2026-07-14 09:27:18
priority: P0
depends_on: [task-07]
blocks: [task-09, task-10, task-11]
requirement_ids: [FR-01]
decision_ids: [D-001@v1]
allowed_paths:
  - frontend/src/app/(dashboard)/ppm/workbench/page.tsx
  - frontend/src/components/app-shell.tsx
expects_from:
  - contract: workbenchClient
    fields: [fetchWorkbenchProfile, fetchWorkbenchSummary, fetchWorkbenchCalendar]
goal: >
  新建 /ppm/workbench 页面容器，三栏布局骨架（左/中/右 stack）+ profile/summary/calendar 数据装配（apiFetch+useEffect 范式），app-shell PPM 菜单首项加「个人工作台」入口；不改 /ppm redirect（保留 → /ppm/projects，D-001@v1）。
implementation:
  - "新建 frontend/src/app/(dashboard)/ppm/workbench/page.tsx：`\"use client\";` 顶部 JSDoc 注明：个人工作台 / 三栏聚合当前登录人数据 / 沿用 apiFetch+useEffect 非 react-query（design §3）"
  - "import：`useEffect/useState/useCallback` from react；`PageContainer, PageHeader, SectionCard` from `@/components/layout`（参照 task-plans/page.tsx:20）；`ApiError` from `@/lib/api`（task-plans/page.tsx:25）；`fetchWorkbenchProfile/fetchWorkbenchSummary/fetchWorkbenchCalendar` from `@/lib/ppm/workbench`（task-07 产出）；相关 type from `@/lib/ppm/types`；dayjs（默认当月 year_month = dayjs().format(\"YYYY-MM\")）"
  - "state：profile/summary/calendar 三个数据 + 各自 loading/error（或统一 loading/error 三块独立 try/catch，design §9 回退策略：各区块独立 try/catch + EmptyState，不整页崩）"
  - "useEffect 首屏装配：并行（或串行）调三个 fetch，参照 task-plans/page.tsx:131-141 useEffect(async ...) 范式，catch 里 setError(err instanceof ApiError ? err.message : \"加载失败\")"
  - "summary 默认 range=\"month\"；calendar 默认 year_month = dayjs().format(\"YYYY-MM\")"
  - "布局：`<PageContainer size=\"full\"><PageHeader title=\"个人工作台\" subtitle=\"我的任务 / 本月指标 / 工作日历\"/>`；其下三栏 grid（左/中/右 stack，Tailwind grid-cols 或 flex；三栏宽度参照原型左窄中宽右中）。每栏先用 `<SectionCard>` 占位 + 注释标记 task-09/10/11 组件接入点（ProfileSummaryCard/PersonalMetricStrip/TodoListPanel/WorkbenchTaskTable/WorkCalendarPanel/QuickEntryGrid/RuleNotePanel/MessagePlaceholder），本 task 只搭骨架 + 数据 state 下传占位（如 `{profile ? <占位/> : <loading/>}`）"
  - "loading 态：各区块 loading 时显示骨架/Spinner 文案；error 态显示错误条 + 不阻断其他栏"
  - "修改 frontend/src/components/app-shell.tsx：MENU_ICON_MAP（~L86-100 ppm 段）首项加 `\"/ppm/workbench\": LayoutDashboard,`（图标选 LayoutDashboard 或 Home，与工作台语义匹配；放在 /ppm/projects 之前使其成为 PPM 菜单第一项）"
  - "注：菜单项数据来源是后端 permission 菜单接口（MENU_ICON_MAP 只管图标），实际「个人工作台」菜单条目需后端权限菜单配置新增项指向 /ppm/workbench；若后端无菜单配置入口，本 task 至少保证图标映射 + 前端可直达 /ppm/workbench（菜单条目缺失记为遗留，由 task-13 e2e 或单独 menu 配置补）——落实时确认菜单是 DB 驱动还是硬编码，若硬编码则一并加条目"
  - "不改 frontend/src/app/(dashboard)/ppm/page.tsx：保留 `redirect(\"/ppm/projects\")`（D-001@v1：工作台作 /ppm/workbench 独立入口，不抢 /ppm 默认落地）"
acceptance:
  - "/ppm/workbench 路由可访问，渲染 PageContainer + PageHeader + 三栏骨架（左/中/右 SectionCard 占位）"
  - "首屏 useEffect 成功调 fetchWorkbenchProfile/Summary/Calendar 三个接口（后端 task-02 就绪前提下），数据进 state"
  - "各区块有 loading 态（加载中文案/骨架）与 error 态（失败显示错误条不整页崩）"
  - "app-shell.tsx MENU_ICON_MAP 含 /ppm/workbench 图标映射；PPM 菜单首项为「个人工作台」"
  - "/ppm 仍 redirect /ppm/projects（ppm/page.tsx 未改）"
  - "`cd frontend && pnpm typecheck && pnpm test` 通过（无新增测试要求，仅不破坏现有）"
verify:
  - "cd frontend && pnpm typecheck && pnpm test"
constraints:
  - "不改 /ppm redirect 目标（D-001@v1：保留 → /ppm/projects，工作台作独立子路径）"
  - "用 PageContainer/SectionCard/PageHeader 现有 layout 组件（@/components/layout），不新造布局"
  - "沿用 apiFetch + useEffect（design §3 不引入 react-query）"
  - "本 task 只搭骨架 + 数据装配，具体 7 个子组件实现留 task-09/10/11；占位用 SectionCard + 文案/注释，避免提前写死组件 props"
  - "各区块独立 try/catch（design §9 回退策略）"
---
