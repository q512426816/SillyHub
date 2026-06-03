---
author: qinyi
created_at: 2026-06-03T20:35:00+08:00
---

# Frontend - 架构文档

## 架构概览

本项目采用 **Next.js 14 App Router** 架构，是一个纯客户端渲染的 SPA 风格应用（所有业务页面均标记 `"use client"`）。Next.js 主要用作路由框架和 API 代理层。

```
浏览器
  |
  +-- Next.js App Router (页面路由)
  |     +-- (auth) 路由组 -- 登录页（无 Auth Guard）
  |     +-- (dashboard) 路由组 -- 业务页面（Auth Guard + AppShell）
  |
  +-- Next.js Rewrite Proxy
  |     +-- /api/* --> 后端 FastAPI (localhost:8000)
  |
  +-- SSE 代理
        +-- Route Handler 代理（/api/.../stream）
        +-- 直连后端（NEXT_PUBLIC_API_BASE_URL）
```

## 页面路由

### 路由组设计

| 路由组 | 路径前缀 | 布局 | Auth Guard |
|--------|----------|------|------------|
| (auth) | /login | 无（独立页面） | 无 |
| (dashboard) | /workspaces, /settings | AppShell（侧边栏 + 内容区） | 有（检测 accessToken） |

### 核心路由表

| 路径 | 功能 |
|------|------|
| `/` | 首页（健康检查） |
| `/login` | 登录 |
| `/workspaces` | Workspace 列表 |
| `/workspaces/[id]` | Workspace 详情 |
| `/workspaces/[id]/components` | 组件关系列表 |
| `/workspaces/[id]/components/topology` | 拓扑图 |
| `/workspaces/[id]/changes` | 变更列表 |
| `/workspaces/[id]/changes/[cid]` | 变更详情 |
| `/workspaces/[id]/changes/[cid]/tasks` | 任务看板 |
| `/workspaces/[id]/changes/[cid]/tasks/[tid]` | 任务详情 |
| `/workspaces/[id]/create-change` | 创建变更 |
| `/workspaces/[id]/scan-docs` | 扫描文档 |
| `/workspaces/[id]/runtime` | 运行时监控 |
| `/workspaces/[id]/knowledge` | 知识库 |
| `/workspaces/[id]/releases` | 发布管理 |
| `/workspaces/[id]/agent` | Agent 控制台 |
| `/workspaces/[id]/approvals` | 审批中心 |
| `/workspaces/[id]/audit` | 审计日志 |
| `/workspaces/[id]/incidents` | 事件列表 |
| `/workspaces/[id]/incidents/[iid]` | 事件详情 |
| `/settings` | 系统设置 |
| `/settings/git-identities` | Git 身份管理 |

## 组件层次

```
RootLayout (layout.tsx)
  +-- (auth)/login/page.tsx
  |     +-- 独立登录表单
  |
  +-- (dashboard)/layout.tsx [Auth Guard]
        +-- AppShell
              +-- 侧边栏（可折叠）
              |     +-- 品牌标识
              |     +-- Overview 导航组（Workspace 首页 / 组件 / 拓扑 / 变更 / 扫描文档 / 运行时 / 知识 / 发布）
              |     +-- Management 导航组（Git 身份 / Agent / 审批 / 审计 / 事件）
              |     +-- System 导航组（设置）
              |     +-- 用户信息 + 退出
              |     +-- 折叠切换
              +-- 内容区
                    +-- 各业务页面（使用 useState + useEffect 管理状态）
```

### 认证守卫机制

`DashboardLayout` 实现 `"use client"` 客户端认证守卫：
- 从 Zustand store 读取 `hydrated` 和 `accessToken`
- 未 hydrated 时返回 `null`（避免 hydration 闪烁）
- 无 `accessToken` 时通过 `router.replace("/login")` 跳转
- 已认证时渲染 `AppShell` 包裹子页面

### AppShell 组件职责

- **侧边栏导航**：三组导航（Overview 7 项 / Management 5 项 / System 1 项）
- **动态路由感知**：从 `usePathname()` 提取 `workspaceId`，解析相对导航链接为绝对路径
- **侧边栏折叠**：状态持久化到 `localStorage`（key: `sidebar-collapsed`），宽度 260px / 60px 切换
- **认证信息展示**：用户名 + 退出按钮（调用后端 logout API 后清除 store 跳转到 `/login`）
- **导航项禁用**：当不在 Workspace 上下文中时，非绝对路径导航项显示为灰色不可点击

## 状态管理

### Zustand Store

项目使用 **单一 Zustand Store**（`stores/session.ts`），仅管理认证会话状态：

```typescript
SessionState {
  hydrated: boolean          // persist hydration 完成标志
  user: SessionUser | null   // { id, email, displayName }
  accessToken: string | null // JWT Access Token
  refreshToken: string | null// JWT Refresh Token
  // Actions
  setUser / setTokens / clear / markHydrated
}
```

- 使用 `persist` middleware 持久化到 `localStorage`（key: `multi-agent-platform.session`，version: 1）
- `onRehydrateStorage` 回调设置 `hydrated = true`，解决 Zustand persist 异步 hydration 的竞态问题
- `apiFetch` 通过 `useSession.getState()` 在非 React 上下文中读取 token

### 页面级状态

所有业务页面使用 React `useState` + `useEffect` 管理本地状态。每个页面自行管理 loading / error / data 三态，采用如下模式：

```typescript
type FetchState =
  | { kind: "loading" }
  | { kind: "ok"; data: T }
  | { kind: "error"; message: string };
```

部分页面使用轮询机制（如 `HealthCard` 每 5 秒刷新、Agent 页面轮询 Agent Run 状态）。

## API 层架构

### apiFetch 核心客户端

```
apiFetch<T>(path, options) --> Promise<T>
  +-- URL 解析：浏览器用相对路径（走 rewrite），SSR 用绝对路径
  +-- 自动附加 Authorization: Bearer <accessToken>
  +-- 自动附加 x-request-id（crypto.randomUUID）
  +-- 支持 json body（自动设置 content-type）和 query 参数
  +-- 401 自动刷新：调用 /api/auth/refresh，成功后重试一次（x-auth-retry 标志防循环）
  +-- 401 刷新失败：清除 session，跳转 /login
  +-- 错误包装：抛出 ApiError { status, code, message, requestId, details }
  +-- 网络错误：包装为 ApiError(status=0, code='network_error')
```

### SSE 实时流

Agent 日志流通过两种方式实现：

1. **EventSource 连接**（`agent.ts:streamAgentRunLogs`）-- 函数式 API，接收 onMessage / onDone / onError 回调
2. **AgentRunStreamClient**（`agent-stream.ts`）-- 面向对象 API，支持自动重连（5 次指数退避: 1s/2s/4s/8s/16s）、消息去重（seenLogIds Set）、断线日志回填（getAgentRunLogs after=lastLogId）

SSE 代理通过两种路径：
- **Route Handler 代理**：`app/api/workspaces/[workspaceId]/agent/runs/[runId]/stream/route.ts`，服务端转发后端 SSE 流，设置 `X-Accel-Buffering: no`
- **直连后端**：通过 `getDirectApiBaseUrl()` 返回 `NEXT_PUBLIC_API_BASE_URL`，绕过 Next.js rewrite 缓冲

## 认证流程

```
1. 用户在 /login 提交 email + password
2. 调用 POST /api/auth/login --> 获取 { access_token, refresh_token }
3. 调用 GET /api/auth/me --> 获取用户信息 { id, email, display_name }
4. 存入 Zustand session store（persisted to localStorage）
5. DashboardLayout 检查 accessToken --> 无则跳转 /login
6. apiFetch 在每次请求自动附加 Bearer Token
7. 401 时自动尝试 refresh --> 失败则清除 session 并跳转 /login
8. SSE 连接通过 URL query 参数 ?token=xxx 传递认证
```

## API 代理架构

```
浏览器请求 /api/*
  |
  +-- 普通请求 --> next.config.mjs rewrite --> 后端 FastAPI
  |     source: /api/:path*
  |     destination: {INTERNAL_API_BASE_URL}/api/:path*
  |
  +-- SSE 请求 --> Route Handler 代理 或 直连后端（需 NEXT_PUBLIC_API_BASE_URL）
```

环境变量优先级：
- `INTERNAL_API_BASE_URL`（SSR / Route Handler，服务端专用）
- `NEXT_PUBLIC_API_BASE_URL`（客户端 + 服务端，暴露到浏览器 bundle）
- 默认 `http://localhost:8000`

## SillySpec 工作流集成

变更详情页实现了完整的 SillySpec 工作流阶段流转：

```
draft --> scan --> brainstorm --> propose --> plan --> execute --> verify --> accepted --> archive
  |                                                                                      ^
  +--> quick -----------------------------------------------------------------------------+
                                                                                          |
rework_required --> propose / plan / execute（退回）
```

每个阶段对应后端 Agent Dispatch，前端通过 `SillySpecStepProgress` 组件展示步骤执行进度（横向步骤条 + Agent 运行状态 + 手动触发按钮）。

## 组件兼容层

`lib/components.ts` 提供了将 Workspace 映射为 Component 的兼容层：
- 后端重构后 "components" 变为 "child workspaces"（`component_key !== null`）
- `listComponents()` 通过客户端过滤所有 Workspace 的 `root_path` 前缀匹配来模拟组件列表
- `workspaceToComponent()` 将 Workspace 对象映射为 Component 类型
- 保留此层是为了让尚未完全迁移的页面（如拓扑图）仍能正常工作
