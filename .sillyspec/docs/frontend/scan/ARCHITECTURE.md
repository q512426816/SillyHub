---
author: scan-agent
created_at: "2026-06-03"
---

# SillyHub Frontend — 架构设计

## 整体架构

前端采用 **Next.js 14 App Router** 架构，作为 SillyHub 后端 API 的单页应用（SPA）前端。

```
浏览器 ──→ Next.js (前端) ──→ Next.js rewrites ──→ 后端 API (FastAPI, :8000)
              │                                         │
              ├── App Router 路由                      ├── /api/*
              ├── Route Handler (SSE 代理)              ├── /api/auth/*
              └── 客户端组件                            └── /api/workspaces/*
```

## 路由策略

使用 **Route Groups（路由组）** 实现不同布局：
- `(auth)` — 公开路由（登录页），无侧边栏
- `(dashboard)` — 受保护路由，通过 `DashboardLayout` 强制认证检查 + `AppShell` 侧边栏

认证守卫在 `DashboardLayout` 中通过 `useSession().accessToken` 判断，未登录自动跳转 `/login`。

## API 代理

Next.js 通过 `next.config.mjs` 的 `rewrites` 将所有 `/api/*` 请求代理到后端：

```js
rewrites: [
  { source: "/api/:path*", destination: "http://localhost:8000/api/:path*" }
]
```

客户端使用相对 URL（如 `/api/workspaces`），无需硬编码后端地址，支持 frp 隧道、局域网访问等场景。

SSE 流式连接使用 **Route Handler** (`/api/workspaces/.../stream/route.ts`) 做服务端代理，避免代理缓冲问题。

## 状态管理

采用两层状态管理方案：

### 1. Zustand（客户端全局状态）
- **`useSession` store** — 用户会话（token、用户信息），使用 `persist` 中间件持久化到 localStorage
- 这是唯一的 Zustand store

### 2. 组件本地状态（useState + useEffect）
- 绝大多数页面使用 `useState` + `useEffect` 手动管理数据获取和加载状态
- 未使用 TanStack Query 的 hooks（虽然已安装）
- 典型模式：
  ```ts
  const [items, setItems] = useState<Item[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { load().catch(handleError); }, []);
  ```

## 数据层架构

```
src/lib/ 目录
├── api.ts          # apiFetch 封装（核心 HTTP 客户端）
├── auth.ts         # 登录/登出/刷新
├── workspaces.ts   # Workspace CRUD
├── changes.ts      # 变更管理 + 阶段流转
├── agent.ts        # Agent Run 管理 + SSE 流
├── agent-stream.ts # SSE 流客户端（断线重连）
├── components.ts   # 兼容层：旧组件 API → 新 Workspace API
├── ...（20+ 个模块）
```

每个 `lib/*.ts` 模块是对后端一个 API 模块的 TypeScript 客户端，包含：
- TypeScript 类型定义（对齐后端 schema）
- 导出函数调用 `apiFetch<T>()`

## 认证流程

```
用户登录 → auth.ts:login()
  → POST /api/auth/login → 获取 access_token + refresh_token
  → 存入 Zustand (persist → localStorage)
  → GET /api/auth/me → 获取用户信息
  → 跳转 /workspaces

请求时 → apiFetch 自动从 useSession.getState().accessToken 取 token
  → 附加 Authorization: Bearer {token}
  → 401 时自动刷新 token → 重试请求
  → 刷新失败 → 清除会话 → 跳转 /login
```

## 实时通信

- **SSE (Server-Sent Events)** — Agent 运行日志实时推送
  - `AgentRunStreamClient` 类封装 EventSource
  - 支持断线重连（指数退避，最多 5 次）
  - 去重（`seenLogIds` Set）
  - 支持从 `lastLogId` 恢复
  - Route Handler 代理避免缓冲

## 构建与部署

- 开发模式: `next dev`（HMR）
- 生产模式: `next build` → `next start`
- 支持 standalone 输出（`NEXT_BUILD_STANDALONE=1`）
- 启用 `typedRoutes`（实验性类型安全路由）
- CSS: Tailwind CSS + PostCSS + Autoprefixer
