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
| `INTERNAL_API_BASE_URL` | 服务端 | SSR / Route Handler 直连后端，优先级最高 |
| `NEXT_PUBLIC_API_BASE_URL` | 客户端 + 服务端 | 公开环境变量，暴露到浏览器 bundle |
| 兜底值 | -- | `http://localhost:8000` |

### API 客户端层（25 个模块）

| 模块 | 路径前缀 | 核心端点 |
|------|----------|---------|
| `api.ts` | -- | `apiFetch` 通用封装 + `ApiError` 异常类 + URL 解析（浏览器用相对路径/SSR 用绝对路径） + Token 自动刷新 |
| `auth.ts` | `/api/auth/` | login（获取 TokenPair + me）, refreshTokens, logout |
| `workspaces.ts` | `/api/workspaces/` | CRUD, scan, rescan, reparse, activate, relations, topology（全局） |
| `components.ts` | `/api/workspaces/` | listComponents, getComponent, getTopology（兼容层，映射 Workspace 为 Component，客户端 root_path 前缀过滤） |
| `spec-workspaces.ts` | `/api/workspaces/{id}/spec-workspace/` | get, import, sync, bootstrap, update（PATCH）, spec-conflicts |
| `changes.ts` | `/api/workspaces/{id}/changes/` | CRUD, transition, feedback, archive-gate, agent-status, dispatch, documents, documents/{docType}, reparse, approve, reject, progress, create, execute |
| `change-writer.ts` | `/api/workspaces/{id}/changes/` | createChange, batchGenerateDocuments（批量生成文档类型） |
| `workflow.ts` | `/api/workspaces/{id}/changes/` | submitReview, transitionChange, transitionTask, listReviews |
| `tasks.ts` | `/api/workspaces/{id}/changes/{id}/tasks/` | list, get, board, reparse |
| `agent.ts` | `/api/workspaces/{id}/agent/runs/` | create, get, list, logs（after 分页）, stream（SSE）, kill, submit input |
| `agent-stream.ts` | `/api/workspaces/{id}/agent/runs/{id}/stream` | AgentRunStreamClient -- SSE 连接管理（5 次指数退避重连: 1s/2s/4s/8s/16s）、log_id 去重、断线日志回填 |
| `approvals.ts` | `/api/workspaces/{id}/approvals/` | pending, history, approve, reject |
| `audit.ts` | `/api/workspaces/{id}/audit` | list（resource_type / limit 过滤） |
| `incidents.ts` | `/api/workspaces/{id}/incidents/` | CRUD, postmortem CRUD |
| `releases.ts` | `/api/workspaces/{id}/releases/` | CRUD, approve, deploy, promote, rollback |
| `runtime.ts` | `/api/workspaces/{id}/runtime/` | progress, user-inputs/raw（text/plain）, artifacts, artifact content |
| `knowledge.ts` | `/api/workspaces/{id}/knowledge/` + `/quicklog/` | list, get（Knowledge 和 Quicklog 两套端点） |
| `scan-docs.ts` | `/api/workspaces/{id}/scan-docs/` | list, get, reparse |
| `health.ts` | `/api/health` | getHealth（status, db, redis, version, commit_sha, server_time, environment） |
| `git-identities.ts` | `/api/git/identities/` | CRUD, check-access |
| `settings.ts` | `/api/settings/` + `/api/users/` | settings 批量读写, user CRUD（create/update/delete） |
| `archive.ts` | `/api/workspaces/{id}/changes/{id}/` | archive, distill |
| `worktree.ts` | `/api/workspaces/{id}/worktrees/` + `/api/worktrees/{id}/` | acquire, list, get, release, extend |
| `git-gateway.ts` | `/api/worktrees/{id}/git` | execute git operations |
| `tool-gateway.ts` | `/api/worktrees/{id}/tools` | execute tools（file_read/write/list/search, shell_exec） |

### 认证集成

1. **登录**: `POST /api/auth/login` --> 获取 `TokenPair`（access_token + refresh_token + token_type + expires_in）
2. **用户信息**: `GET /api/auth/me` --> 获取用户 + 关联 workspace 角色
3. **存储**: Token 写入 Zustand `useSession` store --> `localStorage` 持久化
4. **请求**: `apiFetch` 自动附加 `Authorization: Bearer` 头
5. **刷新**: 401 响应 --> 自动 `POST /api/auth/refresh` --> 换取新 token 并重试一次
6. **失败**: Refresh 失败 --> 清除 store --> `window.location.href = "/login"`
7. **SSE**: 连接认证通过 URL query 参数 `?token=xxx` 传递

### SSE 实时流集成

Agent 日志流使用 Server-Sent Events 协议，有两种连接方式：

1. **函数式 API**（`agent.ts:streamAgentRunLogs`）：
   - 创建 EventSource 连接，传入 onMessage / onDone / onError 回调
   - 收到 `done` 事件时自动关闭连接
   - 通过 `getApiBaseUrl()` 构建连接 URL

2. **面向对象 API**（`agent-stream.ts:AgentRunStreamClient`）：
   - 提供 connect / disconnect / onMessage / onStatusChange / onDone 接口
   - 自动重连：最多 5 次，指数退避（1s/2s/4s/8s/16s）
   - 消息去重：通过 `seenLogIds` Set 和 `lastLogId` 跟踪
   - 断线回填：重连前通过 `getAgentRunLogs(after=lastLogId)` 获取缺失日志
   - 状态管理：disconnected / connecting / connected / error

**SSE 代理**：
- Route Handler（`app/api/.../stream/route.ts`）在服务端转发后端 SSE 流
- 设置 `Content-Type: text/event-stream`、`Cache-Control: no-cache`、`X-Accel-Buffering: no`
- 直接透传后端 Response body

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

- `persist` middleware 持久化到 `localStorage`（key: `multi-agent-platform.session`，version: 1）
- `partialize` 明确指定持久化字段
- `onRehydrateStorage` 回调设置 `hydrated = true`
- DashboardLayout 通过 `hydrated + accessToken` 实现认证守卫
- `apiFetch` 通过 `useSession.getState()` 在非 React 上下文中获取 token

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
| class-variance-authority | 0.7.0 | 组件 variant 管理（Button/Badge 使用 cva 定义变体） |
| lucide-react | 0.400.0 | 图标库（已声明依赖，但代码中侧边栏导航主要使用 emoji） |

### 可视化

| 库 | 版本 | 用途 | 使用位置 |
|----|------|------|----------|
| @xyflow/react | 12.10.2 | 拓扑流程图 | `workspaces/[id]/components/topology/page.tsx` |
| @uiw/react-markdown-preview | 5.2.1 | Markdown 渲染 | `workspaces/[id]/scan-docs/page.tsx` 等文档查看页 |

### 校验

| 库 | 版本 | 用途 |
|----|------|------|
| zod | 3.23.0 | 已安装，当前未在表单中实际使用（后端返回的错误信息足够前端展示） |

## Next.js 配置集成

### next.config.mjs

| 配置项 | 值 | 说明 |
|--------|-----|------|
| `output` | `standalone`（条件） | 当 `NEXT_BUILD_STANDALONE=1` 时启用，用于 Docker 部署 |
| `reactStrictMode` | `true` | 严格模式 |
| `poweredByHeader` | `false` | 隐藏 X-Powered-By 头 |
| `experimental.typedRoutes` | `true` | 实验性类型路由（声明但未实际使用自动生成的 Link 类型） |
| `rewrites` | `/api/:path*` --> 后端 | API 代理 |

### Tailwind 配置

| 配置项 | 值 |
|--------|-----|
| `darkMode` | `["class"]` |
| `content` | `./src/app/**/*.{ts,tsx}`, `./src/components/**/*.{ts,tsx}`, `./src/lib/**/*.{ts,tsx}` |
| `container` | center: true, padding: "1rem", screens: { "2xl": "1280px" } |
| `theme.extend.colors` | border/input/ring/background/foreground/card/primary/muted/destructive（HSL 变量引用） |
| `theme.extend.borderRadius` | lg/md/sm（基于 --radius 变量计算） |
| `plugins` | `tailwindcss-animate` |

## Docker 部署集成

前端容器化使用多阶段构建：

- **构建参数**: `INTERNAL_API_BASE_URL`, `NEXT_PUBLIC_API_BASE_URL`, `NEXT_PUBLIC_COMMIT_SHA`
- **运行端口**: `3000`
- **standalone 输出模式**: 通过 `NEXT_BUILD_STANDALONE=1` 环境变量控制
- 健康检查通过访问根路径完成
