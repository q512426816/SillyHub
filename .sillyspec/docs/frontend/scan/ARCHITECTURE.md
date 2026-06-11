---
author: qinyi
created_at: 2026-06-10T00:00:00
---

# Frontend 技术架构

## 技术栈

| 层级 | 技术 | 版本 |
|------|------|------|
| 框架 | Next.js (App Router) | 14.2.5 |
| 语言 | TypeScript (strict) | 5.5.4 |
| UI 库 | React | 18.3.1 |
| 样式 | Tailwind CSS + CSS Variables (shadcn/ui 主题) | 3.4.7 |
| 状态管理 | Zustand (persist middleware) | 4.5.0 |
| 数据获取 | 原生 fetch (apiFetch 封装) | -- |
| 图表/拓扑 | @xyflow/react (React Flow) | 12.10.2 |
| 表单校验 | Zod | 3.23.0 |
| UI 组件 | shadcn/ui (Button, Badge, Input...) | -- |
| 图标 | lucide-react | 0.400.0 |
| Markdown | @uiw/react-markdown-preview | 5.2.1 |
| 包管理 | pnpm | 9.6.0 |
| 运行时 | Node.js >= 20 | -- |

## 架构概览

```
浏览器
  |
  +-- Next.js App Router (SSR + CSR)
  |     |
  |     +-- (auth) 路由组 — /login (无侧边栏)
  |     |
  |     +-- (dashboard) 路由组 — 受保护页面 (AppShell + 侧边栏)
  |           |
  |           +-- /workspaces           — 工作空间列表
  |           +-- /workspaces/[id]/*    — 工作空间详情 (20+ 子页面)
  |           +-- /settings             — 系统设置
  |           +-- /runtimes             — Daemon 运行时管理
  |
  +-- API Route (BFF)
  |     +-- /api/workspaces/[workspaceId]/agent/runs/[runId]/stream
  |           — SSE 代理转发到后端
  |
  +-- /api/* Rewrite 代理 → Backend (localhost:8000)
```

### 核心分层

1. **页面层** (`src/app/`): Next.js App Router 页面，全部标记 `"use client"`，无 Server Components。
2. **组件层** (`src/components/`): 可复用 UI 组件，包含 shadcn/ui 基础组件和业务组件。
3. **数据层** (`src/lib/`): API 客户端函数，每个模块一个文件，统一通过 `apiFetch` 调用后端。
4. **状态层** (`src/stores/`): Zustand store，当前仅 `session.ts` 管理认证状态。

### 关键架构决策

- **无 React Query**: 虽然安装了 `@tanstack/react-query`，但当前代码中未使用 `useQuery`/`useMutation`，所有数据获取直接在组件中调用 `apiFetch`。
- **全部 CSR**: 所有页面组件均使用 `"use client"`，未利用 Next.js RSC 能力。
- **API 代理**: 通过 `next.config.mjs` 的 `rewrites` 将 `/api/*` 转发到后端 `http://localhost:8000`，浏览器端始终使用相对路径。
- **SSE 直连**: Agent 日志流通过 `EventSource` 直连后端 SSE 端点，绕过 Next.js 代理避免缓冲问题。

### 认证流程

1. 用户登录 → `POST /api/auth/login` 获取 access_token + refresh_token
2. Token 存储在 Zustand persist (localStorage) 中
3. `apiFetch` 自动附加 `Authorization: Bearer <token>` 头
4. 401 响应时自动尝试 refresh token，失败则清除 session 并跳转 `/login`
5. Dashboard layout 通过 `useSession` 检查 `accessToken`，无 token 时重定向

### 实时通信

- `AgentRunStreamClient` 类封装 SSE 连接，支持：
  - 自动重连（指数退避，最多 5 次）
  - 断线期间通过 REST API 回填丢失日志
  - `done` 事件自动断开连接
  - 去重（通过 `seenLogIds` Set）
