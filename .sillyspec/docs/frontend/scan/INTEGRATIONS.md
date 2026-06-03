---
author: qinyi
created_at: 2026-06-03T20:35:00+08:00
---

# Frontend - 外部集成

## 后端 API 集成

### Next.js Rewrites 代理

前端通过 `next.config.mjs` 中的 `rewrites` 将所有 `/api/*` 请求代理到后端服务：

```javascript
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
| 兜底值 | -- | `http://localhost:8000` |

### API 客户端层（24 个模块）

| 模块 | 路径前缀 | 核心端点 |
|------|----------|---------|
| `api.ts` | -- | `apiFetch` 通用封装 + `ApiError` 异常类 + URL 解析 + Token 刷新 |
| `auth.ts` | `/api/auth/` | login, refresh, logout, me |
| `workspaces.ts` | `/api/workspaces/` | CRUD, scan, rescan, reparse, relations, topology |
| `components.ts` | `/api/workspaces/` | listComponents, getComponent, getTopology（兼容层，映射 Workspace 为 Component） |
| `changes.ts` | `/api/workspaces/{id}/changes/` | CRUD, transition, feedback, archive-gate, agent-status, dispatch, documents |
| `workflow.ts` | `/api/workspaces/{id}/changes/` | submitReview, transitionChange, transitionTask, listReviews |
| `tasks.ts` | `/api/workspaces/{id}/changes/{id}/tasks/` | list, get, board, reparse |
| `agent.ts` | `/api/workspaces/{id}/agent/runs/` | CRUD, logs（after 分页）, SSE stream, submit input |
| `agent-stream.ts` | `/api/workspaces/{id}/agent/runs/{id}/stream` | AgentRunStreamClient -- SSE 连接管理、5 次指数退避重连、log_id 去重、断线日志回填 |
| `approvals.ts` | `/api/workspaces/{id}/approvals/` | pending, history, approve, reject |
| `audit.ts` | `/api/workspaces/{id}/audit` | list (with resource_type / limit 过滤) |
| `incidents.ts` | `/api/workspaces/{id}/incidents/` | CRUD, postmortem CRUD |
| `releases.ts` | `/api/workspaces/{id}/releases/` | CRUD, approve, deploy, promote, rollback |
| `runtime.ts` | `/api/workspaces/{id}/runtime/` | progress, user-inputs/raw, artifacts, artifact content |
| `knowledge.ts` | `/api/workspaces/{id}/knowledge/` + `/quicklog/` | list, get（Knowledge 和 Quicklog） |
| `scan-docs.ts` | `/api/workspaces/{id}/scan-docs/` | list, get, reparse |
| `health.ts` | `/api/health` | getHealth（DB/Redis/版本/commit/环境） |
| `spec-workspaces.ts` | `/api/workspaces/{id}/spec-workspace/` | get, import, sync, bootstrap, update, conflicts |
| `git-identities.ts` | `/api/git/identities/` | CRUD, check-access |
| `settings.ts` | `/api/settings/` + `/api/users/` | settings CRUD, user CRUD |
| `archive.ts` | `/api/workspaces/{id}/changes/{id}/` | archive, distill |
| `worktree.ts` | `/api/workspaces/{id}/worktrees/` + `/api/worktrees/{id}/` | acquire, list, get, release, extend |
| `git-gateway.ts` | `/api/worktrees/{id}/git` | execute git operations |
| `tool-gateway.ts` | `/api/worktrees/{id}/tools` | execute tools (file_read/write/list/search, shell_exec) |
| `change-writer.ts` | `/api/workspaces/{id}/changes/` | createChange, batchGenerateDocuments |

### 认证集成

1. **登录**: `POST /api/auth/login` --> 获取 `TokenPair`（access_token + refresh_token）
2. **存储**: Token 写入 Zustand `useSession` store --> `localStorage` 持久化
3. **请求**: `apiFetch` 自动附加 `Authorization: Bearer` 头
4. **刷新**: 401 响应 --> 自动 `POST /api/auth/refresh` --> 换取新 token 并重试
5. **失败**: Refresh 失败 --> 清除 store --> 重定向 `/login`
6. **SSE**: 连接认证通过 URL query 参数 `?token=xxx` 传递

### SSE 实时流集成

Agent 日志流使用 Server-Sent Events 协议：

- **直连模式**: `getDirectApiBaseUrl()` 返回 `NEXT_PUBLIC_API_BASE_URL`，绕过 Next.js 代理
- **Route Handler 代理**: `app/api/workspaces/[workspaceId]/agent/runs/[runId]/stream/route.ts` 在服务端转发 SSE 流
- **高级客户端**: `AgentRunStreamClient` 提供 connect/disconnect/onMessage/onStatusChange/onDone 接口

## 状态管理集成

### Zustand（客户端状态）

唯一全局 Store: `stores/session.ts`

```typescript
SessionState {
  hydrated: boolean          // persist 水合完成标志
  user: SessionUser | null   // { id, email, displayName }
  accessToken: string | null
  refreshToken: string | null
}
```

- `persist` middleware 持久化到 `localStorage`（key: `multi-agent-platform.session`）
- `onRehydrateStorage` 回调设置 `hydrated = true`
- DashboardLayout 通过 `hydrated + accessToken` 实现认证守卫

### React Query（已安装，未广泛使用）

`@tanstack/react-query` v5.51.0 已在 `package.json` 中声明，但当前所有页面使用 `useState + useEffect` 直接调用 `apiFetch`。未来可逐步迁移到 React Query 获得缓存、重试、自动刷新能力。

## 第三方库集成

### UI / 样式

| 库 | 版本 | 用途 |
|----|------|------|
| Tailwind CSS | 3.4.7 | 原子化 CSS 框架 |
| tailwindcss-animate | 1.0.7 | Tailwind 动画插件（animate-pulse 等） |
| clsx | 2.1.1 | 条件类名拼接 |
| tailwind-merge | 2.4.0 | Tailwind 类名智能合并 |
| class-variance-authority | 0.7.0 | 组件 variant 管理（Button/Badge） |
| lucide-react | 0.400.0 | 图标库（声明但代码中主要使用 emoji） |

### 可视化

| 库 | 版本 | 用途 | 使用位置 |
|----|------|------|----------|
| @xyflow/react | 12.10.2 | 拓扑流程图 | `workspaces/[id]/components/topology/page.tsx` |
| @uiw/react-markdown-preview | 5.2.1 | Markdown 渲染 | `workspaces/[id]/scan-docs/page.tsx` |

### 校验

| 库 | 版本 | 用途 |
|----|------|------|
| zod | 3.23.0 | 已安装，当前未在表单中实际使用 |

## Docker 部署集成

前端容器化使用三阶段构建：

| 阶段 | 基础镜像 | 作用 |
|------|---------|------|
| deps | `node:20-alpine` | pnpm install |
| builder | `node:20-alpine` | `pnpm build`（standalone 输出） |
| runtime | `node:20-alpine` | 最小运行时 |

关键配置：
- 构建参数: `INTERNAL_API_BASE_URL`, `NEXT_PUBLIC_API_BASE_URL`, `NEXT_PUBLIC_COMMIT_SHA`
- 运行端口: `3000`
- 非 root 用户: `nextjs:nodejs` (uid/gid 1001)
- 健康检查: `wget -qO- http://127.0.0.1:3000`（30s 间隔）
- standalone 输出模式通过 `NEXT_BUILD_STANDALONE=1` 环境变量控制
