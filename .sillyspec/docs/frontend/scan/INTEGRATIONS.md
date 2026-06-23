---
source_commit: ba87eec
updated_at: 2026-06-23T16:24:41Z
created_at: 2026-06-24T00:24:41
author: qinyi
generator: sillyspec-scan
---

# frontend 集成扫描

> 基于 `frontend/src/` grep + package.json 实际扫描，覆盖旧版文档。按类型分组。只写可验证事实。

## 后端 REST API（backend FastAPI，经 Next.js rewrite 代理）

- **统一出口**：`lib/api.ts` → `apiFetch<T>(path, init)`，所有调用走 Next.js rewrite 代理 `/api/*` → backend。
  - `next.config.mjs` 的 `rewrites()` 把 `/api/:path*` 转发到 `${apiBaseUrl}/api/:path*`，`apiBaseUrl` 解析优先级：`INTERNAL_API_BASE_URL`（server 端）→ `NEXT_PUBLIC_API_BASE_URL`（浏览器）→ `http://localhost:8000`。
  - `getApiBaseUrl()` / `getDirectApiBaseUrl()` 同样优先取 `INTERNAL_API_BASE_URL`，浏览器侧要求 `NEXT_PUBLIC_API_BASE_URL` 已设。
- **认证**（`lib/auth.ts`，全部经 `apiFetch`）：
  - `POST /api/auth/login` / `POST /api/auth/refresh` / `GET /api/auth/me`（`apiFetch`）/ `POST /api/auth/logout`（裸 `fetch`）
  - `GET|POST|DELETE /api/auth/api-keys`（`lib/api-keys.ts`）
  - `apiFetch` 内部捕获 401 → 自动 `POST /api/auth/refresh` → 重新发起原请求
- **业务 REST 端点**（按领域，对应 `lib/*.ts` client）：
  - 工作区：`/api/workspaces/*`、spec-bootstrap（`workspaces.ts` / `spec-workspaces.ts` / `workspace-members.ts` / `workspace-path.ts`）
  - Agent：`/api/workspaces/{id}/agent/runs/...`（`agent.ts`）
  - 审批 / 审计：`/api/workspaces/{id}/approvals/*`（`approvals.ts`）、`/api/workspaces/{id}/audit`（`audit.ts`）
  - Git：`/api/git/identities`（`git-identities.ts`）、git-gateway（`git-gateway.ts`）
  - daemon：`/api/daemon/sessions/*`（`daemon.ts`）
  - 健康：`/api/health`（`health.ts`）
  - 运行时 / 发布 / 知识 / 事件 / 任务 / 组件 / 工具网关 / 工作树 / 扫描文档（`runtime.ts` / `releases.ts` / `knowledge.ts` / `incidents.ts` / `tasks.ts` / `components.ts` / `tool-gateway.ts` / `worktree.ts` / `scan-docs.ts`）
  - 管理后台：组织 / 用户 / 角色 / 菜单权限（`admin.ts` / `permission.ts` / `menu-permissions.ts`）
  - 变更流：`changes.ts` / `change-writer.ts` / `archive.ts` / `workflow.ts`
  - PPM：项目 / 计划 / 任务 / 问题 / 看板 / 客户 / 聚合 / 导出（`lib/ppm/*`）

## SSE 流式（日志 / 会话流）

- **浏览器端消费**：`lib/agent-stream.ts` 的 `AgentRunStreamClient` 用 `new EventSource(url)` 订阅；配合 hook 消费层（`use-agent-run-stream`，见 `lib/__tests__/use-agent-run-stream.test.ts`）把事件转 React 状态。
- **服务端透传（3 个 Route Handler）**，统一返回 `Content-Type: text/event-stream`，各自解析 `INTERNAL_API_BASE_URL` / `NEXT_PUBLIC_API_BASE_URL`：
  - `app/api/workspaces/[workspaceId]/agent/runs/[runId]/stream/route.ts` → agent-run 日志流
  - `app/api/daemon-chat/[runId]/stream/route.ts` → daemon-chat 流
  - `app/api/daemon/sessions/[sessionId]/stream/route.ts` → daemon session 流（含 `__tests__/route.test.ts`）
- **消费 SSE 的组件**：`agent-run-panel.tsx`、`components/daemon/interactive-session-panel.tsx`、`components/permissions/session-permission-panel.tsx`、`app/(dashboard)/runtimes/page.test.tsx`。

## WebSocket

- 旧文档提及 `lib/daemon.ts` 存在 WebSocket 相关逻辑。本轮 grep `WebSocket` 在 `src/` 下零命中（`new WebSocket` 未出现）；当前数据通道以 REST + SSE 为主。如需确认历史 WS 代码是否已移除，建议后续 diff 核对。

## 第三方 UI / 可视化库

- **Ant Design 6.4.4**（业务主库）：`@ant-design/nextjs-registry` 的 `AntdRegistry` 在根 `app/layout.tsx` 注入；`components/antd-providers.tsx` 用 `ConfigProvider`（`locale={zhCN}` + 全量 theme + `dayjs.locale("zh-cn")`）；`@ant-design/icons` 6.2.5 提供图标。覆盖表单、表格、Drawer、Dialog、Tree。
- **shadcn/ui + Radix**：`@radix-ui/react-{avatar,dialog,dropdown-menu,tooltip}`，落地 `components/ui/*.tsx`（12 个原子件）；`lib/utils.ts` 的 `cn()`（clsx + tailwind-merge）合并类名，`class-variance-authority` 驱动 variants。
- **图表 ECharts 6**：`echarts` 6.1 + `echarts-for-react` 3.0 → `components/charts/{ProjectPlanCostBarChart,WorkHourBarChart,WorkHourPieChart}.tsx`（PPM 成本 / 工时可视化）；聚合数据由 `lib/ppm/aggregations.ts` 提供。
- **流程图 ReactFlow**：`@xyflow/react` 12.10 → `app/(dashboard)/workspaces/[id]/components/topology/page.tsx`（组件拓扑可视化）。
- **Markdown**：`@uiw/react-markdown-preview` 5.2 → `app/(dashboard)/workspaces/[id]/scan-docs/page.tsx`（扫描文档渲染）。
- **图标**：`lucide-react` 0.400（shadcn 默认）+ `@ant-design/icons`。
- **日期**：`dayjs` 1.11（PPM 格式化、antd locale 等）。
- **字体**：`@fontsource/inter` 5.2 + `styles/fonts.ts` 的 `localFont`。
- **校验 / 组合**：`zod` 3.23（运行时校验，见于 `lib/daemon.ts`）+ `clsx` + `tailwind-merge` + `tailwindcss-animate`。

## 状态管理

- **Zustand 4.5**（已启用）：
  - `stores/session.ts` → `useSession`（登录态：用户、token，66 行）
  - `stores/kanban.ts` → `useKanbanStore`（看板视图状态 + 任务 CRUD，185 行）
- **TanStack Query 5.51**（**已声明依赖但未启用**）：`@tanstack/react-query` 在 `package.json` 中，但 `src/` 下无 `QueryClientProvider`、无 `new QueryClient`、无 `useQuery` 命中；根 layout 仅挂 `AntdRegistry` + `AntdProviders`，无 `providers.tsx`。当前数据获取走 `apiFetch` + 本地 state，非 react-query。

## 构建部署

- **Next.js 构建**：`next build`（next 14.2.5）；`next.config.mjs` 开启 `experimental.typedRoutes` + `reactStrictMode` + `poweredByHeader: false`；`NEXT_BUILD_STANDALONE=1` 切换 `output: "standalone"`。
- **运行时环境变量**（见 `.env.example` + 源码）：
  - `NEXT_PUBLIC_API_BASE_URL`（浏览器侧 API 基址，默认 `http://localhost:8000`）
  - `INTERNAL_API_BASE_URL`（server 端 rewrite / Route Handler 代理优先）
  - `NEXT_BUILD_STANDALONE`（构建输出模式）
  - `NEXT_PUBLIC_COMMIT_SHA`（版本标识）
- **API 代理**：`next.config.mjs` rewrites `/api/:path*` → backend（依赖 Next server / standalone / 反代；纯静态导出场景失效）。
- **Docker**：`frontend/Dockerfile` 构建生产镜像（standalone 模式）。
- **包管理**：pnpm 9.6.0（`pnpm-lock.yaml`；另有遗留 `package-lock.json`），node >= 20。
- **测试**：vitest 2.0（jsdom + globals + `@` alias + `test/setup.ts`），`@testing-library/react` + `@testing-library/jest-dom`；另有 `@playwright/test` 1.60 + `puppeteer` 24.43（E2E / 抓取，devDependency）。
