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
  +-- SSE 直连（绕过代理缓冲）
        +-- NEXT_PUBLIC_API_BASE_URL 直接连接
```

## 页面路由

### 路由组设计

| 路由组      | 路径前缀                 | 布局             | Auth Guard |
| ----------- | ------------------------ | ---------------- | ---------- |
| (auth)      | /login                   | 无（独立页面）    | 无         |
| (dashboard) | /workspaces, /settings   | AppShell（侧边栏 + 内容区） | 有（检测 accessToken） |

### 核心路由表

| 路径                                             | 功能              |
| ------------------------------------------------ | ----------------- |
| `/`                                              | 首页（健康检查）  |
| `/login`                                         | 登录              |
| `/workspaces`                                    | Workspace 列表    |
| `/workspaces/[id]`                               | Workspace 详情    |
| `/workspaces/[id]/components`                    | 组件关系列表      |
| `/workspaces/[id]/components/topology`           | 拓扑图            |
| `/workspaces/[id]/changes`                       | 变更列表          |
| `/workspaces/[id]/changes/[cid]`                 | 变更详情          |
| `/workspaces/[id]/changes/[cid]/tasks`           | 任务看板          |
| `/workspaces/[id]/changes/[cid]/tasks/[tid]`     | 任务详情          |
| `/workspaces/[id]/create-change`                 | 创建变更          |
| `/workspaces/[id]/scan-docs`                     | 扫描文档          |
| `/workspaces/[id]/runtime`                       | 运行时监控        |
| `/workspaces/[id]/knowledge`                     | 知识库            |
| `/workspaces/[id]/releases`                      | 发布管理          |
| `/workspaces/[id]/agent`                         | Agent 控制台      |
| `/workspaces/[id]/approvals`                     | 审批中心          |
| `/workspaces/[id]/audit`                         | 审计日志          |
| `/workspaces/[id]/incidents`                     | 事件列表          |
| `/workspaces/[id]/incidents/[iid]`               | 事件详情          |
| `/settings`                                      | 系统设置          |
| `/settings/git-identities`                       | Git 身份管理      |

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

## 状态管理

### Zustand Store

项目使用 **单一 Zustand Store**（`stores/session.ts`），仅管理认证会话状态：

```typescript
SessionState {
  hydrated: boolean          // SSR hydration 完成标志
  user: SessionUser | null   // 当前用户信息
  accessToken: string | null // JWT Access Token
  refreshToken: string | null// JWT Refresh Token
  // Actions
  setUser / setTokens / clear / markHydrated
}
```

- 使用 `persist` middleware 持久化到 `localStorage`（key: `multi-agent-platform.session`）
- `hydrated` 标志用于解决 Zustand persist 异步 hydration 的竞态问题

### 页面级状态

所有业务页面使用 React `useState` + `useEffect` 管理本地状态，没有使用 React Query 等服务端状态库。每个页面自行管理 loading / error / data 三态。

## API 层架构

### apiFetch 核心客户端

```
apiFetch<T>(path, options) --> Promise<T>
  +-- URL 解析：浏览器用相对路径（走 rewrite），SSR 用绝对路径
  +-- 自动附加 Authorization: Bearer <accessToken>
  +-- 自动附加 x-request-id（crypto.randomUUID）
  +-- 401 自动刷新：调用 /api/auth/refresh，成功后重试一次
  +-- 401 刷新失败：清除 session，跳转 /login
  +-- 错误包装：抛出 ApiError { status, code, message, requestId, details }
```

### SSE 实时流

Agent 日志流通过三种方式实现：

1. **EventSource 直连** (`agent.ts:streamAgentRunLogs`) -- 绕过 Next.js rewrite proxy，直接连接后端 SSE 端点
2. **Next.js Route Handler 代理** (`app/api/workspaces/[workspaceId]/agent/runs/[runId]/stream/route.ts`) -- 服务端转发 SSE 流
3. **AgentRunStreamClient** (`agent-stream.ts`) -- 高级 SSE 客户端，支持自动重连（5 次指数退避）、消息去重（log_id）、断线日志回填

## 认证流程

```
1. 用户在 /login 提交 email + password
2. 调用 POST /api/auth/login --> 获取 { access_token, refresh_token }
3. 调用 GET /api/auth/me --> 获取用户信息
4. 存入 Zustand session store（persisted to localStorage）
5. Dashboard layout 检查 accessToken --> 无则跳转 /login
6. apiFetch 在每次请求自动附加 Bearer Token
7. 401 时自动尝试 refresh --> 失败则清除 session 并跳转 /login
```

## API 代理架构

```
浏览器请求 /api/*
  |
  +-- 普通请求 --> next.config.mjs rewrite --> 后端 FastAPI
  |     source: /api/:path*
  |     destination: {INTERNAL_API_BASE_URL}/api/:path*
  |
  +-- SSE 请求 --> 直连后端（需 NEXT_PUBLIC_API_BASE_URL）
        或通过 Route Handler 代理
```

环境变量优先级：
- `INTERNAL_API_BASE_URL`（SSR / Route Handler）
- `NEXT_PUBLIC_API_BASE_URL`（浏览器端）
- 默认 `http://localhost:8000`

## SillySpec 工作流集成

变更详情页（`changes/[cid]/page.tsx`）实现了完整的 SillySpec 工作流阶段流转：

```
draft --> scan --> brainstorm --> propose --> plan --> execute --> verify --> accepted --> archive
  |                                                                                      ^
  +--> quick -----------------------------------------------------------------------------+
                                                                                          |
rework_required --> propose / plan / execute（退回）
```

每个阶段对应后端 Agent Dispatch，前端通过 `SillySpecStepProgress` 组件展示步骤执行进度。
