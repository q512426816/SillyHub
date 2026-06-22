---
source_commit: fcbf3fa7
updated_at: 2026-06-22T18:12:36Z
generator: sillyspec-scan
author: qinyi
created_at: 2026-06-23 02:12:36
---

# frontend 目录结构

> 基于 `frontend/src/` glob 摘录，覆盖旧版文档。

## 目录树

```
frontend/
├── src/
│   ├── app/                      Next.js App Router
│   │   ├── layout.tsx            根 layout（metadata + antd registry）
│   │   ├── page.tsx              首页
│   │   ├── globals.css           Tailwind + shadcn CSS variables
│   │   ├── favicon.ico
│   │   ├── (auth)/login/         登录页（client）
│   │   ├── (dashboard)/
│   │   │   ├── layout.tsx        主壳层（AppShell）
│   │   │   ├── admin/            管理后台（独立 layout）
│   │   │   │   ├── layout.tsx
│   │   │   │   ├── organizations/    组织树
│   │   │   │   ├── roles/            角色权限
│   │   │   │   └── users/            用户管理
│   │   │   ├── ppm/              PPM 项目管理（最大业务域）
│   │   │   │   ├── page.tsx          PPM 首页
│   │   │   │   ├── shared.tsx        共享工具
│   │   │   │   ├── projects/         项目
│   │   │   │   ├── project-plans/    项目计划
│   │   │   │   ├── plan-nodes/       计划节点
│   │   │   │   ├── task-plans/       任务计划
│   │   │   │   ├── task-execute/     任务执行
│   │   │   │   ├── milestone-details/ 里程碑详情
│   │   │   │   ├── problem-list/     问题列表
│   │   │   │   ├── problem-changes/  问题变更
│   │   │   │   ├── project-members/  项目成员
│   │   │   │   ├── project-stakeholders/ 干系人
│   │   │   │   ├── customers/        客户
│   │   │   │   ├── kanban/           看板
│   │   │   │   ├── work-hours/       工时
│   │   │   │   └── work-hour-statistics/ 工时统计
│   │   │   ├── settings/
│   │   │   │   ├── page.tsx
│   │   │   │   ├── api-keys/         API Key 管理
│   │   │   │   └── git-identities/   Git 身份
│   │   │   ├── workspaces/
│   │   │   │   ├── page.tsx          工作区列表
│   │   │   │   └── [id]/             工作区详情
│   │   │   └── runtimes/             运行时健康
│   │   └── api/                  Route Handler（SSE 透传）
│   │       ├── workspaces/[workspaceId]/agent/runs/[runId]/stream/
│   │       ├── daemon-chat/[runId]/stream/
│   │       └── daemon/sessions/[sessionId]/stream/
│   ├── components/
│   │   ├── app-shell.tsx                 dashboard 壳层
│   │   ├── antd-providers.tsx            antd registry
│   │   ├── ui/                           shadcn 基础件（button/card/dialog/input/badge/tooltip/avatar/dropdown-menu/empty-state/skeleton/status-badge/tag）
│   │   ├── layout/                       page-container / page-header / data-table / form-layout / section-card / search-bar
│   │   ├── charts/                       ProjectPlanCostBarChart / WorkHourBarChart / WorkHourPieChart
│   │   ├── agent-log/                    normalize.ts / tool-renderers.tsx / types.ts
│   │   ├── daemon/                       interactive-session-panel.tsx
│   │   ├── permissions/                  session-permission-panel.tsx
│   │   ├── admin-*.tsx / workspace-*.tsx / ppm-*.tsx  业务组件
│   │   ├── agent-run-panel.tsx / agent-log-viewer.tsx
│   │   ├── permission-approval-{card,dialog}.tsx
│   │   ├── api-key-create-dialog.tsx / daemon-dir-browser.tsx
│   │   ├── sillyspec-step-progress.tsx / health-card.tsx / server-status-card.tsx
│   │   ├── component-detail-drawer.tsx / mission-console.tsx / top-bar.tsx / error-boundary.tsx
│   │   ├── AgentModelInput.tsx / AgentProviderSelect.tsx
│   │   └── __tests__/                    组件测试
│   ├── lib/                      数据层 + hooks + 工具
│   │   ├── api.ts                网关（apiFetch / getApiBaseUrl）
│   │   ├── agent.ts / agent-stream.ts / use-agent-run-stream.ts
│   │   ├── daemon.ts（+ daemon-permission / daemon-session，见 tests）
│   │   ├── approvals.ts / audit.ts / auth.ts / settings.ts / api-keys.ts
│   │   ├── workspaces.ts / workspace-members.ts / workspace-path.ts / client-path.ts / spec-workspaces.ts
│   │   ├── changes.ts / change-writer.ts / tasks.ts / archive.ts / workflow.ts
│   │   ├── admin.ts / menu-permissions.ts / permission.ts
│   │   ├── releases.ts / runtime.ts / health.ts / incidents.ts / knowledge.ts / components.ts
│   │   ├── git-gateway.ts / tool-gateway.ts / worktree.ts
│   │   ├── scan-docs.ts / status-labels.ts / format-token.ts / utils.ts
│   │   ├── ppm/                 PPM 领域（project / plan / task / problem / kanban / aggregations / export / format / workday / types / index）
│   │   └── __tests__/            领域测试
│   ├── stores/
│   │   ├── session.ts            Zustand 会话 store
│   │   └── kanban.ts             看板视图 store
│   ├── styles/                   全局样式
│   └── test/setup.ts             vitest setup（jest-dom）
├── components.json               shadcn/ui 配置
├── next.config.mjs               rewrites / standalone / typedRoutes
├── tsconfig.json                 strict + noUncheckedIndexedAccess + @/* alias
├── tailwind.config.ts            darkMode class + HSL 语义色
├── postcss.config.mjs / .eslintrc.json
├── vitest.config.ts              jsdom + globals + @ alias + setup
├── Dockerfile                    生产镜像
├── package.json                  pnpm@9.6.0, node>=20
├── pnpm-lock.yaml / package-lock.json（遗留）
└── .env.example
```

## 模块说明

| 模块 | 职责 |
|---|---|
| `app/(dashboard)/ppm/*` | PPM 项目管理全功能（项目 / 计划 / 里程碑 / 任务 / 问题 / 看板 / 工时），当前最大业务域 |
| `app/(dashboard)/admin/*` | 组织 / 用户 / 角色权限管理（独立 layout + 权限菜单） |
| `app/(dashboard)/workspaces/[id]/*` | 工作区详情、agent 执行、成员、scan 等 |
| `app/(dashboard)/settings/*` | 个人设置 / API Key / Git 身份 |
| `app/(dashboard)/runtimes` | 运行时健康展示 |
| `app/api/**/stream/route.ts` | 3 个 SSE 透传 Route Handler，统一 `text/event-stream` |
| `components/ui/` | shadcn 原子控件（与 antd 业务组件并存） |
| `components/layout/` | 通用页面骨架（page-container / data-table / form-layout 等） |
| `components/charts/` | ECharts 图表封装 |
| `components/agent-log/` | agent 执行日志的解析（normalize）+ 工具调用渲染 |
| `components/daemon/` | daemon 交互式会话面板（权限审批、流式输出） |
| `components/permissions/` | 会话级权限面板 |
| `lib/api.ts` | 唯一对外网关：`apiFetch` + Token 注入 |
| `lib/agent-stream.ts` + `use-agent-run-stream.ts` | SSE 客户端消费层 + React hook（含 cancelled race guard） |
| `lib/ppm/` | PPM 领域类型、聚合、导出、格式化 |
| `lib/admin.ts / permission.ts / menu-permissions.ts` | 权限/菜单模型 |
| `stores/session.ts` | 登录态（用户、token） |
| `stores/kanban.ts` | 看板视图状态 |
| `test/setup.ts` | vitest 全局 setup（jest-dom 匹配器、jsdom） |
