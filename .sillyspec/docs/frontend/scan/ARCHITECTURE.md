---
source_commit: fcbf3fa7
updated_at: 2026-06-22T18:12:36Z
generator: sillyspec-scan
author: qinyi
created_at: 2026-06-23 02:12:36
---

# frontend 架构

> 范围：`frontend/src/`，基于 grep/glob 事实采集。覆盖旧版文档。

## 技术栈

- **运行时/框架**：Next.js 14.2.5（App Router，Server + Client Components 混合），React 18.3.1，TypeScript strict（`noUncheckedIndexedAccess`，target ES2022）
- **UI 双栈**：
  - Ant Design 6.4.4 + `@ant-design/icons` + `@ant-design/nextjs-registry`（业务主 UI 库，`components/antd-providers.tsx` 注入）
  - shadcn/ui（`components.json`: style=default, rsc=true, baseColor=slate, cssVariables=true）+ Radix primitives，落地 `components/ui/{button,card,dialog,input,badge,tooltip,avatar,dropdown-menu,...}.tsx`
- **样式**：Tailwind 3.4.7 + tailwindcss-animate + lucide-react；`cn()` 合并工具在 `lib/utils.ts`；`darkMode: ["class"]`，HSL CSS 变量主题
- **客户端状态**：Zustand 4.5（`stores/session.ts` 会话/Token、`stores/kanban.ts` 看板视图）
- **服务端数据**：TanStack React Query 5.51（`@tanstack/react-query`，缓存与失效）
- **可视化**：ECharts 6（`charts/` 三图：ProjectPlanCostBarChart / WorkHourBarChart / WorkHourPieChart）、`@xyflow/react` 12（流程图）
- **Markdown**：`@uiw/react-markdown-preview`（agent 日志、文档渲染）
- **流式集成**：`EventSource`（`lib/agent-stream.ts` 的 `AgentRunStreamClient`），3 个 Route Handler 透传 backend SSE
- **构建**：`next build`（可选 `NEXT_BUILD_STANDALONE=1` standalone）；`next.config.mjs` rewrites `/api/*` → backend（默认 `http://localhost:8000`）
- **测试**：vitest 2 + jsdom + @testing-library/react + jest-dom（setup `src/test/setup.ts`）

## 架构概览

### 分层

```
src/
├── app/            Next.js App Router（路由组 + API 代理 route handlers）
│   ├── layout.tsx / page.tsx / globals.css   根布局 + 首页 + 全局样式
│   ├── (auth)/login/                         登录页
│   ├── (dashboard)/                          仪表盘壳层（layout.tsx 包裹）
│   │   ├── admin/{organizations,roles,users} 管理后台（独立 layout）
│   │   ├── ppm/                              PPM 项目管理（最大业务模块，14+ 子路由）
│   │   ├── settings/{api-keys,git-identities} 个人设置
│   │   ├── workspaces/ + [id]/               工作区列表 + 详情
│   │   └── runtimes/                         运行时健康
│   └── api/                                  Next route handlers（SSE 代理）
│       ├── workspaces/[wid]/agent/runs/[rid]/stream/
│       ├── daemon-chat/[runId]/stream/
│       └── daemon/sessions/[sessionId]/stream/
├── components/     UI 组件（按功能聚合，不按技术分）
│   ├── ui/                        shadcn 基础件（button/dialog/card/badge/input/tooltip/...）
│   ├── layout/                    page-container / page-header / data-table / form-layout / section-card / search-bar
│   ├── charts/                    ECharts 图表封装（bar/pie）
│   ├── agent-log/                 日志归一化（normalize.ts）+ 工具调用渲染（tool-renderers.tsx）
│   ├── daemon/                    交互式会话面板
│   ├── permissions/               会话级权限面板
│   └── ppm-*.tsx / workspace-*.tsx / admin-*.tsx / permission-approval-*.tsx  业务组件
├── lib/            数据层 + hooks + 工具
│   ├── api.ts                     apiFetch / getApiBaseUrl（统一 fetch 包装）
│   ├── agent.ts / daemon.ts / approvals.ts / workspaces.ts / ppm/   各业务 API 客户端
│   ├── agent-stream.ts            AgentRunStreamClient（封装 EventSource）
│   ├── use-agent-run-stream.ts    useAgentRunStream hook（SSE 订阅 + 状态机 + cancelled flag）
│   └── *.ts                       其余领域类型 / 工具（format-token / client-path / ...）
├── stores/         Zustand stores（session.ts / kanban.ts）
├── styles/         全局样式
└── test/setup.ts   vitest setup（jest-dom）
```

### App Router 路由分组

- 路由组：`(auth)` / `(dashboard)`，URL 不含分组名
- 顶层页面聚合在 `(dashboard)` 下：admin / ppm / settings / workspaces / runtimes
- PPM 是当前最大业务域，含 projects / project-plans / plan-nodes / task-plans / task-execute / milestone-details / problem-list / problem-changes / project-members / project-stakeholders / kanban / work-hours / work-hour-statistics / customers

### 通信模型

- **REST**：`lib/api.ts` 的 `apiFetch()` 统一包装 fetch，前缀 `/api/*`。Next.js `rewrites()` 将 `/api/:path*` 代理到 `INTERNAL_API_BASE_URL`（server 端）或 `NEXT_PUBLIC_API_BASE_URL`（浏览器）→ backend FastAPI。
- **SSE**：三类流（agent-run / daemon-session / daemon-chat），均通过 `src/app/api/**/stream/route.ts` route handler 透传后端 SSE；浏览器端用 `AgentRunStreamClient`（`new EventSource`）订阅；`useAgentRunStream` hook 把事件转换为 `logs / status / perms / pending_input` 状态。
- **Server / Client Component**：默认页面/布局为 Server Component；凡需 hooks、事件、浏览器 API 的组件加 `"use client"`（如 `agent-run-panel.tsx`、`use-agent-run-stream` 消费方）。

### 状态管理边界

- **服务端数据**：React Query（缓存、失效、加载态）。
- **客户端 UI/会话状态**：Zustand（当前 session、看板视图）。
- **流式数据**：由 `useAgentRunStream` 在 hook 内用 `useState` 维护，不进全局 store（避免高频更新触发整树渲染）。
