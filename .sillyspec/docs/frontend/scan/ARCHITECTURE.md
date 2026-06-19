---
author: qinyi
created_at: 2026-06-19 12:50:59
source_commit: 0303536
updated_at: 2026-06-19T04:50:59Z
generator: sillyspec-scan
---

# frontend 架构扫描

> 范围：`frontend/src/`，基于 grep/glob 事实采集。覆盖旧版文档。

## 技术栈

- **运行时/框架**：Next.js 14.2.5（App Router / RSC），React 18.3.1，TypeScript strict（`noUncheckedIndexedAccess`，target ES2022）
- **UI 双栈**：
  - Ant Design 6.4.4 + `@ant-design/icons` + `@ant-design/nextjs-registry`（业务主 UI 库，通过 `components/antd-providers.tsx` 注入）
  - shadcn/ui（`components.json`: style=default, rsc=true, baseColor=slate, cssVariables=true），落地产物 `components/ui/{button,badge,input}.tsx`
- **样式**：Tailwind 3.4.7 + tailwindcss-animate + lucide-react 图标；`cn()` 合并工具在 `lib/utils.ts`
- **客户端状态**：Zustand 4.5（`stores/session.ts` 用 `create` + `persist` 中间件管理会话/Token）
- **可视化**：`@xyflow/react` 12（ReactFlow），仅用于 `workspaces/[id]/components/topology` 拓扑图
- **Markdown**：`@uiw/react-markdown-preview`（agent 日志、文档渲染）
- **流式集成**：原生 `fetch` + `ReadableStream` + `TextDecoder` 消费 SSE，无 EventSource
- **构建**：`next build`（可选 `NEXT_BUILD_STANDALONE=1` standalone 输出）；`/api/*` rewrites 代理到 backend（默认 http://localhost:8000）
- **测试**：vitest 2 + jsdom + @testing-library/react + jest-dom（setup `src/test/setup.ts`）

## 架构概览

### 分层

```
src/
├── app/              Next.js App Router（RSC + Route Handler）
│   ├── (auth)/login  登录页（"use client"）
│   ├── (dashboard)/  主壳层（admin / settings / workspaces / runtimes）
│   └── api/          Route Handler（SSE 透传 + 边缘代理）
├── components/       UI 组件（antd 业务组件 + ui/ shadcn 原子件 + agent-log / daemon 模块）
├── lib/              业务逻辑/数据访问层（api.ts 网关 + 各领域 client + zod 类型）
├── stores/           Zustand store（session）
└── test/             vitest setup
```

### App Router 路由分组

- 路由组：`(auth)` / `(dashboard)`，URL 不含分组名
- 4 个 `layout.tsx`：根 layout、`(dashboard)` layout、`(dashboard)/admin` layout、`workspaces/[id]` layout（嵌套工作区壳）
- 27 个 `page.tsx`，按 `workspaces/[id]/{agent, changes, components, releases, runtime, members, knowledge, incidents, approvals, audit, scan-docs, create-change}` 等组织

### 数据流

- **统一网关**：`lib/api.ts` 暴露 `apiFetch()`，封装 `/api/*` rewrite 代理调用、401 自动刷新（`/api/auth/refresh`）、Token 注入
- **领域 client**：`lib/{auth, workspaces, changes, tasks, agent, agent-stream, daemon, admin, releases, runtime, audit, approvals, ...}.ts`，每个领域一个薄 client（fetch + zod 类型），无 React Query 缓存层
- **流式 SSE**：`lib/agent-stream.ts` / `lib/daemon.ts` 通过 `fetch` + `getReader()` + `TextDecoder` 消费 SSE，对应 3 个 Route Handler 透传：
  - `api/workspaces/[workspaceId]/agent/runs/[runId]/stream/route.ts`
  - `api/daemon-chat/[runId]/stream/route.ts`
  - `api/daemon/sessions/[sessionId]/stream/route.ts`
  - 三者统一转发 `Accept: text/event-stream`、`Content-Type: text/event-stream`，透传 backend body
- **会话**：`stores/session.ts` 用 Zustand + `persist`（localStorage）保存 `SessionUser` / `SessionTokens`

### 组件组织

- `components/app-shell.tsx`：dashboard 壳层（菜单/权限/布局）
- `components/antd-providers.tsx`：antd Next.js registry 注入
- `components/agent-log/`：agent 执行日志渲染（`normalize.ts` SSE 解析、`tool-renderers.tsx` 工具调用渲染、`types.ts`）
- `components/daemon/`：daemon 交互式会话面板（`interactive-session-panel.tsx`）
- `components/ui/`：shadcn 原子件（button / badge / input）

### Server / Client 边界

- 大量页面顶部 `"use client"`（51 处），RSC 主要用于根 layout（`metadata` 导出）和 Route Handler
- Route Handler 统一声明 `export const runtime = "nodejs"`、`export const dynamic = "force-dynamic"`
