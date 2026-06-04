---
author: scan-agent
created_at: "2026-06-03"
---

# SillyHub Frontend — 后端集成

## apiFetch 核心封装

`src/lib/api.ts` 是所有后端通信的统一入口。

### 设计要点

1. **URL 解析策略**
   - 浏览器端: 使用相对 URL + `window.location.origin`，利用 Next.js rewrite 代理
   - 服务端 (SSR): 使用 `INTERNAL_API_BASE_URL` 或 `NEXT_PUBLIC_API_BASE_URL` 环境变量
   - 暴露 `getApiBaseUrl()` 和 `getDirectApiBaseUrl()` 供其他模块使用

2. **请求头自动注入**
   - `accept: application/json`
   - `x-request-id`: 自动生成 UUID，用于日志关联
   - `Authorization: Bearer {token}`: 从 `useSession.getState().accessToken` 获取

3. **错误处理**
   - 成功: 返回解析后的 JSON（`T`）
   - 失败: 抛出 `ApiError`，包含 `code`、`status`、`requestId`、`details`
   - 网络错误: 抛出 `ApiError(status=0, code="network_error")`

4. **Token 自动刷新**
   - 收到 401 且非 auth 端点 → 尝试用 refresh_token 刷新
   - 刷新成功 → 自动重试原请求（带 `x-auth-retry: 1` 防止无限循环）
   - 刷新失败 → 清除会话 → 跳转 `/login`

### API 代理（Next.js Rewrites）

```js
// next.config.mjs
rewrites: [
  { source: "/api/:path*", destination: "http://localhost:8000/api/:path*" }
]
```

浏览器端请求 `/api/workspaces` → 代理到 `http://localhost:8000/api/workspaces`。

优势：
- 不在后端地址硬编码到客户端 bundle
- 支持 frp 隧道、局域网等不同访问方式
- 避免 CORS 问题

## 认证状态管理

### 登录流程

```
用户提交表单 → auth.ts:login(email, password)
  → POST /api/auth/login → TokenPair { access_token, refresh_token }
  → useSession.setTokens() → 持久化到 localStorage
  → GET /api/auth/me → MeResponse { user, workspaces }
  → useSession.setUser() → 持久化到 localStorage
  → 路由跳转 /workspaces
```

### 会话持久化

- Zustand `persist` 中间件 → localStorage key: `multi-agent-platform.session`
- 存储: `accessToken`、`refreshToken`、`user`、`hydrated`
- `onRehydrateStorage` 回调设置 `hydrated = true`，确保护卫逻辑确定性

### 认证守卫

```tsx
// (dashboard)/layout.tsx
const { hydrated, accessToken } = useSession();
useEffect(() => {
  if (!hydrated) return;
  if (!accessToken) router.replace("/login");
}, [hydrated, accessToken]);
if (!hydrated || !accessToken) return null;
return <AppShell>{children}</AppShell>;
```

### 登出流程

```
用户点击退出 → AppShell.onLogout()
  → POST /api/auth/logout { refresh_token }
  → useSession.clear() → 清空 localStorage
  → router.replace("/login")
```

## SSE 实时通信

### 架构

Agent 运行日志通过 SSE（Server-Sent Events）实时推送到前端。

### Route Handler 代理

```
浏览器 (EventSource) → Next.js Route Handler → 后端 SSE endpoint
   /api/workspaces/{wsId}/agent/runs/{runId}/stream/route.ts
     → 代理到 http://localhost:8000/api/workspaces/{wsId}/agent/runs/{runId}/stream
     → 设置 X-Accel-Buffering: no 防止 Nginx 缓冲
```

### AgentRunStreamClient

`src/lib/agent-stream.ts` 封装了一个功能完善的 SSE 客户端：

**特性**：
- **连接状态**: disconnected → connecting → connected → error
- **自动重连**: 指数退避（1s, 2s, 4s, 8s, 16s），最多 5 次
- **断点恢复**: 通过 `lastLogId` 参数从上次接收的位置继续
- **消息去重**: `seenLogIds` Set 防止重复消息
- **回调 API**: `onMessage`、`onStatusChange`、`onDone`
- **资源清理**: `disconnect()` 关闭连接和重连定时器

### 使用模式

```tsx
const client = new AgentRunStreamClient(workspaceId, runId);
client.onStatusChange(setStatus);
client.onMessage((event) => { /* 追加日志 */ });
client.onDone(() => { /* Agent 完成，刷新数据 */ });
client.connect(accessToken);

// 清理
useEffect(() => {
  return () => client.disconnect();
}, []);
```

### EventSource 直接模式

`agent.ts` 中的 `streamAgentRunLogs()` 提供了更简单的 EventSource 封装（无重连），用于 WorkspaceScanDialog 等简单场景。

## 后端 API 模块对应表

| 前端模块 | 后端 API 前缀 | 功能 |
|---------|-------------|------|
| `api.ts` | — | HTTP 客户层封装 |
| `auth.ts` | `/api/auth/*` | 登录/登出/刷新/Me |
| `workspaces.ts` | `/api/workspaces/*` | Workspace CRUD + 扫描 + 拓扑 |
| `components.ts` | `/api/workspaces/*` | 兼容层（旧组件 API） |
| `changes.ts` | `/api/workspaces/{id}/changes/*` | 变更管理 + 阶段流转 + Agent dispatch |
| `tasks.ts` | `/api/workspaces/{id}/changes/{cid}/tasks/*` | 任务管理 |
| `agent.ts` | `/api/workspaces/{id}/agent/*` | Agent Run CRUD + SSE |
| `runtime.ts` | `/api/workspaces/{id}/runtime/*` | 运行时进度 |
| `knowledge.ts` | `/api/workspaces/{id}/knowledge/*` | 知识库 |
| `releases.ts` | `/api/workspaces/{id}/releases/*` + `/api/releases/*` | 发布管理 |
| `incidents.ts` | `/api/workspaces/{id}/incidents/*` + `/api/incidents/*` | 事件管理 |
| `approvals.ts` | `/api/workspaces/{id}/approvals/*` | 审批管理 |
| `audit.ts` | `/api/workspaces/{id}/audit/*` | 审计日志 |
| `health.ts` | `/api/health` | 健康检查 |
| `settings.ts` | `/api/settings/*` + `/api/users/*` | 设置 & 用户管理 |
| `spec-workspaces.ts` | `/api/workspaces/{id}/spec-workspace/*` | Spec Workspace |
| `scan-docs.ts` | `/api/workspaces/{id}/scan-docs/*` | 扫描文档 |
| `worktree.ts` | `/api/workspaces/{id}/worktrees/*` + `/api/worktrees/*` | Worktree 管理 |
| `git-gateway.ts` | `/api/worktrees/{leaseId}/git` | Git 操作 |
| `tool-gateway.ts` | `/api/worktrees/{leaseId}/tools` | 工具执行 |
| `git-identities.ts` | `/api/git/*` | Git 身份 |
| `archive.ts` | `/api/workspaces/{id}/changes/{cid}/archive` | 变更归档 |
| `change-writer.ts` | `/api/workspaces/{id}/changes/create` | 变更创建 + 文档生成 |
| `workflow.ts` | `/api/workspaces/{id}/changes/{cid}/*` | 阶段流转 + 评审 |
