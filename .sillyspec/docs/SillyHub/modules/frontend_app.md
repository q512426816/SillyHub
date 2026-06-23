---
author: qinyi
created_at: 2026-06-01T12:00:00
---

# frontend_app
> 最后更新：2026-06-21
> 最近变更：ql-20260623-016-b8d4（/ppm/plan-nodes 对齐 project-plans 风格）
> 模块路径：frontend/src/app/**

## 职责

Frontend App 模块是 Next.js 14 App Router 的页面路由层，负责定义所有页面和布局结构。使用 React Server Components（RSC）+ Client Components 混合模式，实现服务端渲染和客户端交互。

## 当前设计

### 布局结构

```
layout.tsx (根布局)
  └── (dashboard)/layout.tsx (Dashboard 布局 — 认证守卫 + AppShell)
        ├── workspaces/           — 工作区管理
        ├── settings/             — 系统设置
        └── (auth)/login/         — 登录页（无认证守卫）
```

### 页面清单

| 路由分组 | 路径 | 文件 | 说明 |
|----------|------|------|------|
| 根 | `/` | `page.tsx` | 首页/重定向 |
| auth | `/login` | `(auth)/login/page.tsx` | 登录页 |
| dashboard | `/workspaces` | `(dashboard)/workspaces/page.tsx` | 工作区列表 |
| dashboard | `/workspaces/[id]` | `(dashboard)/workspaces/[id]/page.tsx` | 工作区详情 |
| dashboard | `/workspaces/[id]/scan-docs` | `.../scan-docs/page.tsx` | 扫描文档查看 |
| dashboard | `/workspaces/[id]/components` | `.../components/page.tsx` | 组件列表 |
| dashboard | `/workspaces/[id]/components/topology` | `.../topology/page.tsx` | 拓扑图 |
| dashboard | `/workspaces/[id]/changes` | `.../changes/page.tsx` | 变更列表（状态列 human_gate 展示、阶段列 null 兜底、类型列颜色映射、影响组件标签） |
| dashboard | `/workspaces/[id]/create-change` | `.../create-change/page.tsx` | 创建变更 |
| dashboard | `/workspaces/[id]/changes/[cid]` | `.../changes/[cid]/page.tsx` | 变更详情 |
| dashboard | `/workspaces/[id]/changes/[cid]/tasks` | `.../tasks/page.tsx` | 任务列表 |
| dashboard | `/workspaces/[id]/changes/[cid]/tasks/[tid]` | `.../tasks/[tid]/page.tsx` | 任务详情 |
| dashboard | `/workspaces/[id]/agent` | `.../agent/page.tsx` | Agent 运行 |
| dashboard | `/workspaces/[id]/approvals` | `.../approvals/page.tsx` | 审批列表 |
| dashboard | `/workspaces/[id]/audit` | `.../audit/page.tsx` | 审计日志 |
| dashboard | `/workspaces/[id]/runtime` | `.../runtime/page.tsx` | 运行时状态 |
| dashboard | `/workspaces/[id]/incidents` | `.../incidents/page.tsx` | 事件列表 |
| dashboard | `/workspaces/[id]/incidents/[iid]` | `.../incidents/[iid]/page.tsx` | 事件详情 |
| dashboard | `/workspaces/[id]/knowledge` | `.../knowledge/page.tsx` | 知识库 |
| dashboard | `/workspaces/[id]/releases` | `.../releases/page.tsx` | 发布管理 |
| dashboard | `/settings` | `(dashboard)/settings/page.tsx` | 设置页 |
| dashboard | `/settings/git-identities` | `.../git-identities/page.tsx` | Git 身份管理 |

### 布局说明

- **根布局** (`layout.tsx`)：设置 HTML lang=zh-CN、全局 CSS、metadata（title: "Multi-Agent Platform"）
- **Dashboard 布局** (`(dashboard)/layout.tsx`)：客户端组件，使用 `useSession` 做认证守卫，未登录重定向到 `/login`，已登录包裹 `AppShell`

## 对外接口

| 导出 | 类型 | 说明 |
|------|------|------|
| `RootLayout` | 默认导出 (Server Component) | 根布局，设置全局 HTML 结构 |
| `DashboardLayout` | 默认导出 (Client Component) | Dashboard 认证守卫布局 |
| `metadata` | 命名导出 | 根页面元数据 |

## 关键数据流

```
用户访问任意 /xxx 路径
  → DashboardLayout 检查 useSession.hydrated + accessToken
  → 未登录 → router.replace("/login")
  → 已登录 → AppShell（侧边栏 + 主内容区）→ 渲染对应 page.tsx
  → page.tsx 中调用 frontend/lib/*.ts 获取数据
```

## 设计决策

| 决策 | 原因 |
|------|------|
| Next.js App Router 路由组 `(dashboard)` / `(auth)` | 共享布局但隔离 URL 前缀 |
| Dashboard 布局使用 Client Component | 需要访问 Zustand session store 和 router |
| 根布局使用 Server Component | 无需客户端状态，优化首屏性能 |
| `suppressHydrationWarning` | 避免暗色模式 class 水合警告 |

## 依赖关系

- **内部依赖**：`@/components/app-shell`（AppShell 组件）, `@/stores/session`（useSession）, `@/lib/*`（数据获取函数）
- **外部依赖**：Next.js App Router, React 18, Next Navigation

## 注意事项

- `(dashboard)/layout.tsx` 在 `hydrated === false` 时返回 null（等待 Zustand persist rehydrate）
- 所有 dashboard 下页面依赖 `useSession` 已认证状态
- 路由使用 Next.js 动态路由 `[id]`、`[cid]`、`[tid]`、`[iid]`

## 变更索引

| 日期 | 变更 | 摘要 |
|------|------|------|
| 2026-06-05 | ql-20260605-001 | 变更详情页文档实时刷新 + Gate面板突出显示 |
| 2026-06-05 | 2026-06-05-agent-74b61b | Agent 控制台移除 max-w-6xl 宽度限制，日志区域撑满主内容区 |
| 2026-06-08 | 2026-06-08-change-center-columns | 变更列表列展示优化：human_gate 状态列 + draft 兜底 + 类型颜色 + 影响组件 |
| 2026-06-09 | ql-20260609-002 | Agent 控制台日志展示优化：BashToolPreview + 扫描自检摘要 + 结果摘要列 + 状态区分 |
| 2026-06-09 | ql-20260609-003 | Agent 控制台日志区域高度增加至 1.5 倍（480→720px, 320→480px） |
| 2026-06-09 | ql-20260609-004 | Workspace Bootstrap 日志区域改为 Agent 控制台同款深色样式 |
| 2026-06-09 | ql-20260609-005-d2f7 | Bootstrap 日志区域完全复用共享 AgentLogViewer 组件 |
| 2026-06-09 | ql-20260609-007-b4c2 | 工作区详情页显示上一次 Bootstrap 运行结果摘要 |
| 2026-06-09 | ql-20260609-008 | 修复 Bootstrap runs 排序用 finished_at 而非缺失的 created_at |
| 2026-06-16 | ql-20260616-002-f4ce | /runtimes 快速对话改用 SSE 流式（EventSource 订阅 + nextjs route handler 透传 + 60s 回退 GET 兜底） |
| 2026-06-21 | ql-20260621-012-7d4a | /runtimes 卡片加移除/会话按钮+运行环境/可执行路径/会话数；删工具审批面板；会话入口下沉卡片触发聚焦 |
| 2026-06-17 | ql-20260617-002-21d4 | 用户管理抽屉组织/角色多选"暂无选项"修复：size 200→100 匹配后端 le=100 + Promise.all→allSettled + catch console.error |
| 2026-06-17 | ql-20260617-003-3757 | 用户/角色管理加分页（默认 20 条/页）：新增 Pagination 组件 + 列表表格下方挂分页 + 搜索/状态变化 setPage(1) |
| 2026-06-17 | ql-20260617-004-02d5 | 用户/角色管理表格改 antd Table：columns + showSizeChanger + pageSizeOptions [10,20,50,100] + pageSize state，删除原生 table + 自定义 Pagination |
| 2026-06-21 | ql-20260621-002-a8f3 | /ppm/kanban 看板重写为人员×日期矩阵布局（纵人员行头 avatar+姓名+工时+饱和度进度条 sticky 左，横日期列周六日标绿背景+休标签，单元格=该人该日任务缩略卡）+ 工时图表联动（默认全员柱图 stat-by-user，点人员行切单人项目工时饼图）+ 日期导航上周/本周/下周+RangePicker；新增 kanban-matrix/date-nav/work-hour-chart 三组件 + kanban-grouping 矩阵 helper，删除被取代的 kanban-column/task-card |
| 2026-06-21 | ql-20260621-003-menu-isolation | 新建 /ppm 首页（`(dashboard)/ppm/page.tsx`，redirect 到 `/ppm/projects`）；配合 AppShell 路径过滤实现 ppm 与主平台菜单完全隔离，ppm 作为独立入口 |
| 2026-06-21 | ql-20260621-004-c4a1 | 里程碑明细：明细表单 module_id 由 Input 改 Select（按 planNodeId 自取 listPlanNodeModules 做下拉，非父级透传）；所有日期列 render 原样输出 ISO → fmtDate(YYYY-MM-DD)；流程履历 → fmtDateTime；plan-nodes 两列同步修复 |
| 2026-06-22 | 2026-06-21-frontend-style-system | 前端样式系统统一（现代明亮活力）：Design Token 单一源（主色 #2563EB）+ antd ConfigProvider 全面定制 + shadcn 视觉组件 + 共享布局（PageContainer/PageHeader/SectionCard/DataTable）+ AppShell lucide 图标 + 新增顶栏 + 登录页同色系重做；各页统一容器/配色/Inter 字体，消除散落老色板与内联 width |
| 2026-06-22 | ql-20260622-028-5f1c | /ppm/problem-list 列表页样式与 project-plans 对齐：PageContainer size="full" + 顶部按钮右对齐(重置|分隔|导出/新建) + grid-cols-4 垂直 Field 查询表单 + Table bordered/scroll.y/showTotal + antd Button 全部换 ui Button(size="sm" + variant) |
| 2026-06-22 | ql-20260622-029-a1b7 | /ppm/problem-list 关键字 Input 输入不要自动查询：拆分 keywordInput/keyword 双 state,onChange 只改输入态,Enter/查询按钮同步到过滤态,allowClear 清空立即同步,顶部按钮行新增"查询"按钮 |
| 2026-06-22 | ql-20260622-030-7e2a | /ppm/problem-list 查询走接口：后端 /problem-list 加 7 个 Query 参数(keyword/status多值/project_id/pro_type/is_urgent/find_time_start/end)+ response 改 Page[ProblemListResp];前端 apiFetch query 支持 string[],listProblems 返 PageResp,page.tsx 改服务端分页,去掉本地 useMemo;操作列 width 280→200 |
| 2026-06-22 | ql-20260622-031-b3f9 | downloadExcel 裸 fetch 无 401 自动刷新：token 过期导出 401 AUTH_TOKEN_EXPIRED。复刻 apiFetch 逻辑:401 时调 /api/auth/refresh,刷新成功 setTokens + 用新 token 重试一次,重试仍 401 则清 session + 跳 /login;顺便支持 params 多值数组(与 apiFetch 一致) |
| 2026-06-22 | ql-20260622-032-c4d2 | /ppm/problem-list 操作列 width 200 → 'max-content'(每行按钮数 1~6 个,固定宽度留白);按钮容器 flex-wrap → whitespace-nowrap 单行排列;fixed:'right' 保留 |
| 2026-06-22 | ql-20260622-034-c3a7 | /ppm/problem-list 顶部"查询"按钮 → "搜索" 去掉 variant=outline(回退 primary);与 /ppm/project-plans 搜索按钮样式对齐 |
| 2026-06-22 | ql-20260622-035-a1e9 | /ppm/problem-changes 整体重写对齐 project-plans:PageContainer size=full + PageHeader + SectionCard;顶部右对齐 ui Button(搜索 primary + 重置 outline + 分隔 + 导出 outline);grid-cols-4 垂直 Field 查询条件;Table bordered + scroll y calc(100vh-430px) + showTotal/showSizeChanger + 客户端分页 20/页;操作列 width=max-content + whitespace-nowrap + fixed=right + ui Button(size=sm + variant);移除 antd Button/Space + toast;关键字双 state 回车提交 |
| 2026-06-22 | ql-20260622-036-b8f2 | /ppm/problem-changes 操作列去 align=right + 去 justify-end,按钮自然左对齐(默认 flex-start),单按钮(详情)行不再居右留白;width=max-content + whitespace-nowrap + fixed=right 保留 |
| 2026-06-22 | ql-20260622-037-d4c1 | /ppm/problem-changes 查询走接口:后端 /problem-change 加 4 个 Query(keyword/status多值/created_at_start/end)+ response 改 Page[ProblemChangeResp];前端 listProblemChanges 返 PageResp + page.tsx 改服务端分页(删本地 filter/slice,page/pageSize/total + onChange 重查 + 查询回到 page=1) |
| 2026-06-23 | ql-20260623-001-e7a2 | /ppm/problem-list + /ppm/problem-changes 搜索按钮条件未变时点击也触发查询:加 searchNonce state,commitKeyword 同步 setKeyword + setSearchNonce(n=>n+1),useEffect deps 追加 searchNonce。React 18 batch 保证只触发 1 次 useEffect(不双查) |
| 2026-06-23 | ql-20260623-002-f3b8 | /ppm/task-plans 整体重写对齐 project-plans:PageContainer size=full + PageHeader + SectionCard;顶部右对齐 ui Button(搜索 primary + 重置 outline + 分隔 + 导出 outline + 视图切换 + 新建);grid-cols-4 垂直 Field 查询条件(状态多选/月份/项目/负责人/计划时间区间/配合人员);Table bordered + scroll y calc(100vh-430px) + showTotal/showSizeChanger;操作列 width=max-content + whitespace-nowrap + fixed=right;移除本地 useMemo 过滤改服务端分页 + searchNonce 兜底搜索;personal 视图不传 user_id(后端从 token 注入) |
| 2026-06-23 | ql-20260623-003-a9c4 | /ppm/task-plans 视图切换(全部/我的任务)从顶部按钮行移到查询条件 grid 配合人员 Field 之后,顶部按钮行精简为 搜索/重置/分隔/导出/新建;视图切换作为 Field label='视图' 与其他查询条件布局对齐 |
| 2026-06-23 | ql-20260623-004-b7d2 | /ppm/task-plans 负责人 PpmUserSelect 去掉外层 inputCls + flex/h-8/items-center/px-1 div(框中框),改直接 style={{width:100%}},对齐 problem-list/work-hours 用法 |
| 2026-06-23 | ql-20260623-005-c3e1 | /ppm/task-plans 月份/项目/视图 查询条件改 antd 组件统一风格:月份 `<input type=month>` → DatePicker.MonthPicker,项目/视图原生 `<select>` → antd Select(与其他 Field 控件风格对齐) |
| 2026-06-23 | ql-20260623-006-d4a9 | /ppm/task-plans 查询条件变化不自动查询:useEffect deps 从所有 filter state + searchNonce 精简为只 [searchNonce];任意条件变化只 setState 不查,搜索按钮/回车/重置走 setSearchNonce 触发,翻页走 pagination.onChange 直接调 load |
| 2026-06-23 | ql-20260623-007-e5f1 | /ppm/task-plans 操作列+查询区对齐 project-plans:操作按钮从 ghost 改 default(执行 bg-blue-500/编辑默认/删除 destructive,同色方案);查询条件加展开/收起按钮,默认 4 个 Field(状态/月份/项目/负责人),展开后追加 3 个(计划时间/配合人员/视图) |
| 2026-06-23 | ql-20260623-008-f2c3 | /ppm/task-plans 操作列 width 从 'max-content'(antd Table fixed+scroll.x 下不可靠)改具体数字 180px,真正收紧列宽消除留白 |
| 2026-06-23 | ql-20260623-009-a8b4 | /ppm/task-plans 编辑按钮从 default 改 outline variant;原因 default=bg-primary 与执行 bg-blue-500 在 theme 下都是蓝造成同色;改后形成三种视觉层级:执行蓝实/编辑描边/删除红实 |
| 2026-06-23 | ql-20260623-010-b6e2 | /ppm/work-hours 整体重写对齐 project-plans:PageContainer size=full + PageHeader + SectionCard(bodyPadding=p-2);顶部按钮右对齐 ui Button(搜索 primary + 重置 outline + 分隔 + 工时统计→ outline + 导出 outline + 录入工时 primary);grid-cols-4 垂直 Field(工作日期 RangePicker + 项目 antd Select + 类型 antd Select + 录入人 PpmUserSelect style width 100%);Table bordered + scroll y calc(100vh-430px) + showTotal/showSizeChanger + 服务端分页 + searchNonce 兜底搜索;操作列 width 120 + whitespace-nowrap + fixed=right + 编辑 outline + 删除 destructive;移除 antd message 与本地 useMemo 过滤;buildParams(p,ps) 抽取过滤→WorkHourPageReq 映射;WorkHourDrawer 子组件保留原实现 |
| 2026-06-23 | ql-20260623-011-c3d1 | 4 个走 searchNonce 模式的页面(work-hours/task-plans/problem-list/problem-changes)所有 Select/PpmUserSelect/MonthPicker 选择型查询条件 onChange 追加 setSearchNonce((n)=>n+1),选中即触发查询,无需点搜索按钮;文本输入型(Input 关键字、配合人员、RangePicker 日期区间)保持原样走 commitSearch/回车提交;React 18 batch 保证 setState+setSearchNonce 同帧合并,useEffect [searchNonce] 只触发 1 次重查 |
| 2026-06-23 | ql-20260623-012-d4e8 | problem-list 加展开收起按钮(默认 4 个 Field:关键字/状态/项目/问题类型,展开追加 2 个:是否紧急/发现时间,放重置后分隔前);删除 problem-list/problem-changes/task-plans 搜索条件 grid 末尾'共 X 条'浮动 div(Table 分页 showTotal 保留);total state 仍用于 Table pagination |
| 2026-06-23 | ql-20260623-013-e5f2 | 前端 page_size>200 调用全部夹到 200(对齐后端 ppm Query ge=1 le=200 硬限制):work-hours/page.tsx 两处 listPlanTasks(任务列下拉/抽屉 taskOptions,原 500→200);work-hour-statistics/page.tsx 两处 listWorkHours 明细(原 1000→200)。plan-nodes 已用 200 不动。解决 /api/ppm/task-plan/page?page_size=500 的 422 |
| 2026-06-23 | ql-20260623-015-a7c3 | /ppm/project-members 对齐 project-plans:page.tsx 改 PageContainer size=full + PageHeader;PpmProjectMembersTable 组件按 showToolbar 双模式渲染(页面=SectionCard bodyPadding=p-2 包裹 + Table bordered + scroll y calc(100vh-430px),抽屉=原 flex div 不变以兼容 projects 抽屉);顶部按钮去左侧'共 X 条'文本(Table 分页 showTotal 保留);操作列去 justify-end 改 whitespace-nowrap(fixed=right 自然左对齐) |
| 2026-06-23 | ql-20260623-016-b8d4 | /ppm/plan-nodes 对齐 project-plans:div max-w-7xl + header → PageContainer size=full + PageHeader + SectionCard(bodyPadding=p-2) 包裹 toolbar+Table;顶部按钮右对齐(+ 新建模板);主 Table 加 bordered + scroll y calc(100vh-430px);模板主表 + 模块子表两处操作列去 align=right + justify-end,改 whitespace-nowrap + width 140 自然左对齐。无查询条件(模板树形展开 pagination=false),不加 search/grid |
