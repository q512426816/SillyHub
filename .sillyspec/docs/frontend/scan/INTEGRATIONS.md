---
source_commit: fcbf3fa7
updated_at: 2026-06-22T18:12:36Z
generator: sillyspec-scan
author: qinyi
created_at: 2026-06-23 02:12:36
---

# frontend 集成扫描

> 基于 `frontend/src/` grep 摘录，覆盖旧版文档。按类型分组。

## 后端 REST API（backend FastAPI）

- **统一出口**：`lib/api.ts` → `apiFetch<T>(path, init)`，所有调用走 Next.js rewrite 代理 `/api/*` → backend（默认 `http://localhost:8000`）；`getApiBaseUrl()` / `getDirectApiBaseUrl()` 解析 `INTERNAL_API_BASE_URL`（server 端优先）与 `NEXT_PUBLIC_API_BASE_URL`（浏览器）。
- **认证**：
  - `POST /api/auth/login` / `POST /api/auth/refresh` / `GET /api/auth/me` / `POST /api/auth/logout`（`lib/auth.ts`）
  - `GET|POST|DELETE /api/auth/api-keys`（`lib/api-keys.ts`）
  - `apiFetch` 内部捕获 401 → 自动 `POST /api/auth/refresh` → 重新发起原请求
- **业务 REST 端点**（按领域，对应 `lib/*.ts` client）：
  - 工作区：`/api/workspaces/*`、spec-bootstrap（`lib/workspaces.ts`、`lib/spec-workspaces.ts`、`lib/workspace-members.ts`、`lib/workspace-path.ts`）
  - Agent：`/api/workspaces/{id}/agent/runs/...`（`lib/agent.ts`）
  - 审批：`/api/workspaces/{id}/approvals/*`（`lib/approvals.ts`）
  - 审计：`/api/workspaces/{id}/audit`（`lib/audit.ts`）
  - Git：`/api/git/identities`（`lib/git-identities.ts`）、git-gateway（`lib/git-gateway.ts`）
  - daemon：`/api/daemon/sessions/*`（`lib/daemon.ts`）
  - 健康：`/api/health`（`lib/health.ts`）
  - 运行时 / 发布 / 知识 / 事件 / 任务 / 组件 / 工具网关（`lib/{runtime,releases,knowledge,incidents,tasks,components,tool-gateway}.ts`）
  - PPM：项目 / 计划 / 任务 / 问题 / 看板 / 工时 / 客户（`lib/ppm/*`）

## SSE 流式（日志/会话流）

- **浏览器端消费**：`lib/agent-stream.ts` 的 `AgentRunStreamClient` 用 `new EventSource(url)` 订阅；`lib/use-agent-run-stream.ts` 的 `useAgentRunStream` hook 把事件转换为 React 状态（logs / status / perms / pending_input）。
- **服务端透传（3 个 Route Handler）**，统一返回 `Content-Type: text/event-stream`：
  - `app/api/workspaces/[workspaceId]/agent/runs/[runId]/stream/route.ts` → agent-run 日志流
  - `app/api/daemon-chat/[runId]/stream/route.ts` → daemon-chat 流
  - `app/api/daemon/sessions/[sessionId]/stream/route.ts` → daemon session 流
- grep 命中消费 SSE 的文件：`agent-run-panel.tsx`、`interactive-session-panel.tsx`、`session-permission-panel.tsx`、`runtimes/page.test.tsx`、`daemon.ts`、`agent-stream.ts`、`use-agent-run-stream.ts`、`api.ts` 等。

## WebSocket

- `lib/daemon.ts` 中存在少量 WebSocket 相关逻辑用于与 daemon 的双向交互（grep `new WebSocket` / `WebSocket` 命中 daemon 相关文件）；主要数据通道仍以 REST + SSE 为主。

## 第三方 UI / 可视化库

- **Ant Design 6.4.4**（业务主库）：`@ant-design/nextjs-registry` 注入（`components/antd-providers.tsx`），`@ant-design/icons` 图标，覆盖大部分表单、表格、Drawer、Dialog、Tree。
- **shadcn/ui + Radix**：`@radix-ui/react-{avatar,dialog,dropdown-menu,tooltip}`，落地 `components/ui/*.tsx`；`cn()`（clsx + tailwind-merge）合并类名，`class-variance-authority` 驱动 variants。
- **图表**：ECharts 6（`echarts` + `echarts-for-react`）→ `components/charts/{ProjectPlanCostBarChart,WorkHourBarChart,WorkHourPieChart}.tsx`。
- **流程图**：`@xyflow/react` 12（ReactFlow），拓扑 / 节点可视化。
- **Markdown**：`@uiw/react-markdown-preview`（agent 日志、文档渲染）。
- **图标**：`lucide-react`（shadcn 默认）+ `@ant-design/icons`。
- **日期**：dayjs。
- **校验/组合**：zod（运行时校验）+ clsx + tailwind-merge。

## 构建部署

- **Next.js 构建**：`next build`，`next.config.mjs` 开启 `experimental.typedRoutes` + `reactStrictMode`；`NEXT_BUILD_STANDALONE=1` 切换 standalone 输出。
- **运行时变量**：`NEXT_PUBLIC_API_BASE_URL`、`INTERNAL_API_BASE_URL`（server 端代理优先）、`NEXT_BUILD_STANDALONE`、`NEXT_PUBLIC_COMMIT_SHA`。
- **API 代理**：`next.config.mjs` rewrites `/api/:path*` → backend（依赖 Next server / standalone / 反代；纯静态导出场景失效——见 CONCERNS）。
- **Docker**：`frontend/Dockerfile` 构建生产镜像（standalone 模式）。
- **包管理**：pnpm 9.6.0（`pnpm-lock.yaml`；另有遗留 `package-lock.json`）。
