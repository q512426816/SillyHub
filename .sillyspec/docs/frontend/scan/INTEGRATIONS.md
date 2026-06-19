---
author: qinyi
created_at: 2026-06-19 12:50:59
source_commit: 0303536
updated_at: 2026-06-19T04:50:59Z
generator: sillyspec-scan
---

# frontend 集成扫描

> 基于 `frontend/src/` grep 摘录，覆盖旧版文档。按类型分组。

## 后端 API（REST）

- **统一出口**：`lib/api.ts` → `apiFetch<T>(path, init)`，所有调用走 Next.js rewrite 代理 `/api/*` → backend（默认 `http://localhost:8000`）
- **认证**：
  - `POST /api/auth/login` / `POST /api/auth/refresh` / `GET /api/auth/me` / `POST /api/auth/logout`（`lib/auth.ts`）
  - `GET|POST|DELETE /api/auth/api-keys`（`lib/api-keys.ts`）
  - `apiFetch` 自动捕获 401 → 重放 `POST /api/auth/refresh` → 重新发起原请求
- **业务 REST 端点**（按领域）：
  - 工作区：`/api/workspaces/*`、`/api/workspaces/{id}/spec-bootstrap`（`lib/workspaces.ts`、`lib/spec-workspaces.ts`）
  - 变更：`/api/workspaces/{id}/changes/create`、`/changes/{cid}/documents/batch-generate`、`/changes/{cid}/archive`、`/changes/{cid}/distill`（`lib/change-writer.ts`、`lib/archive.ts`）
  - 审批：`/api/workspaces/{id}/approvals/{pending,history,{id}/{approve,reject}}`（`lib/approvals.ts`）
  - 审计：`/api/workspaces/{id}/audit`（`lib/audit.ts`）
  - Git：`/api/git/identities`（`lib/git-identities.ts`）
  - 健康：`/api/health`（`lib/health.ts`）
  - 运行时 / 发布 / 知识 / 事件 / 任务 / 组件 等（对应 `lib/*.ts`）

## SSE 流式

- **客户端消费**：原生 `fetch` + `Response.body.getReader()` + `TextDecoder` 解析 SSE（无 EventSource），grep 命中 18 文件 / 120 处（`lib/agent-stream.ts`、`lib/daemon.ts`、`lib/agent.ts`、`components/daemon/interactive-session-panel.tsx`、`components/agent-log/normalize.ts` 等）
- **服务端透传（3 个 Route Handler）**：
  - `app/api/workspaces/[workspaceId]/agent/runs/[runId]/stream/route.ts` → `GET` 透传 backend agent run 流
  - `app/api/daemon-chat/[runId]/stream/route.ts` → `GET` 透传 daemon chat 流
  - `app/api/daemon/sessions/[sessionId]/stream/route.ts` → `GET` 透传 daemon session 流（带 `Accept: text/event-stream`、`Content-Type: text/event-stream`）
- 透传统一返回 `new Response(backendResp.body, { headers: { "Content-Type": "text/event-stream" } })`

## UI 组件库（双栈）

- **Ant Design 6.4.4**（业务主库）：通过 `components/antd-providers.tsx` 用 `@ant-design/nextjs-registry` 注入；50+ 文件 `from "antd"` / `@ant-design/icons`，覆盖大部分表单、表格、Drawer、Dialog
- **shadcn/ui**（原子补充）：`components.json`（style=default, rsc=true, baseColor=slate, cssVariables=true），落地 `components/ui/{button,badge,input}.tsx`，配合 `lib/utils.ts` 的 `cn()`（clsx + tailwind-merge）和 `class-variance-authority`
- **图标**：`lucide-react`（shadcn 默认）+ `@ant-design/icons`

## 可视化

- **ReactFlow**（`@xyflow/react` 12）：仅 `app/(dashboard)/workspaces/[id]/components/topology/page.tsx` 使用，渲染组件依赖拓扑图（grep 仅 1 文件命中 `ReactFlow`/`useNodesState`/`useEdgesState`）

## Markdown 渲染

- **`@uiw/react-markdown-preview`**：用于 agent 日志输出、扫描文档等富文本展示

## 构建部署

- **Next.js 构建**：`next build`，`next.config.mjs` 开启 `experimental.typedRoutes`；`NEXT_BUILD_STANDALONE=1` 切换 standalone 输出
- **运行时变量**：`NEXT_PUBLIC_API_BASE_URL`、`NEXT_PUBLIC_COMMIT_SHA`
- **API 代理**：`next.config.mjs` rewrites `/api/*` → backend（**仅 dev / Node runtime 生效**，纯静态导出场景不生效——见 CONCERNS）
- **Docker**：`frontend/Dockerfile` 构建生产镜像（standalone 模式）
- **包管理**：pnpm（`pnpm-lock.yaml`，另有遗留 `package-lock.json`）
