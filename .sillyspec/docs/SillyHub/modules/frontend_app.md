---
author: qinyi
created_at: 2026-06-01T12:00:00
---

# frontend_app
> 最后更新：2026-06-21
> 最近变更：ql-20260621-002-a8f3（PPM 看板重写为人员×日期矩阵+工时联动）
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
