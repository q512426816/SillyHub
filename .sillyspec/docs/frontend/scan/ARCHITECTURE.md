---
source_commit: ba87eec
updated_at: 2026-06-23T16:24:24Z
created_at: 2026-06-24T00:24:24
author: qinyi
generator: sillyspec-scan
---

# frontend 架构

> 范围：`frontend/src/`，基于 grep/glob 事实采集。覆盖旧版文档。

## 技术栈

- **运行时/框架**：Next.js 14.2.5（App Router，Server + Client Components 混合），React 18.3.1，TypeScript 5.5.4（target ES2022）
- **UI 双栈**：
  - Ant Design 6.4.4 + `@ant-design/icons` 6.2.5 + `@ant-design/nextjs-registry` 1.3.0（业务主 UI 库，`components/antd-providers.tsx` 为 client，根 `app/layout.tsx` 用 `<AntdRegistry>` 注入）
  - shadcn/ui（`components.json`：style=default, rsc=true, baseColor=slate, cssVariables=true）+ Radix primitives，落地 `components/ui/{button,card,dialog,input,badge,tooltip,avatar,dropdown-menu,tag,skeleton,empty-state,status-badge}.tsx`
- **样式**：Tailwind 3.4.7 + tailwindcss-animate 1.0.7 + lucide-react 0.400；`cn()` 合并工具在 `lib/utils.ts`；`darkMode: ["class"]`，HSL CSS 变量主题，全局样式 `app/globals.css`
- **客户端状态**：Zustand 4.5（`stores/session.ts` 会话/Token `useSession`、`stores/kanban.ts` 看板视图 `useKanbanStore`）
- **服务端数据**：TanStack React Query 5.51（`@tanstack/react-query`，缓存与失效）
- **可视化**：ECharts 6.1（`components/charts/`：`ProjectPlanCostBarChart` / `WorkHourBarChart` / `WorkHourPieChart` + `index.tsx`）、`@xyflow/react` 12.10（组件拓扑图 `workspaces/[id]/components/topology`）
- **Markdown**：`@uiw/react-markdown-preview` 5.2（agent 日志、文档渲染）
- **流式集成**：`EventSource`（`lib/agent-stream.ts` 的 `AgentRunStreamClient`），3 个 Route Handler 透传 backend SSE
- **构建**：`next build`（可选 `NEXT_BUILD_STANDALONE=1` standalone）；`next.config.mjs` `rewrites()` 将 `/api/:path*` 代理到 `INTERNAL_API_BASE_URL ?? NEXT_PUBLIC_API_BASE_URL`（默认 backend `http://localhost:8000`）的 `/api/:path*`
- **测试**：vitest 2 + jsdom 24 + @testing-library/react + jest-dom（setup `src/test/setup.ts`）

## 架构概览

### 分层

```
src/
├── app/            Next.js App Router（路由组 + API 代理 route handlers）
│   ├── layout.tsx / page.tsx / globals.css   根布局（AntdRegistry）+ 首页 + 全局样式
│   ├── (auth)/login/                         登录页
│   ├── (dashboard)/                          仪表盘壳层（layout.tsx 包裹）
│   │   ├── admin/{organizations,roles,users} 管理后台
│   │   ├── ppm/                              PPM 项目管理（最大业务模块，15 子路由）
│   │   ├── settings/{api-keys,git-identities} 个人设置（+ settings 根页）
│   │   ├── workspaces/ + [id]/               工作区列表 + 详情（20 子路由）
│   │   └── runtimes/                         运行时健康
│   └── api/                                  Next route handlers（SSE 代理，3 条）
│       ├── workspaces/[workspaceId]/agent/runs/[runId]/stream/
│       ├── daemon-chat/[runId]/stream/
│       └── daemon/sessions/[sessionId]/stream/
├── components/     UI 组件（按功能聚合，不按技术分）；共 109 个文件声明 "use client"
│   ├── ui/                        shadcn 基础件（12 个：button/card/dialog/input/badge/tooltip/avatar/dropdown-menu/tag/skeleton/empty-state/status-badge）
│   ├── layout/                    page-container / page-header / data-table / form-layout / section-card / search-bar（+ index.ts 桶导出）
│   ├── charts/                    ECharts 图表封装（bar/pie/cost）+ index.ts
│   ├── agent-log/                 日志归一化（normalize.ts）+ 工具调用渲染（tool-renderers.tsx）
│   ├── daemon/                    交互式会话面板
│   ├── permissions/               会话级权限面板
│   └── ppm-*.tsx / workspace-*.tsx / admin-*.tsx / permission-approval-*.tsx  业务组件
├── lib/            数据层 + hooks + 工具（40+ 模块）
│   ├── api.ts                     apiFetch / getApiBaseUrl / getDirectApiBaseUrl / ApiError / safeUUID（统一 fetch 包装）
│   ├── agent.ts / daemon.ts / approvals.ts / workspaces.ts / admin.ts / audit.ts / releases.ts / ...  各业务 API 客户端
│   ├── ppm/                       PPM 领域聚合（types/plan/project/task/problem/kanban/kanban-grouping/aggregations/format/status-label/workday/export）
│   ├── agent-stream.ts            AgentRunStreamClient（封装 EventSource）
│   ├── use-agent-run-stream.ts    useAgentRunStream hook（SSE 订阅 + 状态机 + cancelled flag）
│   ├── utils.ts                   cn() 等工具
│   └── *.ts                       其余领域类型 / 工具（format-token / client-path / scan-docs / change-writer / ...）
├── stores/         Zustand stores（session.ts / kanban.ts）
├── styles/         全局样式
└── test/setup.ts   vitest setup（jest-dom）
```

### App Router 路由分组

- 路由组：`(auth)` / `(dashboard)`，URL 不含分组名
- 顶层页面聚合在 `(dashboard)` 下：admin / ppm / settings / workspaces / runtimes
- **PPM 模块（15 子路由）**：projects / project-plans / plan-nodes / task-plans / task-execute / milestone-details / problem-list / problem-changes / project-members / project-stakeholders / kanban / work-hours / work-hour-statistics / customers（+ 根 page.tsx）
- **workspaces/[id] 详情（20 子路由，含嵌套动态段）**：根 + create-change / releases / scan-docs / missions / changes（含 `[cid]` → tasks → `[tid]` 三级嵌套）/ runtime / agent / components（含 topology）/ audit / knowledge / members / approvals / incidents（含 `[iid]`）
- admin：organizations / roles / users；settings：api-keys / git-identities（+ 根页）

### 通信模型

- **REST**：`lib/api.ts` 的 `apiFetch<T>()` 统一包装 fetch，前缀 `/api/*`；`getApiBaseUrl()` 读 `NEXT_PUBLIC_API_BASE_URL`。Next.js `rewrites()` 将 `/api/:path*` 代理到 backend FastAPI。
- **SSE**：三类流（agent-run / daemon-session / daemon-chat），均通过 `src/app/api/**/stream/route.ts` route handler 透传后端 SSE；浏览器端用 `AgentRunStreamClient`（`new EventSource`）订阅；`useAgentRunStream` hook 把事件转换为 `logs / status / perms / pending_input` 状态。
- **Server / Client Component**：默认页面/布局为 Server Component；凡需 hooks、事件、浏览器 API 的组件加 `"use client"`（当前 109 个 client 组件文件，如 `agent-run-panel.tsx`、`use-agent-run-stream` 消费方、antd-providers、app-shell、top-bar、各业务抽屉/对话框）。antd 经 `AntdRegistry` 包裹于根 layout，避免 Server 端样式闪烁。

### 状态管理边界

- **服务端数据**：React Query（缓存、失效、加载态）。
- **客户端 UI/会话状态**：Zustand（`useSession` 管理当前用户与 Token；`useKanbanStore` 管理看板视图与 `KanbanFilters`）。
- **流式数据**：由 `useAgentRunStream` 在 hook 内用 `useState` 维护，不进全局 store（避免高频 SSE 更新触发整树渲染）。
