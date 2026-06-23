---
source_commit: ba87eec
updated_at: 2026-06-23T16:24:41Z
created_at: 2026-06-24T00:24:41
author: qinyi
generator: sillyspec-scan
---

# frontend 目录结构

> 基于 `frontend/src/` 实际目录扫描（ls + find），覆盖旧版文档。源码未整读。

## 目录树

```
frontend/
├── src/
│   ├── app/                      Next.js 14 App Router
│   │   ├── layout.tsx            根 layout（metadata + AntdRegistry + AntdProviders + Inter 字体）
│   │   ├── page.tsx              首页
│   │   ├── globals.css           Tailwind + 全局样式
│   │   ├── favicon.ico
│   │   ├── (auth)/
│   │   │   └── login/page.tsx    登录页（client）
│   │   ├── (dashboard)/
│   │   │   ├── layout.tsx        主壳层（AppShell）
│   │   │   ├── admin/            管理后台（独立 layout + 权限菜单）
│   │   │   │   ├── layout.tsx
│   │   │   │   ├── organizations/page.tsx   组织树
│   │   │   │   ├── roles/page.tsx           角色权限
│   │   │   │   └── users/page.tsx           用户管理
│   │   │   ├── ppm/              PPM 项目管理（当前最大业务域）
│   │   │   │   ├── page.tsx                 PPM 首页
│   │   │   │   ├── shared.tsx               共享工具
│   │   │   │   ├── projects/                项目
│   │   │   │   ├── project-plans/           项目计划
│   │   │   │   ├── plan-nodes/              计划节点
│   │   │   │   ├── task-plans/              任务计划
│   │   │   │   ├── task-execute/            任务执行
│   │   │   │   ├── milestone-details/       里程碑详情（含 __tests__）
│   │   │   │   ├── problem-list/            问题列表（_forms / _problem-drawer）
│   │   │   │   ├── problem-changes/         问题变更（_forms）
│   │   │   │   ├── project-members/         项目成员
│   │   │   │   ├── project-stakeholders/    干系人
│   │   │   │   ├── customers/               客户
│   │   │   │   ├── kanban/                  看板（_components/ 10+ 组件）
│   │   │   │   ├── work-hours/              工时
│   │   │   │   └── work-hour-statistics/    工时统计
│   │   │   ├── runtimes/                    运行时健康（page + page.test）
│   │   │   ├── settings/
│   │   │   │   ├── page.tsx
│   │   │   │   ├── api-keys/                API Key 管理
│   │   │   │   └── git-identities/          Git 身份
│   │   │   └── workspaces/
│   │   │       ├── page.tsx                 工作区列表
│   │   │       └── [id]/                    工作区详情（最大子树）
│   │   │           ├── layout.tsx / page.tsx / error.tsx
│   │   │           ├── agent/               Agent 执行
│   │   │           ├── approvals/           审批
│   │   │           ├── audit/               审计
│   │   │           ├── changes/             变更（含 [cid] → tasks → [tid] 嵌套）
│   │   │           ├── components/          组件（+ topology/ 拓扑页）
│   │   │           ├── create-change/       创建变更
│   │   │           ├── incidents/           事件（含 [iid]）
│   │   │           ├── knowledge/           知识库
│   │   │           ├── members/             成员
│   │   │           ├── missions/            任务控制台
│   │   │           ├── releases/            发布
│   │   │           ├── runtime/             运行时
│   │   │           └── scan-docs/           扫描文档（含 markdown 渲染）
│   │   └── api/                  Route Handler（SSE 透传，统一 text/event-stream）
│   │       ├── workspaces/[workspaceId]/agent/runs/[runId]/stream/route.ts
│   │       ├── daemon-chat/[runId]/stream/route.ts
│   │       └── daemon/sessions/[sessionId]/stream/route.ts（含 __tests__）
│   ├── components/
│   │   ├── app-shell.tsx                 dashboard 壳层
│   │   ├── antd-providers.tsx            ConfigProvider（locale zhCN + theme + dayjs.locale）
│   │   ├── top-bar.tsx                   顶栏
│   │   ├── ui/                           shadcn 基础件（avatar/badge/button/card/dialog/dropdown-menu/empty-state/input/skeleton/status-badge/tag/tooltip）
│   │   ├── layout/                       page-container / page-header / data-table / form-layout / section-card / search-bar（+ index.ts）
│   │   ├── charts/                       ECharts 封装（ProjectPlanCostBarChart / WorkHourBarChart / WorkHourPieChart + index.ts）
│   │   ├── agent-log/                    normalize.ts / tool-renderers.tsx / types.ts（+ __tests__）
│   │   ├── daemon/                       interactive-session-panel + runtime-session-dialog + runtime-session-helpers（+ __tests__）
│   │   ├── permissions/                  session-permission-panel.tsx
│   │   ├── ppm-*.tsx                     PPM 业务组件（dict-select / file-urls / project-members-table / project-plan-detail / project-plan-form / resource-table / status-actions / sub-table / text / user-select）
│   │   ├── admin-*.tsx                   admin 业务组件（organization-tree / role-permission-picker / user-drawer）
│   │   ├── workspace-*.tsx               工作区业务组件（card / daemon-switcher / member-add-dialog / member-row / path-fields / scan-dialog / tabs）
│   │   ├── agent-run-panel.tsx / agent-log-viewer.tsx
│   │   ├── ask-user-dialog-card.tsx / permission-approval-card.tsx / permission-approval-dialog.tsx
│   │   ├── api-key-create-dialog.tsx / daemon-dir-browser.tsx
│   │   ├── sillyspec-step-progress.tsx / health-card.tsx / server-status-card.tsx
│   │   ├── component-detail-drawer.tsx / mission-console.tsx / error-boundary.tsx
│   │   ├── logout-confirm-dialog.tsx
│   │   ├── AgentModelInput.tsx / AgentProviderSelect.tsx
│   │   └── __tests__/                    组件测试（11 个 .test.tsx）
│   ├── lib/                      数据层 + hooks + 工具
│   │   ├── api.ts                网关（apiFetch / getApiBaseUrl / getDirectApiBaseUrl + 401 自动 refresh）
│   │   ├── agent.ts / agent-stream.ts   Agent client + SSE 消费层
│   │   ├── daemon.ts（+ 同目录 daemon.test.ts）
│   │   ├── approvals.ts / audit.ts / auth.ts / settings.ts / api-keys.ts
│   │   ├── workspaces.ts / workspace-members.ts / workspace-path.ts / client-path.ts / spec-workspaces.ts
│   │   ├── changes.ts / change-writer.ts / tasks.ts / archive.ts / workflow.ts
│   │   ├── admin.ts / menu-permissions.ts / permission.ts
│   │   ├── releases.ts / runtime.ts / health.ts / incidents.ts / knowledge.ts / components.ts
│   │   ├── git-gateway.ts / git-identities.ts / tool-gateway.ts / worktree.ts
│   │   ├── scan-docs.ts / format-token.ts / utils.ts
│   │   ├── ppm/                 PPM 领域（project / plan / task / problem / kanban / kanban-grouping / aggregations / export / format / workday / status-label / types / index，+ __tests__）
│   │   └── __tests__/            领域测试（13 个 .test.ts）
│   ├── stores/                   Zustand store
│   │   ├── session.ts            登录态（useSession，66 行）
│   │   └── kanban.ts             看板视图状态（useKanbanStore，185 行，含任务 CRUD）
│   ├── styles/                   全局样式 token
│   │   ├── index.ts              导出 tokens / cssVars
│   │   ├── tokens.ts             设计 token + cssVars（--color-primary 等）
│   │   └── fonts.ts              Inter localFont
│   └── test/
│       └── setup.ts              vitest setup（jest-dom）
├── public/                       静态资源（logo.png + .gitkeep）
├── components.json               shadcn/ui 配置
├── next.config.mjs               rewrites /api/* → backend、standalone、typedRoutes、reactStrictMode
├── tsconfig.json                 strict + @/* alias
├── tailwind.config.ts            darkMode class + 语义色
├── postcss.config.mjs / .eslintrc.json
├── vitest.config.ts              jsdom + globals + @ alias + setup
├── Dockerfile                    生产镜像（standalone）
├── package.json                  next@14.2.5 / react@18.3.1 / antd@6.4.4，pnpm@9.6.0，node>=20
├── pnpm-lock.yaml                包管理锁（另有遗留 package-lock.json）
└── .env.example                  NEXT_PUBLIC_API_BASE_URL / NEXT_PUBLIC_COMMIT_SHA
```

## 模块职责

| 模块 | 职责 |
|---|---|
| `app/(auth)/login` | 登录页（client 组件） |
| `app/(dashboard)/layout.tsx` | 主壳层，挂 AppShell，承载所有登录后路由 |
| `app/(dashboard)/admin/*` | 组织 / 用户 / 角色权限管理（独立 layout + 权限菜单） |
| `app/(dashboard)/ppm/*` | PPM 项目管理全功能（项目 / 计划 / 节点 / 任务 / 里程碑 / 问题 / 看板 / 工时 / 客户），当前最大业务域，16 个子路由 |
| `app/(dashboard)/workspaces/[id]/*` | 工作区详情，15 个子路由（agent / 审批 / 审计 / 变更 / 组件拓扑 / 事件 / 知识 / 成员 / 任务 / 发布 / 运行时 / 扫描文档） |
| `app/(dashboard)/settings/*` | 个人设置 / API Key / Git 身份 |
| `app/(dashboard)/runtimes` | 运行时健康展示 |
| `app/api/**/stream/route.ts` | 3 个 SSE 透传 Route Handler，统一 `text/event-stream`，解析 `INTERNAL_API_BASE_URL`/`NEXT_PUBLIC_API_BASE_URL` |
| `components/ui/` | shadcn 原子控件（与 antd 业务组件并存） |
| `components/layout/` | 通用页面骨架（page-container / data-table / form-layout 等） |
| `components/charts/` | ECharts 图表封装（成本柱状 / 工时柱状 / 工时饼图） |
| `components/agent-log/` | agent 执行日志的解析（normalize）+ 工具调用渲染 |
| `components/daemon/` | daemon 交互式会话面板 + runtime session 对话框（权限审批、流式输出） |
| `components/permissions/` | 会话级权限面板 |
| `components/ppm-*.tsx` / `admin-*.tsx` / `workspace-*.tsx` | 三大业务域的业务组件 |
| `lib/api.ts` | 唯一对外网关：`apiFetch` + Token 注入 + 401 自动 refresh |
| `lib/agent-stream.ts` | SSE 客户端消费层（AgentRunStreamClient） |
| `lib/ppm/` | PPM 领域类型、聚合、看板分组、导出、格式化、工作日计算 |
| `lib/admin.ts` / `permission.ts` / `menu-permissions.ts` | 权限 / 菜单模型 |
| `stores/session.ts` | 登录态（用户、token，Zustand） |
| `stores/kanban.ts` | 看板视图状态 + 任务 CRUD（Zustand） |
| `styles/` | 设计 token（tokens.ts）+ cssVars + Inter 字体 |
| `test/setup.ts` | vitest 全局 setup（jest-dom 匹配器、jsdom） |
