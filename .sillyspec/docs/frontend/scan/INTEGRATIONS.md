---
author: qinyi
created_at: 2026-06-10T00:00:00
---

# Frontend 外部集成

## 后端 API 集成

### 通信方式

| 方式 | 用途 | 实现位置 |
|------|------|----------|
| REST (JSON) | 所有 CRUD 操作 | `src/lib/api.ts` → `apiFetch` |
| SSE (EventSource) | Agent 日志实时流 | `src/lib/agent-stream.ts` → `AgentRunStreamClient` |
| Next.js Rewrite | `/api/*` 代理到后端 | `next.config.mjs` → rewrites |
| BFF API Route | SSE 代理 (避免 Next rewrite 缓冲) | `src/app/api/.../stream/route.ts` |

### API 基础 URL 解析逻辑

- **浏览器端**: 使用相对路径，通过 Next.js rewrite 代理到后端
- **SSR 端**: 使用 `INTERNAL_API_BASE_URL` 或 `NEXT_PUBLIC_API_BASE_URL` 或 `http://localhost:8000`
- **SSE 直连**: 优先使用 `NEXT_PUBLIC_API_BASE_URL`，不存在时 fallback 到相对路径

### 认证集成

- JWT Bearer Token 认证，token 自动附加到所有 API 请求
- 401 时自动 refresh + 重试一次
- refresh 失败则清除 session 并跳转 `/login`

### 后端 API 模块映射

| 前端 lib 文件 | 后端 API 前缀 | 功能 |
|---------------|---------------|------|
| `workspaces.ts` | `/api/workspaces` | 工作空间 CRUD、扫描、拓扑 |
| `changes.ts` | `/api/workspaces/{id}/changes` | 变更管理、工作流、审批 |
| `agent.ts` | `/api/workspaces/{id}/agent` | Agent Run 创建/查询/日志/终止 |
| `tasks.ts` | `/api/workspaces/{id}/tasks` | 任务管理 |
| `components.ts` | `/api/workspaces/{id}/components` | 组件管理 |
| `releases.ts` | `/api/workspaces/{id}/releases` | 发布管理 |
| `incidents.ts` | `/api/workspaces/{id}/incidents` | 事件管理 |
| `approvals.ts` | `/api/workspaces/{id}/approvals` | 审批管理 |
| `audit.ts` | `/api/workspaces/{id}/audit` | 审计日志 |
| `knowledge.ts` | `/api/workspaces/{id}/knowledge` | 知识库 |
| `scan-docs.ts` | `/api/workspaces/{id}/scan-docs` | 扫描文档 |
| `daemon.ts` | `/api/daemon` | Daemon 运行时管理 |
| `auth.ts` | `/api/auth` | 认证 (login/logout/refresh/me) |
| `git-identities.ts` | `/api/git-identities` | Git 身份管理 |
| `git-gateway.ts` | `/api/git-gateway` | Git 操作代理 |
| `tool-gateway.ts` | `/api/tool-gateway` | 工具执行代理 |
| `worktree.ts` | `/api/workspaces/{id}/worktrees` | Git worktree 管理 |
| `health.ts` | `/api/health` | 健康检查 |

## 第三方库集成

### shadcn/ui

- 配置文件: `components.json`
- 基础组件: `src/components/ui/` (button, badge, input)
- 主题: Slate base color + CSS Variables

### React Flow (@xyflow/react)

- 仅在 `workspaces/[id]/components/topology/page.tsx` 中使用
- 用于渲染工作空间组件拓扑图
- 导入 `@xyflow/react/dist/style.css` 内置样式

### Markdown 渲染

- 使用 `@uiw/react-markdown-preview` 渲染 Markdown 内容
- 主要用于变更文档、扫描文档的展示

### Lucide Icons

- 图标库 `lucide-react` 提供所有 UI 图标
- 替代方案: 部分导航使用 emoji 字符

## 环境变量

| 变量 | 用途 | 必须 |
|------|------|------|
| `NEXT_PUBLIC_API_BASE_URL` | 后端 API 地址 (浏览器端) | SSE 直连时需要 |
| `INTERNAL_API_BASE_URL` | 后端 API 地址 (SSR) | Docker 部署时需要 |
| `NEXT_BUILD_STANDALONE` | 启用 standalone 输出 | Docker 部署时需要 |
