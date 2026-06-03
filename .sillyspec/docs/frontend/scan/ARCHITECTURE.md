---
author: qinyi
created_at: 2026-06-03T00:00:00
---

# Frontend (Next.js) — 架构文档

## 技术栈

| 类别         | 技术 / 库                              | 版本          |
|--------------|----------------------------------------|---------------|
| 语言         | TypeScript                             | 5.5.4         |
| 框架         | Next.js                                | 14.2.5        |
| UI 库        | React                                  | 18.3.1        |
| 样式         | Tailwind CSS + tailwind-merge + CVA    | 3.4.7         |
| 状态管理     | Zustand                                | ^4.5.0        |
| 数据请求     | @tanstack/react-query                  | ^5.51.0       |
| 图表/流程    | @xyflow/react                          | ^12.10.2      |
| Markdown     | @uiw/react-markdown-preview            | ^5.2.1        |
| 图标         | lucide-react                           | ^0.400.0      |
| 校验         | Zod                                    | ^3.23.0       |
| 包管理       | pnpm                                   | 9.6.0         |
| 测试         | Vitest + Testing Library + jsdom       | ^2.0.0        |
| Lint         | ESLint + eslint-config-next            | 8.57.0        |

## 架构概览

### 整体架构模式

前端采用 **Next.js App Router** 架构，基于文件系统路由：

```
frontend/
├── src/
│   ├── app/                 # Next.js App Router 页面
│   │   ├── (auth)/          # 认证路由组（无侧边栏布局）
│   │   │   └── login/
│   │   ├── (dashboard)/     # 仪表盘路由组（带侧边栏布局）
│   │   │   ├── layout.tsx
│   │   │   ├── settings/
│   │   │   └── workspaces/
│   │   ├── api/             # Next.js API Routes
│   │   ├── globals.css      # 全局样式
│   │   ├── layout.tsx       # 根布局
│   │   └── page.tsx         # 首页
│   ├── components/          # 共享 UI 组件
│   │   ├── ui/              # 基础 UI 组件（button, input, badge）
│   │   └── *.tsx            # 业务组件
│   └── lib/                 # API 客户端 + 工具函数
│       ├── api.ts           # 基础 API 客户端
│       ├── *.ts             # 各模块 API 封装
│       └── __tests__/       # API 客户端测试
├── package.json
├── tsconfig.json
├── tailwind.config.ts
├── postcss.config.mjs
└── next.config.mjs
```

### 核心设计模式

1. **App Router 路由组**：`(auth)` 无侧边栏布局，`(dashboard)` 带侧边栏布局
2. **API 客户端层**：`src/lib/` 下每个模块一个文件，封装后端 REST API 调用
3. **SSE 流式通信**：`src/lib/agent-stream.ts` 支持 Agent 运行时的 SSE 流式输出
4. **UI 组件库**：`src/components/ui/` 提供基础 UI 原子组件（Button、Input、Badge）
5. **React Query 数据层**：使用 `@tanstack/react-query` 管理服务端状态
6. **Zustand 客户端状态**：轻量级客户端状态管理

## 数据模型（摘要）

前端不定义数据库模型。数据模型由后端 API 提供，前端通过以下方式消费：

- **API Schema**：`src/lib/` 中每个模块文件封装对应的后端 API 类型
- **运行时类型**：依赖后端 API 响应的隐式类型（无前端独立 Schema 生成）
- **主要数据实体**：Workspace、Change、Task、AgentRun、Incident、Release 等（与后端模型一一对应）

## 模块划分

### 页面路由 (`src/app/`)

| 路由 | 文件路径 | 功能 |
|------|----------|------|
| `/` | `page.tsx` | 首页/入口 |
| `/login` | `(auth)/login/page.tsx` | 用户登录 |
| `/settings` | `(dashboard)/settings/page.tsx` | 平台设置 |
| `/settings/git-identities` | `(dashboard)/settings/git-identities/page.tsx` | Git 身份管理 |
| `/workspaces` | `(dashboard)/workspaces/page.tsx` | 工作区列表 |
| `/workspaces/[id]` | `(dashboard)/workspaces/[id]/page.tsx` | 工作区详情 |
| `/workspaces/[id]/agent` | `(dashboard)/workspaces/[id]/agent/page.tsx` | Agent 运行 |
| `/workspaces/[id]/changes` | `(dashboard)/workspaces/[id]/changes/page.tsx` | 变更列表 |
| `/workspaces/[id]/changes/[cid]` | `(dashboard)/workspaces/[id]/changes/[cid]/page.tsx` | 变更详情 |
| `/workspaces/[id]/changes/[cid]/tasks/[tid]` | `.../tasks/[tid]/page.tsx` | 任务详情 |
| `/workspaces/[id]/create-change` | `.../create-change/page.tsx` | 创建变更 |
| `/workspaces/[id]/components` | `.../components/page.tsx` | 组件扫描 |
| `/workspaces/[id]/components/topology` | `.../topology/page.tsx` | 组件拓扑图 |
| `/workspaces/[id]/scan-docs` | `.../scan-docs/page.tsx` | 扫描文档 |
| `/workspaces/[id]/knowledge` | `.../knowledge/page.tsx` | 知识库 |
| `/workspaces/[id]/runtime` | `.../runtime/page.tsx` | 运行时进度 |
| `/workspaces/[id]/approvals` | `.../approvals/page.tsx` | 审批管理 |
| `/workspaces/[id]/releases` | `.../releases/page.tsx` | 发布管理 |
| `/workspaces/[id]/incidents` | `.../incidents/page.tsx` | 事件列表 |
| `/workspaces/[id]/incidents/[iid]` | `.../incidents/[iid]/page.tsx` | 事件详情 |
| `/workspaces/[id]/audit` | `.../audit/page.tsx` | 审计日志 |

### API 客户端 (`src/lib/`)

| 文件 | 对应后端模块 | 职责 |
|------|-------------|------|
| `api.ts` | -- | 基础 HTTP 客户端封装（fetch wrapper） |
| `auth.ts` | auth | 认证（登录/登出/刷新） |
| `workspaces.ts` | workspace | 工作区 CRUD、扫描 |
| `changes.ts` | change | 变更管理 |
| `change-writer.ts` | change_writer | 变更文档写入 |
| `tasks.ts` | task | 任务管理 |
| `agent.ts` | agent | Agent 运行 |
| `agent-stream.ts` | agent | Agent SSE 流式通信 |
| `spec-workspaces.ts` | spec_workspace | SillySpec 工作区 |
| `scan-docs.ts` | scan_docs | 扫描文档 |
| `runtime.ts` | runtime | 运行时状态 |
| `knowledge.ts` | knowledge | 知识库 |
| `workflow.ts` | workflow | 工作流/审批 |
| `releases.ts` | release | 发布管理 |
| `incidents.ts` | incident | 事件管理 |
| `git-gateway.ts` | git_gateway | Git 操作 |
| `git-identities.ts` | git_identity | Git 身份 |
| `tool-gateway.ts` | tool_gateway | 工具网关 |
| `worktree.ts` | worktree | Worktree 管理 |
| `archive.ts` | archive | 归档 |
| `settings.ts` | settings | 平台设置 |
| `health.ts` | health | 健康检查 |
| `audit.ts` | workflow | 审计日志 |
| `approvals.ts` | workflow | 审批 |
| `components.ts` | scan_docs | 组件数据 |
| `utils.ts` | -- | 通用工具函数 |

### 共享组件 (`src/components/`)

| 组件 | 文件 | 职责 |
|------|------|------|
| `AppShell` | `app-shell.tsx` | 应用外壳（侧边栏 + 主内容区） |
| `WorkspaceCard` | `workspace-card.tsx` | 工作区卡片 |
| `WorkspaceScanDialog` | `workspace-scan-dialog.tsx` | 工作区扫描对话框 |
| `HealthCard` | `health-card.tsx` | 健康状态卡片 |
| `SillyspecStepProgress` | `sillyspec-step-progress.tsx` | SillySpec 步骤进度条 |
| `ComponentDetailDrawer` | `component-detail-drawer.tsx` | 组件详情抽屉 |
| `Button` | `ui/button.tsx` | 按钮（CVA 变体） |
| `Input` | `ui/input.tsx` | 输入框 |
| `Badge` | `ui/badge.tsx` | 徽标 |

### 测试 (`src/lib/__tests__/`)

| 测试文件 | 覆盖范围 |
|----------|----------|
| `api.test.ts` | 基础 API 客户端 |
| `agent.test.ts` | Agent API |
| `spec-workspaces.test.ts` | SillySpec 工作区 API |
