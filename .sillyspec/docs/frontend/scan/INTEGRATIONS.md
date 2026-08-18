---
author: qinyi
created_at: 2026-08-18 01:06:26
source_commit: 744e3de4
updated_at: 2026-08-17T17:06:26Z
generator: sillyspec-scan
---

# 集成（Integrations）

frontend 子项目第三方依赖事实源为 `frontend/package.json`（pnpm@9.6.0，node≥20），下文版本号取自该文件；每个集成点均标注依据文件（已逐一核实存在）。本文覆盖旧版（6e78b29a）扫描结果；重大变化：SSE 消费已从浏览器 EventSource 迁移到 `fetch-sse.ts`（token 走 Authorization header）、新增 `@tanstack/react-virtual` / `rehype-sanitize` 依赖、`api-types.ts` 增至 32857 行。

## 1. 核心框架（Next.js · React）

- `next@14.2.5`：App Router 模式。`next.config.mjs` 启用 `experimental.typedRoutes` 与 `optimizePackageImports`（对 antd / @ant-design/icons / lucide-react / @xyflow/react 按需转换减小 chunk）；`reactStrictMode: true`、`poweredByHeader: false`；`NEXT_BUILD_STANDALONE=1` 切 `output: "standalone"`（见 `frontend/Dockerfile`）。
- **Next middleware（服务端 UA 分流）**：`src/middleware.ts` 按移动 UA 把 `/ppm/*`、`/workspaces/*`、`/login` rewrite 到 `/m/*` 移动路由段（rewrite 不改地址栏）；平板（iPad / Android 平板）显式走桌面；配 `src/middleware.test.ts`。
- `react@18.3.1` / `react-dom@18.3.1`。

## 2. UI 组件体系（antd · Tailwind · Radix · shadcn）

- `antd@^6.4.4` + `@ant-design/icons@^6.2.5` + `@ant-design/nextjs-registry@^1.3.0`：主组件库。`AntdRegistry` 在 `src/app/layout.tsx`（及 `src/app/global-error.tsx`）注入；`src/components/antd-providers.tsx` 用 ConfigProvider 设 locale/主题。
- `tailwindcss@3.4.7` + `tailwind-merge@^2.4.0` + `tailwindcss-animate@^1.0.7` + `postcss@8.4.40` + `autoprefixer@10.4.19`：原子化样式（`tailwind.config.ts` darkMode class + 语义色，`postcss.config.mjs`）。
- `@radix-ui/react-avatar@^1.1.0` / `@radix-ui/react-dialog@^1.1.2` / `@radix-ui/react-dropdown-menu@^2.1.2`：无头原语，落地 `src/components/ui/{avatar,dialog,dropdown-menu}.tsx`。
- `class-variance-authority@^0.7.0` + `clsx@^2.1.1`：shadcn 变体与类名拼接（`frontend/components.json` + `src/lib/utils.ts` 的 `cn()`）。
- `lucide-react@^0.400.0`：图标（shadcn 默认，全站通用）。
- `@fontsource/inter@^5.2.8`：Inter 字体（`src/styles/fonts.ts`）。
- `@uiw/react-markdown-preview@^5.2.1` + `rehype-sanitize@^6.0.0`：Markdown 渲染 + XSS 消毒（`src/components/ui/markdown-text.tsx`，用于 scan-docs、会话消息等）。

## 3. 数据与状态（react-query · zustand · zod）

- `@tanstack/react-query@^5.51.0`（dev 挂 `@tanstack/react-query-devtools`）：服务端状态。`src/lib/query-client.ts` 的 `makeQueryClient()` 工厂（staleTime 15s、5xx 才 retry）由 `src/lib/providers.tsx` 实例化挂 Provider；query key 工厂在 `src/lib/query-keys.ts`，各业务 hook 与页面直接消费。
- `@tanstack/react-virtual@^3.14.9`：长会话列表虚拟滚动（`src/components/sessions/session-list-panel.tsx`）。
- `zustand@^4.5.0`：本地状态（`src/stores/session.ts`、`src/stores/kanban.ts`、`src/stores/workspace.ts`，persist 到 localStorage）。
- `zod@^3.23.0`：运行时数据校验。`dayjs@^1.11.21`：日期处理（PPM 格式化、antd locale）。

## 4. 可视化（echarts · xyflow）

- `echarts@^6.1.0` + `echarts-for-react@^3.0.6`：图表。依据：`src/components/charts/{RuntimeUsageLineChart,WorkHourBarChart,WorkHourPieChart}.tsx`、`src/lib/ppm/aggregations.ts`；PPM 看板甘特图在 `src/app/(dashboard)/ppm/kanban/_components/`。
- `@xyflow/react@^12.10.2`：工作空间组件拓扑图（`src/app/(dashboard)/workspaces/[id]/components/topology/page.tsx`，唯一使用处）。

## 5. 后端 API 集成（FastAPI backend，经 Next.js rewrite 代理）

- **代理层**：`next.config.mjs` 的 `rewrites()` 把 `/api/:path*` 与 `/daemon/:path*`（daemon 公开分发端点 install.sh / latest.json / sillyhub-daemon.js / mcp-server.js，由 backend dist_router 提供）代理到 `${INTERNAL_API_BASE_URL ?? NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000"}`。
- **统一 fetch 客户端**：`src/lib/api.ts` 的 `apiFetch`。浏览器侧用相对 URL 经 `window.location.origin` 走 Next rewrite（任意域名/frp 隧道可达），server 侧用 `SERVER_API_BASE_URL`；每请求带 `x-request-id` 头（日志关联）、登录态注入 `Authorization: Bearer`；抛结构化 `ApiError`（code/status/requestId/details）；401 时经 `src/lib/token-refresh.ts` 刷新后重试，失败跳登录。
- **OpenAPI 类型契约**：`scripts/gen-api-types.mjs` + `openapi-typescript@^7.13.0` 生成 `src/lib/api-types.ts`（32857 行，前后端契约事实源）；`pnpm gen:types` 生成、`pnpm gen:types:check` 用 `git diff --exit-code` 校验未漂移。后端 schema 改动必须同 change 重新生成提交。
- **业务 API 封装**：分散在 `src/lib/*.ts`（daemon、workspaces、changes、tasks、agent、agent-profiles、mcp-tokens、admin、runtime、approvals、releases、knowledge、incidents、audit、quicklog 等）及 `src/lib/ppm/*`、`src/lib/file/api.ts`、`src/lib/api/llm-providers.ts`。

## 6. 实时通道（SSE，fetch 流式 —— 非浏览器 EventSource）

- **SSE 订阅内核**：`src/lib/fetch-sse.ts` 的 `fetchSse()` —— 用 fetch + ReadableStream 手解析 `text/event-stream` 的 EventSource 替代品。存在理由：浏览器 EventSource 无法自定义请求头，token 拼进 URL query 会被访问日志明文记录；本 helper 把 JWT 放 `Authorization: Bearer` header。接口形状对齐 EventSource（onopen/onmessage/onerror/readyState/close），**有意不做自动重连**，断流由调用方处理。配 `src/lib/__tests__/fetch-sse.test.ts`。
- **消费点**（grep 核实）：
  - `src/lib/agent-stream.ts`（AgentRunStreamClient，Agent 执行流）→ `src/lib/use-agent-run-stream.ts` hook → agent-run-panel 等组件；
  - `src/lib/daemon.ts`（daemon 会话流 + permission_request 权限通道，两处 fetchSse 调用）→ `src/components/daemon/interactive-session-panel.tsx`、`src/components/permissions/session-permission-panel.tsx`；
  - `src/lib/spec-workspaces.ts`（「从仓库导入」POST /import 的 SSE 阶段进度流，fetch+ReadableStream 自解析 packing/packed/applying 事件）。
- **Next.js Route Handler SSE 中继**（`src/app/api/`，3 个 route.ts，`Content-Type: text/event-stream` 透传到 backend daemon）：
  - `src/app/api/daemon-chat/[runId]/stream/route.ts`
  - `src/app/api/daemon/sessions/[sessionId]/stream/route.ts`（+ 同级 `__tests__/route.test.ts`）
  - `src/app/api/workspaces/[workspaceId]/agent/runs/[runId]/stream/route.ts`

## 7. 测试与工具链

- `vitest@^2.0.0` + `@vitejs/plugin-react@^4.3.1` + `jsdom@^24.1.3`：单测（`vitest.config.ts`：jsdom + globals + `@` alias + `src/test/setup.ts`；`clearMocks: true`、testTimeout 15s、纯逻辑测试按 `environmentMatchGlobs` 白名单切 node 环境省 jsdom 启动）。tsconfig `types: ["vitest/globals", "@testing-library/jest-dom"]`。
- `@testing-library/react@^16.0.0` + `@testing-library/jest-dom@^6.4.6`：DOM 断言。各组件/页面配 `__tests__/` 或同级 `.test.tsx`。
- `@playwright/test@^1.60.0`：E2E。`puppeteer@^24.43.1`：浏览器自动化（抓取/校验场景）。
- `typescript@5.5.4`（`pnpm typecheck` = `tsc --noEmit`）+ `eslint@8.57.0` + `eslint-config-next@14.2.5`（`pnpm lint` = `next lint`，`frontend/.eslintrc.json`）。
- `@types/node@20.14.0` / `@types/react@18.3.3` / `@types/react-dom@18.3.0`。

## 8. 环境变量（外部资源接入面）

依据 `frontend/.env.example` 与源码：`NEXT_PUBLIC_API_BASE_URL`（浏览器侧 API 基址默认值，默认 `http://localhost:8000`）、`INTERNAL_API_BASE_URL`（server 侧 rewrite 与直连 fetch 优先）、`NEXT_BUILD_STANDALONE`（切 standalone 输出）、`NEXT_PUBLIC_COMMIT_SHA`（构建注入的版本标识）。API 代理依赖 Next server / standalone / 反代运行，纯静态导出场景失效。
