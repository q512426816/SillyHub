---
author: qinyi
created_at: 2026-06-03T10:00:00
---

# 集成与依赖

## 后端 API

### Next.js rewrites 代理配置

前端通过 `next.config.mjs` 中的 `rewrites` 将所有 `/api/*` 请求代理到后端服务：

```javascript
// next.config.mjs
async rewrites() {
  const apiBaseUrl = (
    process.env.INTERNAL_API_BASE_URL ??
    process.env.NEXT_PUBLIC_API_BASE_URL ??
    "http://localhost:8000"
  ).replace(/\/$/, "");
  return [{ source: "/api/:path*", destination: `${apiBaseUrl}/api/:path*` }];
}
```

环境变量优先级：

| 变量 | 作用域 | 说明 |
|------|--------|------|
| `INTERNAL_API_BASE_URL` | 服务端 | SSR 直连后端，优先级最高 |
| `NEXT_PUBLIC_API_BASE_URL` | 客户端+服务端 | 公开环境变量，暴露到浏览器 bundle |
| 兜底值 | — | `http://localhost:8000` |

前端始终使用相对路径 `/api/*`，由 rewrites 在服务端完成代理。

### API 模块清单

共 25 个 API 模块文件位于 `frontend/src/lib/`，覆盖后端全部业务领域：

| 模块 | 路径前缀 | 核心端点 |
|------|----------|---------|
| `api.ts` | — | `apiFetch` 通用封装 + `ApiError` 异常类 |
| `auth.ts` | `/api/auth/` | login, refresh, logout, me |
| `workspaces.ts` | `/api/workspaces/` | CRUD, scan, rescan, reparse, relations, topology |
| `components.ts` | `/api/workspaces/` | listComponents, getComponent, getTopology（兼容层） |
| `changes.ts` | `/api/workspaces/{id}/changes/` | CRUD, transition, feedback, archive-gate, agent-status, dispatch |
| `workflow.ts` | `/api/workspaces/{id}/changes/` | submitReview, transitionChange, transitionTask |
| `tasks.ts` | `/api/workspaces/{id}/changes/{id}/tasks/` | list, get, board, reparse |
| `agent.ts` | `/api/workspaces/{id}/agent/runs/` | CRUD, logs（`after` 参数分页）, submit input |
| `agent-stream.ts` | `/api/workspaces/{id}/agent/runs/{id}/stream` | `AgentRunStreamClient` — SSE 连接管理、断线重连（5 次指数退避）、token 刷新、日志回填、`log_id` 去重 |
| `approvals.ts` | `/api/workspaces/{id}/approvals/` | pending, history, approve, reject |
| `audit.ts` | `/api/workspaces/{id}/audit` | list (with filters) |
| `incidents.ts` | `/api/workspaces/{id}/incidents/` | CRUD, postmortem |
| `releases.ts` | `/api/workspaces/{id}/releases/` | CRUD, approve, deploy, promote, rollback |
| `runtime.ts` | `/api/workspaces/{id}/runtime/` | progress, user-inputs, artifacts |
| `knowledge.ts` | `/api/workspaces/{id}/knowledge/` | list, get |
| `scan-docs.ts` | `/api/workspaces/{id}/scan-docs/` | list, get, reparse |
| `health.ts` | `/api/health` | getHealth |
| `spec-workspaces.ts` | `/api/workspaces/{id}/spec-workspace/` | get, import, sync, bootstrap, conflicts, update |
| `git-identities.ts` | `/api/git/identities/` | CRUD, access check |
| `settings.ts` | `/api/settings/` | settings CRUD, user CRUD |
| `archive.ts` | `/api/workspaces/{id}/changes/{id}/` | archive, distill |
| `worktree.ts` | `/api/workspaces/{id}/worktrees/` | acquire, list, get, release, extend |
| `git-gateway.ts` | `/api/worktrees/{id}/git` | execute git operations |
| `tool-gateway.ts` | `/api/worktrees/{id}/tools` | execute tools (file ops, shell) |
| `change-writer.ts` | `/api/workspaces/{id}/changes/` | create change, batch-generate documents |

### 认证流程

1. 登录: `POST /api/auth/login` → 获取 `TokenPair`（access_token + refresh_token）
2. 存储: Token 写入 Zustand `useSession` store → `localStorage` 持久化
3. 请求: `apiFetch` 自动附加 `Authorization: Bearer` 头
4. 刷新: 401 响应 → 自动 `POST /api/auth/refresh` → 换取新 token
5. 失败: Refresh 失败 → 清除 store → 重定向 `/login`

SSE 连接认证通过 URL query 参数 `?token=xxx` 传递。

## 状态管理

### Zustand — 全局客户端状态

唯一 store: `frontend/src/stores/session.ts`

```typescript
interface SessionState {
  hydrated: boolean;          // persist 水合完成标志
  user: SessionUser | null;   // { id, email, displayName }
  accessToken: string | null;
  refreshToken: string | null;
}
```

- 使用 `zustand/middleware/persist` 持久化到 `localStorage`（key: `multi-agent-platform.session`）
- `onRehydrateStorage` 回调设置 `hydrated = true`，确保 SSR/CSR 一致性
- DashboardLayout 通过 `hydrated + accessToken` 实现认证守卫

### React Query — 服务端状态（预留）

`@tanstack/react-query` v5.51.0 已安装，但当前页面主要使用 `useState + useEffect` 模式直接调用 `apiFetch`。未来可逐步迁移至 React Query 管理服务端状态缓存。

## UI 组件库

### 样式基础

- **Tailwind CSS** v3.4.7 — 原子化 CSS 框架
- **tailwindcss-animate** v1.0.7 — 动画插件
- **clsx** + **tailwind-merge** — `cn()` 工具函数合并类名
- **class-variance-authority** v0.7.0 — 组件 variant 管理

### 图标

- **lucide-react** v0.400.0 — 侧边栏导航图标等

### 流程图 / 拓扑图

- **@xyflow/react** v12.10.2 — 仅 `frontend/src/app/(dashboard)/workspaces/[id]/components/topology/page.tsx` 使用
- 渲染 workspace 组件依赖拓扑

### Markdown 渲染

- **@uiw/react-markdown-preview** v5.2.1 — 仅 `frontend/src/app/(dashboard)/workspaces/[id]/scan-docs/page.tsx` 使用
- 渲染 scan-docs 目录中的 Markdown 文档内容

### 类型校验

- **zod** v3.23.0 — 已安装，当前未在表单校验中使用，预留

## Docker

### 前端容器化

`frontend/Dockerfile` 使用三阶段构建：

| 阶段 | 基础镜像 | 作用 |
|------|---------|------|
| deps | `node:20-alpine` | pnpm install 依赖 |
| builder | `node:20-alpine` | `pnpm build`（standalone 输出） |
| runtime | `node:20-alpine` | 最小运行时镜像 |

构建参数：

- `INTERNAL_API_BASE_URL` — 服务端 API 地址（Docker 网络内）
- `NEXT_PUBLIC_API_BASE_URL` — 客户端 API 地址
- `NEXT_PUBLIC_COMMIT_SHA` — Git commit 信息

运行时配置：

- `PORT=3000`, `HOSTNAME=0.0.0.0`
- 非 root 用户 `nextjs:nodejs`（uid/gid 1001）
- 健康检查: `wget -qO- http://127.0.0.1:3000`（30s 间隔，20s 启动等待）
- 启动命令: `node server.js`（Next.js standalone 模式）

## Markdown 渲染

- 库: `@uiw/react-markdown-preview` v5.2.1
- 使用位置: `frontend/src/app/(dashboard)/workspaces/[id]/scan-docs/page.tsx`
- 用途: 渲染 SillySpec scan 生成的 Markdown 文档（架构文档、模块文档等）
