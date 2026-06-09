---
author: qinyi
created_at: 2026-06-01T12:00:00
---

# frontend_app
> 最后更新：2026-06-09
> 最近变更：ql-20260609-002（Agent 控制台日志展示优化）
> 模块路径：frontend/src/app/**

## 职责

Frontend App 模块是 Next.js 14 App Router 的页面路由层，负责定义所有页面和布局结构。使用 React Server Components（RSC）+ Client Components 混合模式，实现服务端渲染和客户端交互。

## 当前设计

### 布局结构

```
layout.tsx (根布局)
  └── (dashboard)/layout.tsx (Dashboard 布局 — 认证守卫 + AppShell)
        ├── workspaces/           — 工作区管理
        ├── settings/             — 系统设置
        └── (auth)/login/         — 登录页（无认证守卫）
```

### 页面清单

| 路由分组 | 路径 | 文件 | 说明 |
|----------|------|------|------|
| 根 | `/` | `page.tsx` | 首页/重定向 |
| auth | `/login` | `(auth)/login/page.tsx` | 登录页 |
| dashboard | `/workspaces` | `(dashboard)/workspaces/page.tsx` | 工作区列表 |
| dashboard | `/workspaces/[id]` | `(dashboard)/workspaces/[id]/page.tsx` | 工作区详情 |
| dashboard | `/workspaces/[id]/scan-docs` | `.../scan-docs/page.tsx` | 扫描文档查看 |
| dashboard | `/workspaces/[id]/components` | `.../components/page.tsx` | 组件列表 |
| dashboard | `/workspaces/[id]/components/topology` | `.../topology/page.tsx` | 拓扑图 |
| dashboard | `/workspaces/[id]/changes` | `.../changes/page.tsx` | 变更列表（状态列 human_gate 展示、阶段列 null 兜底、类型列颜色映射、影响组件标签） |
| dashboard | `/workspaces/[id]/create-change` | `.../create-change/page.tsx` | 创建变更 |
| dashboard | `/workspaces/[id]/changes/[cid]` | `.../changes/[cid]/page.tsx` | 变更详情 |
| dashboard | `/workspaces/[id]/changes/[cid]/tasks` | `.../tasks/page.tsx` | 任务列表 |
| dashboard | `/workspaces/[id]/changes/[cid]/tasks/[tid]` | `.../tasks/[tid]/page.tsx` | 任务详情 |
| dashboard | `/workspaces/[id]/agent` | `.../agent/page.tsx` | Agent 运行 |
| dashboard | `/workspaces/[id]/approvals` | `.../approvals/page.tsx` | 审批列表 |
| dashboard | `/workspaces/[id]/audit` | `.../audit/page.tsx` | 审计日志 |
| dashboard | `/workspaces/[id]/runtime` | `.../runtime/page.tsx` | 运行时状态 |
| dashboard | `/workspaces/[id]/incidents` | `.../incidents/page.tsx` | 事件列表 |
| dashboard | `/workspaces/[id]/incidents/[iid]` | `.../incidents/[iid]/page.tsx` | 事件详情 |
| dashboard | `/workspaces/[id]/knowledge` | `.../knowledge/page.tsx` | 知识库 |
| dashboard | `/workspaces/[id]/releases` | `.../releases/page.tsx` | 发布管理 |
| dashboard | `/settings` | `(dashboard)/settings/page.tsx` | 设置页 |
| dashboard | `/settings/git-identities` | `.../git-identities/page.tsx` | Git 身份管理 |

### 布局说明

- **根布局** (`layout.tsx`)：设置 HTML lang=zh-CN、全局 CSS、metadata（title: "Multi-Agent Platform"）
- **Dashboard 布局** (`(dashboard)/layout.tsx`)：客户端组件，使用 `useSession` 做认证守卫，未登录重定向到 `/login`，已登录包裹 `AppShell`

## 对外接口

| 导出 | 类型 | 说明 |
|------|------|------|
| `RootLayout` | 默认导出 (Server Component) | 根布局，设置全局 HTML 结构 |
| `DashboardLayout` | 默认导出 (Client Component) | Dashboard 认证守卫布局 |
| `metadata` | 命名导出 | 根页面元数据 |

## 关键数据流

```
用户访问任意 /xxx 路径
  → DashboardLayout 检查 useSession.hydrated + accessToken
  → 未登录 → router.replace("/login")
  → 已登录 → AppShell（侧边栏 + 主内容区）→ 渲染对应 page.tsx
  → page.tsx 中调用 frontend/lib/*.ts 获取数据
```

## 设计决策

| 决策 | 原因 |
|------|------|
| Next.js App Router 路由组 `(dashboard)` / `(auth)` | 共享布局但隔离 URL 前缀 |
| Dashboard 布局使用 Client Component | 需要访问 Zustand session store 和 router |
| 根布局使用 Server Component | 无需客户端状态，优化首屏性能 |
| `suppressHydrationWarning` | 避免暗色模式 class 水合警告 |

## 依赖关系

- **内部依赖**：`@/components/app-shell`（AppShell 组件）, `@/stores/session`（useSession）, `@/lib/*`（数据获取函数）
- **外部依赖**：Next.js App Router, React 18, Next Navigation

## 注意事项

- `(dashboard)/layout.tsx` 在 `hydrated === false` 时返回 null（等待 Zustand persist rehydrate）
- 所有 dashboard 下页面依赖 `useSession` 已认证状态
- 路由使用 Next.js 动态路由 `[id]`、`[cid]`、`[tid]`、`[iid]`

## 变更索引

| 日期 | 变更 | 摘要 |
|------|------|------|
| 2026-06-05 | ql-20260605-001 | 变更详情页文档实时刷新 + Gate面板突出显示 |
| 2026-06-05 | 2026-06-05-agent-74b61b | Agent 控制台移除 max-w-6xl 宽度限制，日志区域撑满主内容区 |
| 2026-06-08 | 2026-06-08-change-center-columns | 变更列表列展示优化：human_gate 状态列 + draft 兜底 + 类型颜色 + 影响组件 |
| 2026-06-09 | ql-20260609-002 | Agent 控制台日志展示优化：BashToolPreview + 扫描自检摘要 + 结果摘要列 + 状态区分 |
| 2026-06-09 | ql-20260609-003 | Agent 控制台日志区域高度增加至 1.5 倍（480→720px, 320→480px） |
| 2026-06-09 | ql-20260609-004 | Workspace Bootstrap 日志区域改为 Agent 控制台同款深色样式 |
| 2026-06-09 | ql-20260609-005-d2f7 | Bootstrap 日志区域完全复用共享 AgentLogViewer 组件 |
| 2026-06-09 | ql-20260609-007-b4c2 | 工作区详情页显示上一次 Bootstrap 运行结果摘要 |
