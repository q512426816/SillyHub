---
author: qinyi
created_at: 2026-07-27 00:35:31
source_commit: 6e78b29a
updated_at: 2026-07-26T16:35:31Z
generator: sillyspec-scan
---

# 集成(Integrations)

frontend 子项目的第三方依赖事实源为 `frontend/package.json`(pnpm@9.6.0,node≥20)。下文按类型分组,所有版本号取自该文件。覆盖旧版扫描结果。

## 1. 核心框架(Next.js · React)

- `next@14.2.5`:App Router 模式。`next.config.mjs` 启用 `experimental.typedRoutes`(类型化路由)与 `optimizePackageImports`(对 antd / @ant-design/icons / lucide-react / @xyflow/react 的命名导入做模块级按需转换,减小 chunk 体积、加速构建);`reactStrictMode: true`、`poweredByHeader: false`。生产构建支持 `NEXT_BUILD_STANDALONE=1` 切 `output: "standalone"`(见 Dockerfile)。
- `react@18.3.1` / `react-dom@18.3.1`。

## 2. UI 组件库(antd · Tailwind · Radix · shadcn)

- `antd@^6.4.4` + `@ant-design/icons@^6.2.5` + `@ant-design/nextjs-registry@^1.3.0`:主组件库;`AntdRegistry` 在根 layout 注入,`src/components/antd-providers.tsx` 用 `ConfigProvider`(locale zhCN + theme + dayjs.locale)。
- `tailwindcss@3.4.7` + `tailwind-merge@^2.4.0` + `tailwindcss-animate@^1.0.7` + `postcss@8.4.40` + `autoprefixer@10.4.19`:原子化样式(`tailwind.config.ts` darkMode class + 语义色,`postcss.config.mjs`)。
- `@radix-ui/react-avatar@^1.1.0`、`@radix-ui/react-dialog@^1.1.2`、`@radix-ui/react-dropdown-menu@^2.1.2`:无头原语,与 shadcn/ui 体系搭配落地 `src/components/ui/*`。
- `class-variance-authority@^0.7.0` + `clsx@^2.1.1`:shadcn 变体与类名拼接(`components.json` + `src/lib/utils.ts` 的 `cn()`)。
- `lucide-react@^0.400.0`:图标(shadcn 默认)。
- `@fontsource/inter@^5.2.8`:Inter 字体(`src/styles/fonts.ts` 的 localFont)。

## 3. 数据 / 状态(react-query · zustand · zod)

- `@tanstack/react-query@^5.51.0`(dev:`@tanstack/react-query-devtools@5.100.14`):**已启用**。`src/lib/query-client.ts` 提供 `makeQueryClient()` 工厂(freshness-first 默认:staleTime 15s、refetchOnWindowFocus 仅对 >15s 数据重取、retry 仅 5xx 最多 3 次、4xx 不重试);由 `src/lib/providers.tsx` 通过 `useState` 初始化器实例化并挂 `QueryClientProvider`。query key 工厂见 `src/lib/query-keys.ts`,各业务 hook(use-agent-runs、use-daemon-runtimes 等)及页面(`runtimes/page.tsx` 等)直接消费 `useQuery` / `useMutation`。
- `zustand@^4.5.0`:本地状态。`src/stores/session.ts`(useSession 登录态)、`src/stores/kanban.ts`(useKanbanStore 看板视图 + 任务 CRUD)、`src/stores/workspace.ts`;配合 persist 中间件做 localStorage 恢复(见 `auth/route-guard.ts` 的 hydrated 守卫)。
- `zod@^3.23.0`:运行时数据校验。
- `dayjs@^1.11.21`:日期处理(PPM 格式化、antd locale 等)。

## 4. 可视化与富文本(echarts · xyflow · markdown)

- `echarts@^6.1.0` + `echarts-for-react@^3.0.6`:图表(`src/components/charts/`:RuntimeUsageLineChart、WorkHourBarChart、WorkHourPieChart;PPM 看板甘特图在 `app/(dashboard)/ppm/kanban/_components/`)。聚合数据由 `lib/ppm/aggregations.ts` 提供。
- `@xyflow/react@^12.10.2`:工作空间组件拓扑图(`app/(dashboard)/workspaces/[id]/components/topology/page.tsx`)。
- `@uiw/react-markdown-preview@^5.2.1`:Markdown 渲染(`src/components/ui/markdown-text.tsx`,jsdom 测试中通过 `vi.mock` 处理 SSR 兼容;用于 scan-docs 等页面)。

## 5. 后端 API 契约(FastAPI backend,经 Next.js rewrite 代理)

- **后端地址来源**:`next.config.mjs` 的 `rewrites()` 把前端 `/api/:path*` 与 `/daemon/:path*`(daemon 公开端点 install.sh / latest.json / sillyhub-daemon.js / mcp-server.js,由 backend dist_router 提供,无 /api 前缀)代理到 `${INTERNAL_API_BASE_URL ?? NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000"}`。
- **统一 fetch 客户端**:`src/lib/api.ts`。浏览器侧用 `window.location.origin`(走 Next rewrite 代理),服务端用 `SERVER_API_BASE_URL`;内置 401 → `POST /api/auth/refresh` token 刷新 + 失败跳转 `/login` 的处理(`api.ts:119/149/165`)。
- **OpenAPI 生成类型**:`scripts/gen-api-types.mjs` + `openapi-typescript@^7.13.0` 生成 `src/lib/api-types.ts`(>14000 行,前后端类型契约事实源);`pnpm gen:types` 生成、`pnpm gen:types:check` 校验生成结果未漂移(`git diff --exit-code`)。
- **Next.js Route Handlers**(`src/app/api/`,3 个):`daemon-chat/[runId]/stream`、`daemon/sessions/[sessionId]/stream`、`workspaces/[workspaceId]/agent/runs/[runId]/stream`,统一 `Content-Type: text/event-stream`,作为流式(SSE)代理透传到 backend daemon。
- **SSE 客户端消费**:`src/lib/agent-stream.ts` 的 `AgentRunStreamClient` 用 `new EventSource(url)` 订阅;配合 `use-agent-run-stream.ts` hook 把事件转 React 状态;消费组件含 agent-run-panel、daemon/interactive-session-panel、permissions/session-permission-panel。
- **业务 API 封装**:分散在 `src/lib/*.ts`(daemon、workspaces、changes、agent、admin、runtime、releases、knowledge、incidents、tasks、audit 等)及 `src/lib/ppm/*`、`src/lib/file/api.ts`、`src/lib/api/llm-providers.ts`。

## 6. 测试工具链

- `vitest@^2.0.0` + `@vitejs/plugin-react@^4.3.1` + `jsdom@^24.1.3`:单元/组件测试(`vitest.config.ts`:jsdom + globals + `@` alias + `src/test/setup.ts`);tsconfig `types: ["vitest/globals", "@testing-library/jest-dom"]`。各组件/页面目录配 `__tests__/` 共存单测。
- `@testing-library/react@^16.0.0` + `@testing-library/jest-dom@^6.4.6`:DOM 断言。
- `@playwright/test@^1.60.0`:端到端测试。
- `puppeteer@^24.43.1`:浏览器自动化(用于抓取/校验场景)。
- `typescript@5.5.4` + `eslint@8.57.0` + `eslint-config-next@14.2.5`:类型检查(`pnpm typecheck` = `tsc --noEmit`)与 lint(`pnpm lint` = `next lint`)。
- `@types/node@20.14.0` / `@types/react@18.3.3` / `@types/react-dom@18.3.0`:类型定义。

## 7. 构建运行时环境变量

见 `.env.example` 与源码:`NEXT_PUBLIC_API_BASE_URL`(浏览器侧 API 基址,默认 `http://localhost:8000`)、`INTERNAL_API_BASE_URL`(server 端 rewrite / Route Handler 代理优先)、`NEXT_BUILD_STANDALONE`(切 standalone 输出)、`NEXT_PUBLIC_COMMIT_SHA`(版本标识)。API 代理依赖 Next server / standalone / 反代,纯静态导出场景失效。
