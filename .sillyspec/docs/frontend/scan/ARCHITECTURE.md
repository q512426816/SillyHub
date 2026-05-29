---
author: qinyi
created_at: 2026-05-29T17:36:30
---

# ARCHITECTURE — frontend

## 技术栈

| 层 | 技术 | 版本 |
|----|------|------|
| 框架 | Next.js (App Router) | 14.2.5 |
| UI 库 | React | 18.3.1 |
| 语言 | TypeScript (strict) | 5.5.4 |
| 样式 | Tailwind CSS + CVA + tailwindcss-animate | 3.4.7 |
| 状态管理 | Zustand (persist middleware) | 4.5.0 |
| 数据获取 | 自定义 `apiFetch` (原生 fetch) | — |
| 拓扑可视化 | @xyflow/react | 12.10.2 |
| 验证 | Zod | 3.23.0 |
| 测试 | Vitest + Testing Library + jsdom | 2+ |
| 包管理 | pnpm | 9.6.0 |

**注意**: `@tanstack/react-query` 在 dependencies 中但未在代码中使用（无 useQuery/useMutation 导入）。

## 架构概览

**App Router + Route Groups 架构**：

```
frontend/src/
  app/                    Next.js App Router
    layout.tsx            根布局 (lang=zh-CN)
    page.tsx              首页 (/)
    (auth)/               未认证路由组（无 auth guard、无 sidebar）
      login/
    (dashboard)/          已认证路由组（auth guard + AppShell）
      layout.tsx          客户端 auth guard + AppShell
      workspaces/         工作区相关页面
      settings/           设置页面
  components/             共享组件
    ui/                   shadcn/ui 基础组件
  lib/                    工具库 + API 层 + 类型定义
  stores/                 Zustand stores
  test/                   测试配置
```

### AppShell 布局

- **Sidebar**: 固定 260px，三个导航区域（Overview / Management / System）
- **Auth Guard**: 客户端检查 Zustand store 的 `accessToken`，缺失则重定向到 `/login`

## 路由列表（22 个路由）

| 路由 | 说明 |
|------|------|
| `/` | 首页（HealthCard + 链接） |
| `/login` | 登录页 |
| `/workspaces` | 工作区列表 |
| `/workspaces/[id]` | 工作区详情 |
| `/workspaces/[id]/changes` | 变更列表 |
| `/workspaces/[id]/changes/[cid]` | 变更详情 |
| `/workspaces/[id]/changes/[cid]/tasks` | 任务列表 |
| `/workspaces/[id]/changes/[cid]/tasks/[tid]` | 任务详情 |
| `/workspaces/[id]/components` | 组件列表 |
| `/workspaces/[id]/components/topology` | 拓扑图 |
| `/workspaces/[id]/create-change` | 创建变更 |
| `/workspaces/[id]/agent` | Agent 控制台 |
| `/workspaces/[id]/approvals` | 审批 |
| `/workspaces/[id]/audit` | 审计日志 |
| `/workspaces/[id]/incidents` | 事件列表 |
| `/workspaces/[id]/incidents/[iid]` | 事件详情 |
| `/workspaces/[id]/knowledge` | 知识库 |
| `/workspaces/[id]/releases` | 发布 |
| `/workspaces/[id]/runtime` | 运行时 |
| `/workspaces/[id]/scan-docs` | 扫描文档 |
| `/settings` | 设置 |
| `/settings/git-identities` | Git 身份 |

## 数据模型

无独立数据模型。通过 `src/lib/` 中的 API 模块消费 backend 数据，约 90+ TypeScript 接口/类型分布在 19 个领域模块中。

## API 层

所有 API 调用通过 `src/lib/api.ts` 的 `apiFetch<T>()` 统一处理：
- **传输**: 原生 fetch（无 axios）
- **Base URL**: `NEXT_PUBLIC_API_BASE_URL`，默认 `http://localhost:8000`
- **自动 headers**: accept, x-request-id (UUID), Authorization Bearer
- **401 处理**: 自动尝试 refresh token → 重试 → 失败则清除 session 并跳转 /login
- **错误**: 抛出 `ApiError`（含 status, code, requestId, details）
