---
author: qinyi
created_at: 2026-05-31T23:30:00
---

# 集成与依赖

## 后端 API 对接

### API 代理架构

前端通过 Next.js `rewrites` 代理所有 `/api/*` 请求到后端服务：

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

- `INTERNAL_API_BASE_URL`：服务端渲染专用，优先级最高
- `NEXT_PUBLIC_API_BASE_URL`：公开环境变量，暴露到客户端 bundle
- 浏览器端使用相对 URL `/api/*`（通过 rewrites 代理）
- 服务端使用绝对 URL 直连后端

### API 模块清单

前端共 25 个 API 模块文件，覆盖后端全部业务领域：

| 模块 | 后端路径前缀 | 核心端点 |
|------|-------------|---------|
| `auth.ts` | `/api/auth/` | login, refresh, logout, me |
| `workspaces.ts` | `/api/workspaces/` | CRUD, scan, rescan, reparse, relations, topology |
| `components.ts` | `/api/workspaces/` (兼容层) | listComponents, getComponent, getTopology |
| `changes.ts` | `/api/workspaces/{id}/changes/` | CRUD, transition, feedback, archive-gate, agent-status, dispatch |
| `workflow.ts` | `/api/workspaces/{id}/changes/` | submitReview, transitionChange, transitionTask |
| `tasks.ts` | `/api/workspaces/{id}/changes/{id}/tasks/` | list, get, board, reparse |
| `agent.ts` | `/api/workspaces/{id}/agent/runs/` | CRUD, logs, SSE stream（pending/running 连接，历史回放去重）, submit input（用户指导提交） |
| `approvals.ts` | `/api/workspaces/{id}/approvals/` | pending, history, approve, reject |
| `audit.ts` | `/api/workspaces/{id}/audit` | list (with filters) |
| `incidents.ts` | `/api/workspaces/{id}/incidents/`, `/api/incidents/` | CRUD, postmortem |
| `releases.ts` | `/api/workspaces/{id}/releases/`, `/api/releases/` | CRUD, approve, deploy, promote, rollback |
| `runtime.ts` | `/api/workspaces/{id}/runtime/` | progress, user-inputs, artifacts |
| `knowledge.ts` | `/api/workspaces/{id}/knowledge/`, `/quicklog/` | list, get |
| `scan-docs.ts` | `/api/workspaces/{id}/scan-docs/` | list, get, reparse |
| `health.ts` | `/api/health` | getHealth |
| `spec-workspaces.ts` | `/api/workspaces/{id}/spec-workspace/` | get, import, sync, bootstrap（异步返回 agent_run_id + stream_url + status）、conflicts, update |
| `git-identities.ts` | `/api/git/identities/`, `/api/git/check-access` | CRUD, access check |
| `settings.ts` | `/api/settings/`, `/api/users/` | settings CRUD, user CRUD |
| `archive.ts` | `/api/workspaces/{id}/changes/{id}/` | archive, distill |
| `worktree.ts` | `/api/workspaces/{id}/worktrees/`, `/api/worktrees/` | acquire, list, get, release, extend |
| `git-gateway.ts` | `/api/worktrees/{id}/git` | execute git operations |
| `tool-gateway.ts` | `/api/worktrees/{id}/tools` | execute tools (file ops, shell) |
| `change-writer.ts` | `/api/workspaces/{id}/changes/` | create change, batch-generate documents |

## 认证机制

### Token 流程

1. **登录**：POST `/api/auth/login` (email + password) → 获取 `TokenPair`
   - `access_token`：短期访问令牌
   - `refresh_token`：长期刷新令牌
   - `access_expires_in` / `refresh_expires_in`：过期时间（秒）
2. **存储**：Token 写入 Zustand `useSession` store → 自动持久化到 localStorage
3. **使用**：`apiFetch` 每次请求自动从 store 读取并附加 `Authorization: Bearer` 头
4. **刷新**：收到 401 响应时，自动尝试 POST `/api/auth/refresh` 换取新 token
5. **失败**：Refresh 失败 → 清除 store → 重定向 `/login`

### Session Store

```typescript
interface SessionState {
  hydrated: boolean;           // Zustand persist 水合完成标志
  user: SessionUser | null;    // { id, email, displayName }
  accessToken: string | null;
  refreshToken: string | null;
}
```

- 使用 `zustand/middleware/persist` 持久化到 `localStorage`
- key: `multi-agent-platform.session`
- `hydrated` 标志确保服务端/客户端渲染一致性
- `onRehydrateStorage` 回调在水合完成后设置 `hydrated = true`

### 认证守卫

DashboardLayout 实现客户端认证守卫：
```typescript
useEffect(() => {
  if (!hydrated) return;
  if (!accessToken) router.replace("/login");
}, [hydrated, accessToken, router]);
```

### SSE 认证

Agent 日志流通过 SSE (EventSource) 传输，认证方式为 URL query 参数：
```typescript
url.searchParams.set("token", accessToken);
const es = new EventSource(url.toString());
```

Bootstrap SSE 连接：Workspace 详情页点击 Bootstrap 后，前端调用 `/spec-bootstrap` 获取 `agent_run_id` 和 `stream_url`，立即通过 `streamAgentRunLogs(workspaceId, runId)` 建立 SSE 连接。SSE 推送包含 stdout/stderr/tool_call/pending_input/user_input 五种通道。前端对 pending_input 渲染交互输入面板，用户提交指导后通过 `POST /agent/runs/{run_id}/input` 提交，提交结果通过 SSE 的 user_input 事件回传。

### Bootstrap API

Workspace 详情页的 Bootstrap 流程使用以下 API 组合：

1. `POST /api/workspaces/{id}/spec-bootstrap` — 触发异步 bootstrap，返回 `BootstrapResult`（含 `agent_run_id`, `stream_url`, `status`）
2. `GET /api/workspaces/{id}/agent/runs/{run_id}/stream` — SSE 实时日志流，展示 bootstrap 执行进度
3. `POST /api/workspaces/{id}/agent/runs/{run_id}/input` — 用户指导输入提交（回复 pending_input）

## 外部依赖分析

### 运行时依赖

| 依赖 | 用途 | 使用程度 |
|------|------|---------|
| `next` | 框架核心 (App Router, SSR, rewrites) | 高 |
| `react` / `react-dom` | UI 渲染 | 高 |
| `zustand` | 全局状态管理 (session) | 中 (仅 1 个 store) |
| `@tanstack/react-query` | 服务端状态管理 | 低 (已安装未大量使用) |
| `@xyflow/react` | 流程图/拓扑图可视化 | 低 (仅 topology 页面) |
| `lucide-react` | 图标库 | 中 (侧边栏图标) |
| `zod` | 运行时类型校验 | 低 (已安装未使用) |
| `clsx` + `tailwind-merge` | CSS 类名合并工具 | 高 (cn 函数) |
| `class-variance-authority` | 组件 variant 管理 | 低 (UI 原子组件) |
| `tailwindcss-animate` | Tailwind 动画插件 | 低 |

### 开发依赖

| 依赖 | 用途 |
|------|------|
| `vitest` | 单元测试框架 |
| `@testing-library/react` | React 组件测试 |
| `@testing-library/jest-dom` | DOM 断言扩展 |
| `@vitejs/plugin-react` | Vitest React 支持 |
| `jsdom` | 测试环境 DOM 模拟 |
| `typescript` | 类型检查 |
| `eslint` + `eslint-config-next` | 代码检查 |
| `tailwindcss` + `autoprefixer` + `postcss` | 样式处理 |

### 未使用/低使用率依赖

- `@tanstack/react-query`：已安装 (v5.51.0)，但页面主要使用 useState+useEffect 模式
- `zod`：已安装 (v3.23.0)，但未发现表单校验使用
- `@xyflow/react`：已安装 (v12.10.2)，仅 topology 页面使用

## 环境变量

| 变量 | 用途 | 默认值 |
|------|------|--------|
| `INTERNAL_API_BASE_URL` | SSR 直连后端 URL | — |
| `NEXT_PUBLIC_API_BASE_URL` | 客户端后端 URL (仅 fallback) | — |
| `NEXT_BUILD_STANDALONE` | 启用 standalone 输出模式 | `"1"` |
| 两者均未设置时 | 兜底后端地址 | `http://localhost:8000` |

## 构建与部署

- **开发**：`pnpm dev` — Next.js 开发服务器 (默认 3000 端口)
- **构建**：`pnpm build` — 生产构建
- **Standalone 输出**：`NEXT_BUILD_STANDALONE=1 pnpm build` — 生成独立部署包
- **运行**：`pnpm start` — 启动生产服务器
- **Node 要求**：`>=20.0.0`
