---
source_commit: fcbf3fa7
updated_at: 2026-06-22T18:12:36Z
generator: sillyspec-scan
author: qinyi
created_at: 2026-06-23 02:12:36
---

# frontend 代码约定

> 基于 `frontend/src/` grep 摘录，覆盖旧版文档。

## 框架隐形规则

### Next.js App Router

- **目录约定**：页面文件名固定 `page.tsx`，嵌套布局用 `layout.tsx`；用路由组 `(auth)` / `(dashboard)` 组织但不出现在 URL 中。
- **Server / Client 边界**：默认 RSC；需交互/状态/hooks/浏览器 API 的页面/组件顶部显式 `"use client"`（如 `agent-run-panel.tsx`、`use-agent-run-stream` 消费方）。
- **Route Handler**：SSE 透传路由（`app/api/**/stream/route.ts`）导出 `GET`，返回 `new Response(stream, { headers: { "Content-Type": "text/event-stream" } })`。
- **路径别名**：`@/*` → `./src/*`（`tsconfig.json` paths + `vitest.config.ts` resolve alias 双配置）。
- **typedRoutes**：`experimental.typedRoutes` 开启，路由类型受控。
- **metadata**：根 layout 用 `export const metadata: Metadata` 导出元信息（RSC 侧）。
- **StrictMode**：`reactStrictMode: true`——SSE 订阅 hook 必须容忍双调用（`useAgentRunStream` 已处理）。

### 数据访问

- **统一出口**：所有后端调用走 `lib/api.ts` 的 `apiFetch()`，禁止直接 `fetch("/api/...")` 绕过。
- **路径前缀**：前端只调 `/api/*`，由 `next.config.mjs` rewrites 转发到 backend，不直接拼 backend host（server 端用 `INTERNAL_API_BASE_URL`，浏览器用 `NEXT_PUBLIC_API_BASE_URL`）。
- **Token 刷新**：`apiFetch` 内部捕获 401 → 自动 `POST /api/auth/refresh` → 重放原请求。
- **服务端数据**：React Query（`@tanstack/react-query`）管理缓存、失效、loading/error；客户端状态用 Zustand。

### 状态

- Zustand store 一律放 `src/stores/`，用 `create<T>()(...)` 签名；组件用 `useXxx` selector hook（`useSession` / `useKanbanStore`）。
- 流式数据（agent run 日志）不进全局 store，由 `useAgentRunStream` 在 hook 内用 `useState` 维护，避免高频更新触发整树渲染。

### 类型

- TypeScript strict + `noUncheckedIndexedAccess`：数组/对象索引访问需显式 narrowing 或兜底（`arr[0]!` / `?? fallback` 常见）。
- 领域类型集中在 `lib/*.ts`（如 `lib/changes.ts` 的 `ChangeSummary`），用 `export type` 暴露；PPM 领域集中在 `lib/ppm/types.ts`。
- zod 用于运行时校验（与 `class-variance-authority` + `clsx` + `tailwind-merge` 组合驱动 shadcn variants）。

### SSE hook 隐形规则

- `useAgentRunStream` 内部用 `cancelled` flag 保护 unmount / 依赖变化后的旧 effect 闭包（`use-agent-run-stream.ts` 多处 `if (cancelled) return;`）——任何修改必须保留该 guard，否则 StrictMode 双调用或快速重连会产生孤儿 `EventSource` 或写入已卸载组件。

## 代码风格

### 命名

- **组件**：PascalCase 文件名（`WorkspaceTabs.tsx`、`AgentModelInput.tsx`、`admin-organization-tree.tsx` 采用 kebab-case 亦有），命名空间子目录小写（`agent-log/`、`daemon/`、`permissions/`、`charts/`）。
- **函数导出**：组件 `export function X({ ... }: Props)`，页面 `export default function XPage()`；hook `export function useXxx(...)`。
- **领域 client**：`lib/<domain>.ts` 暴露 `listXxx` / `getXxx` / `createXxx` / `updateXxx` 动词式 API（见 `lib/api.ts` 的 `apiFetch`、`getApiBaseUrl`、`getDirectApiBaseUrl`、`safeUUID`）。
- **测试**：`__tests__/` 目录约定（co-locate），文件名 `<name>.test.{ts,tsx}`。

### 样式

- 双 UI 库并存：
  - 业务组件优先 Ant Design（`from "antd"`、`@ant-design/icons`）。
  - 原子/自定义控件用 shadcn `@/components/ui/*`，类名经 `cn()`（`clsx` + `tailwind-merge`）合并。
- Tailwind utility 为主，shadcn 用 CSS variables 主题（`globals.css` 定义，`tailwind.config.ts` 映射 `hsl(var(--xxx))`）。

### 导出风格

- 类型与实现同文件导出（`export type Foo = {...}` 紧邻 `export function useFoo()`）。
- Route Handler 用具名导出 `GET` / `POST`，不写默认导出。

### 测试

- vitest + jsdom + @testing-library/react + jest-dom（`globals: true`，无需 import `describe/it/expect`）。
- setup 在 `src/test/setup.ts`，jest-dom 自定义匹配器。
- 测试与被测同模块 `__tests__/` 下，便于就近维护。
