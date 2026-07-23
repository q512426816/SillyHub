---
id: task-11
title: "WorkCalendarPanel 双圆点日历 + QuickEntryGrid + RuleNotePanel + 消息通知/绩效考评 EmptyState 占位（覆盖：FR-08, FR-11, D-007@v1）"
title_zh: "工作日历快捷入口与占位组件"
author: qinyi
created_at: 2026-07-14 09:27:18
priority: P1
depends_on: [task-07, task-08]
blocks: [task-12]
requirement_ids: [FR-08, FR-11]
decision_ids: [D-007@v1]
allowed_paths:
  - frontend/src/app/(dashboard)/ppm/workbench/_components/work-calendar-panel.tsx
  - frontend/src/app/(dashboard)/ppm/workbench/_components/quick-entry-grid.tsx
  - frontend/src/app/(dashboard)/ppm/workbench/_components/rule-note-panel.tsx
  - frontend/src/app/(dashboard)/ppm/workbench/_components/message-placeholder.tsx
expects_from:
  - contract: WorkbenchCalendar
    needs: [year_month, days]
  - contract: CalendarDay
    needs: [date, load_level, alert_level, task_count]
goal: >
  双圆点工作日历（自研月历 grid，每日左点 load_level + 右点 alert_level）+ 快捷入口 4 按钮 +
  规则说明静态文本 + 消息/绩效考评 EmptyState 占位（D-007@v1，不建后端）。
implementation:
  - "新建 frontend/src/app/(dashboard)/ppm/workbench/_components/work-calendar-panel.tsx：`\"use client\";` + JSDoc（双圆点月历，自研 grid 7 列，design §3 不引第三方日历库）；import：`SectionCard` from `@/components/layout`、type `WorkbenchCalendar, CalendarDay` from `@/lib/ppm/types`（task-07 产出，CalendarDay: date/load_level/alert_level/task_count）、`cn` from `@/lib/utils`（条件 class 拼接）；props：`{ calendar: WorkbenchCalendar | null; loading?: boolean }`"
  - "WorkCalendarPanel 辅助函数 `buildMonthGrid(yearMonth: string, days: CalendarDay[])`：按当月 1 号星期几补前导空格 + 遍历当月每日，从 days 按 date 匹配取该日 load/alert（无数据视为 load_level=\"none\"/alert_level=\"none\"，不显点）"
  - "WorkCalendarPanel load_level→颜色（左点，design §7.3 分档 0/1-2/3-4/≥5）：\"none\"→不渲染左点；\"normal\"(1-2)→`bg-emerald-500`（绿 正常）；\"mid\"(3-4)→`bg-amber-500`（黄 偏满）；\"over\"(≥5)→`bg-red-500`（红 过载）；其余/兜底→不显点"
  - "WorkCalendarPanel alert_level→颜色（右点，design §7.3：该日有 end_time<now AND status!=已完成 → over）：\"normal\"→`bg-emerald-500`（绿）；\"over\"→`bg-red-500`（红 延期预警）；\"none\"/兜底→不渲染右点"
  - "WorkCalendarPanel 渲染：SectionCard（title=`本月日历 ${calendar?.year_month ?? \"\"}`，bodyPadding=\"p-3\"）内——星期表头 `<div className=\"grid grid-cols-7 gap-1 text-center text-xs text-muted-foreground\">`（日/一/二/三/四/五/六）；日期 grid：`<div className=\"grid grid-cols-7 gap-1\">`，每日格子 `<div className=\"aspect-square rounded border border-slate-100 bg-card p-1 text-center\">`：顶部日期号 `<span className=\"text-xs\">{day}</span>` + 底部双圆点 `<div className=\"mt-1 flex items-center justify-center gap-0.5\"><span className={cn(\"size-1.5 rounded-full\", loadColor)} /><span className={cn(\"size-1.5 rounded-full\", alertColor)} /></div>`（load/alert 为 none 时不渲染该 span 留空位）；calendar=null/loading 渲染空 grid 或 Skeleton + 文案「日历加载中」不报错"
  - "新建 frontend/src/app/(dashboard)/ppm/workbench/_components/quick-entry-grid.tsx：`\"use client\";` + JSDoc（4 快捷入口按钮）；import：`SectionCard` from `@/components/layout`、`Button` from `@/components/ui/button`、`useRouter` from `next/navigation`、`useToast, Toast` from `../../shared`；props：无（或 `{ }`）；渲染：SectionCard（title=\"快捷入口\"，bodyPadding=\"p-3\"）内 `<div className=\"grid grid-cols-2 gap-2\">` 4 个 Button(variant=outline)"
  - "QuickEntryGrid 4 按钮（参照原型）：「问题清单」→ router.push(\"/ppm/problem-list\")（已有路由）；「绩效考评」→ showToast(false, \"绩效考评功能暂未开放\")（Toast 提示 不跳转 D-007@v1 占位）；「知识库」→ router.push 走平台 knowledge 路由（路径落实时确认，如 \"/knowledge\" 或平台文档入口；找不到则 Toast 提示未配置）；「消息通知」→ 触发 MessagePlaceholder 区或 Toast「消息功能开发中」（D-007@v1）"
  - "新建 frontend/src/app/(dashboard)/ppm/workbench/_components/rule-note-panel.tsx：`\"use client\";` + JSDoc（静态规则说明文本 无接口）；import：`SectionCard` from `@/components/layout`；props：无；渲染：SectionCard（title=\"规则说明\"，bodyPadding=\"p-4\"）内静态 `<ul className=\"space-y-1 text-xs text-muted-foreground\">` 列表（参照原型规则文案）：「任务量/完成率/延期率按本月任务 start_time 区间统计」、「完成率 = 已完成任务数 / 本月任务总数；任务数为 0 时显示 0%」、「延期率 = 已过期且未完成任务数 / 本月任务总数」、「工时统计取任务执行实际耗时（task_execute.time_spent）」、「日历圆点：左点=当日任务负载（绿正常/黄偏满/红过载），右点=延期预警（绿正常/红预警）」（文案落实时可调 保持与 design §7.2/§7.3 口径一致）"
  - "新建 frontend/src/app/(dashboard)/ppm/workbench/_components/message-placeholder.tsx：`\"use client\";` + JSDoc（消息通知 + 绩效考评占位空状态 D-007@v1 不建后端模块）；import：`SectionCard` from `@/components/layout`、`EmptyState` from `@/components/ui/empty-state`（empty-state.tsx，props: icon/title/description/action）；props：`{ title?: string; description?: string }`（默认消息占位 可复用作绩效占位）；渲染：SectionCard（title=title ?? \"消息通知\"，bodyPadding=\"p-4\"）内 `<EmptyState title=\"消息功能开发中\" description=\"消息通知模块暂未上线，后续单独开放。\" />`；绩效考评复用时 title=\"绩效考评\" + EmptyState 文案相应调整（D-007@v1 只占位不建后端 notification/performance 表/接口）"
acceptance:
  - "WorkCalendarPanel 渲染当月日历 grid（7 列 + 星期表头），每日双圆点：左点颜色随 load_level（none 不显/normal 绿/mid 黄/over 红）、右点颜色随 alert_level（none 不显/normal 绿/over 红），与 design §7.3 分档一致"
  - "calendar=null/loading 时不报错（空 grid 或骨架）"
  - "QuickEntryGrid 4 按钮：问题清单可跳 /ppm/problem-list；知识库可跳平台 knowledge 路由；绩效考评/消息点击 Toast 提示未开放/开发中（不报错不跳死链）"
  - "RuleNotePanel 渲染静态规则说明（口径与 design §7.2/§7.3 一致）"
  - "MessagePlaceholder 用 EmptyState 占位「消息功能开发中」，复用作绩效考评占位不报错（D-007@v1）"
  - "`cd frontend && pnpm typecheck && pnpm test` 通过"
verify:
  - "cd frontend && pnpm typecheck && pnpm test"
constraints:
  - "日历自研 grid（grid-cols-7 + aspect-square），design §3 明确不引第三方日历库（全仓无日历组件）"
  - "消息通知/绩效考评只做 EmptyState 占位，不建后端表/接口（D-007@v1，design §3 非目标）"
  - "复用 SectionCard（layout）+ EmptyState（ui/empty-state.tsx）+ Button（ui/button.tsx），不自造卡片/空态"
  - "load_level/alert_level 颜色用 Tailwind 语义 class（bg-emerald-500/bg-amber-500/bg-red-500）参照 tokens.ts 状态色（success/warning/error），非原型内联 CSS"
  - "load_level=\"none\"/alert_level=\"none\" 时不渲染圆点（design §7.3：0 任务不显点）"
  - "数据 WorkbenchCalendar 由 page.tsx（task-08）装配后 props 下传，组件内不独立 fetch"
---
