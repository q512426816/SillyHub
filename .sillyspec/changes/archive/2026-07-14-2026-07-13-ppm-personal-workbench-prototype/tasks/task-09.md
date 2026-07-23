---
id: task-09
title: "ProfileSummaryCard 个人信息卡 + PersonalMetricStrip 5 指标卡（覆盖：FR-02, FR-03, FR-04, FR-05, D-002@v1, D-003@v1, D-004@v1）"
title_zh: "个人信息卡与指标条组件"
author: qinyi
created_at: 2026-07-14 09:27:18
priority: P0
depends_on: [task-07, task-08]
blocks: [task-12]
requirement_ids: [FR-02, FR-03, FR-04, FR-05]
decision_ids: [D-002@v1, D-003@v1, D-004@v1]
allowed_paths:
  - frontend/src/app/(dashboard)/ppm/workbench/_components/profile-summary-card.tsx
  - frontend/src/app/(dashboard)/ppm/workbench/_components/personal-metric-strip.tsx
expects_from:
  - contract: WorkbenchProfile
    needs: [display_name, employee_no, department_name, role_name, avatar_text]
  - contract: WorkbenchMetrics
    needs: [task_count, completion_rate, delay_rate, work_hours, defect_count]
goal: >
  个人信息卡（姓名/工号/部门/角色/头像首字）+ 5 指标卡（本月任务量/完成率/延期率/工时/缺陷数），
  复用 SectionCard + Avatar(ui/avatar) + Badge(ui/badge)；空值显示「—」（D-002/003）；
  样式用 Tailwind 语义 class 参照 tokens.ts（非原型内联 CSS）。
implementation:
  - "新建 frontend/src/app/(dashboard)/ppm/workbench/_components/profile-summary-card.tsx：`\"use client\";` + JSDoc（个人信息卡，左 Avatar 首字 + 右姓名/工号/部门/角色，复用 SectionCard/Avatar）；import：`SectionCard` from `@/components/layout`（section-card.tsx，title/bodyPadding props）、`Avatar, AvatarFallback` from `@/components/ui/avatar`（avatar.tsx 导出，size-9 默认可 className 覆盖）、type `WorkbenchProfile` from `@/lib/ppm/types`（task-07 产出）；props：`{ profile: WorkbenchProfile | null; loading?: boolean }`"
  - "ProfileSummaryCard 渲染：SectionCard（title=\"个人信息\"，bodyPadding=\"p-4\"）内 flex 横向——左 `<Avatar className=\"size-12\"><AvatarFallback className=\"bg-blue-100 text-blue-700\">{profile?.avatar_text || \"?\"}</AvatarFallback></Avatar>`（首字，profile null/空兜底「?」）；右纵向文本块：姓名行 `<span className=\"text-base font-medium\">{profile?.display_name || \"—\"}</span>`、工号行 `<span className=\"text-xs text-muted-foreground\">工号：{profile?.employee_no || \"—\"}</span>`（D-002@v1）、部门行 `<span className=\"text-xs text-muted-foreground\">部门：{profile?.department_name || \"—\"}</span>`（D-003@v1，department nullable）、角色行 `<span className=\"text-xs text-muted-foreground\">角色：{profile?.role_name || \"—\"}</span>`（D-004@v1），空值统一显示「—」"
  - "ProfileSummaryCard loading 态：profile=null 且 loading=true 时，Avatar/文本块渲染占位「—」或简单 Skeleton（ui/skeleton.tsx 可选，不强制），不阻断渲染"
  - "新建 frontend/src/app/(dashboard)/ppm/workbench/_components/personal-metric-strip.tsx：`\"use client\";` + JSDoc（5 指标卡横排 任务量/完成率/延期率/工时/缺陷数，颜色参照原型 blue/green/amber/cyan/red）；import：`SectionCard` from `@/components/layout`、type `WorkbenchMetrics` from `@/lib/ppm/types`（task-07 产出）；props：`{ metrics: WorkbenchMetrics | null }`"
  - "PersonalMetricStrip 内部定义指标数组（固定 5 项，顺序+label+取值+颜色）：`{ key: \"task_count\", label: \"本月任务量\", value: metrics ? `${metrics.task_count}条` : \"—\", color: \"blue\" }`；`{ key: \"completion_rate\", label: \"本月完成率\", value: metrics ? `${Math.round(metrics.completion_rate * 100)}%` : \"—\", color: \"green\" }`（completion_rate 是 0~1 float，design §7.2）；`{ key: \"delay_rate\", label: \"本月延期率\", value: metrics ? `${Math.round(metrics.delay_rate * 100)}%` : \"—\", color: \"amber\" }`；`{ key: \"work_hours\", label: \"本月工时统计\", value: metrics ? `${metrics.work_hours}天` : \"—\", color: \"cyan\" }`（design §7.2 work_hours float 天）；`{ key: \"defect_count\", label: \"缺陷数量\", value: metrics ? `${metrics.defect_count}条` : \"—\", color: \"red\" }`"
  - "PersonalMetricStrip 颜色映射（Tailwind 语义 class，参照 tokens.ts 色值，非原型内联 color）：blue→`text-blue-600`、green→`text-emerald-600`、amber→`text-amber-600`、cyan→`text-cyan-600`、red→`text-red-600`（对齐 tokens.color.blue.600=#2563eb / emerald / warning#f59e0b / cyan / error#ef4444）"
  - "PersonalMetricStrip 渲染：SectionCard（无 title 或 title=\"本月指标\"，bodyPadding=\"p-4\"）内 `<div className=\"grid grid-cols-5 gap-3\">`（响应式可 grid-cols-2 md:grid-cols-5），每项 `<div key={m.key} className=\"rounded-lg border border-slate-200 bg-card p-3\"><div className=\"text-xs text-muted-foreground\">{m.label}</div><div className={`mt-1 text-2xl font-semibold ${COLOR_CLASS[m.color]}`}>{m.value}</div></div>`；metrics=null（接口未就绪/loading）时所有指标显示「—」不报错"
acceptance:
  - "ProfileSummaryCard 渲染 Avatar 首字 + 姓名/工号/部门/角色；工号或部门为空（null/undefined/\"\"）时显示「—」（D-002/003）"
  - "PersonalMetricStrip 渲染 5 个指标卡（任务量/完成率/延期率/工时/缺陷数），数值来自 WorkbenchMetrics，格式正确（任务量「N条」/完成率「N%」/延期率「N%」/工时「N天」/缺陷「N条」）"
  - "5 指标颜色对齐原型（蓝/绿/琥珀/青/红），用 Tailwind 语义 class（text-blue-600 等）非原型内联 style"
  - "profile=null / metrics=null 时不报错，显示「—」占位"
  - "`cd frontend && pnpm typecheck && pnpm test` 通过"
verify:
  - "cd frontend && pnpm typecheck && pnpm test"
constraints:
  - "复用 SectionCard（@/components/layout/section-card.tsx）、Avatar/AvatarFallback（@/components/ui/avatar.tsx），不新造卡片/头像组件"
  - "样式用 Tailwind 语义 class（bg-card / text-muted-foreground / text-blue-600 等）参照 tokens.ts 色值，禁止照搬原型内联 CSS（color:#xxx）"
  - "工号/部门/角色为空统一显示「—」（D-002/003/004 兜底，nullable 字段）"
  - "completion_rate/delay_rate 是 0~1 浮点（design §7.2），展示需 *100 取整加 %；work_hours 单位「天」；defect_count 不受 range 影响（design §7.2）"
  - "不调用接口（数据由 task-08 page.tsx 装配后下传 props），组件为纯展示"
---
