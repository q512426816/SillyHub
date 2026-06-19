---
author: qinyi
created_at: 2026-06-19 12:50:59
source_commit: 0303536
updated_at: 2026-06-19T04:50:59Z
generator: sillyspec-scan
---

# frontend 代码约定

> 基于 `frontend/src/` grep 摘录，覆盖旧版文档。

## 框架隐形规则

### Next.js App Router

- **目录约定**：页面文件名固定 `page.tsx`，嵌套布局用 `layout.tsx`；用路由组 `(auth)` / `(dashboard)` 组织但不出现在 URL 中
- **Server / Client 边界**：默认 RSC；需交互/状态/hooks 的页面/组件顶部显式 `"use client"`（grep 统计 51 处）
- **Route Handler**：SSE 透传路由必须声明 `export const runtime = "nodejs"` + `export const dynamic = "force-dynamic"`，导出 `GET`（部分 `POST`），返回 `new Response(stream, { headers: { "Content-Type": "text/event-stream" } })`
- **路径别名**：`@/*` → `./src/*`（tsconfig paths）
- **typedRoutes**：`experimental.typedRoutes` 开启，路由类型受控
- **metadata**：根 layout 用 `export const metadata: Metadata` 导出元信息（RSC 侧）

### 数据访问

- **统一出口**：所有后端调用走 `lib/api.ts` 的 `apiFetch()`，禁止直接 `fetch("/api/...")` 绕过（auth.ts 的 logout 是已知例外）
- **路径前缀**：前端只调 `/api/*`，由 `next.config.mjs` rewrites 转发到 backend，不直接拼 backend host
- **Token 刷新**：`apiFetch` 内部捕获 401 → 自动 POST `/api/auth/refresh` → 重放原请求
- **无 React Query**：虽有 `@tanstack/react-query` 依赖，但 src 内 0 处使用；状态/缓存自管（页面 useEffect 拉数据 + Zustand session）

### 状态

- Zustand store 一律放 `src/stores/`，用 `create<T>()(...)` 签名（中间件用 `persist`）；组件用 `useXxx` selector hook

### 类型

- TypeScript strict + `noUncheckedIndexedAccess`：数组/对象索引访问需显式 narrowing 或兜底
- 领域类型集中在 `lib/*.ts`（如 `lib/changes.ts` 的 `ChangeSummary` / `ChangeRead` / `ChangeList`），用 `export type` 暴露
- zod 用于运行时校验（与 `class-variance-authority` + `clsx` + `tailwind-merge` 组合驱动 shadcn variants）

## 代码风格

### 命名

- **组件**：PascalCase 文件名（`WorkspaceTabs.tsx`、`AgentModelInput.tsx`），命名空间子目录小写（`agent-log/`、`daemon/`）
- **函数导出**：组件 `export function X({ ... }: Props)`，页面 `export default function XPage()`
- **领域 client**：`lib/<domain>.ts` 暴露 `listXxx` / `getXxx` / `createXxx` / `updateXxx` 动词式 API
- **测试**：`__tests__/` 目录约定（co-locate），文件名 `<name>.test.{ts,tsx}`

### 样式

- 双 UI 库并存：
  - 业务组件优先 Ant Design（`from "antd"`、`@ant-design/icons`）
  - 原子/自定义控件用 shadcn `@/components/ui/*`，类名经 `cn()`（`clsx` + `tailwind-merge`）合并
- Tailwind utility 为主，shadcn 用 CSS variables 主题（`globals.css` 定义）

### 导出风格

- 类型与实现同文件导出（`export type Foo = {...}` 紧邻 `export function useFoo()`）
- Route Handler 用具名导出 `GET` / `POST`，不写默认导出

### 测试

- vitest + jsdom + @testing-library/react
- setup 在 `src/test/setup.ts`，jest-dom 自定义匹配器
- 测试与被测同模块 `__tests__/` 下，便于就近维护
