---
author: scan-agent
created_at: "2026-06-03"
---

# SillyHub Frontend — 项目概述

## 基本信息

- **包名**: `multi-agent-platform-web`
- **版本**: `0.1.0`
- **框架**: Next.js 14.2.5 (App Router) + React 18.3.1
- **语言**: TypeScript 5.5.4 (strict mode)
- **包管理器**: pnpm 9.6.0
- **Node 要求**: >= 20.0.0
- **UI 方案**: Tailwind CSS 3.4.7 + class-variance-authority + tailwindcss-animate
- **图标库**: lucide-react

## 核心依赖

| 类别 | 库 | 版本 |
|------|-----|------|
| 状态管理 | zustand | ^4.5.0 |
| 数据请求 | @tanstack/react-query | ^5.51.0（已安装但页面未实际使用） |
| 表单校验 | zod | ^3.23.0（已安装但未广泛使用） |
| Markdown 预览 | @uiw/react-markdown-preview | ^5.2.1 |
| 流程图/拓扑 | @xyflow/react | ^12.10.2 |
| CSS 工具 | clsx + tailwind-merge | ^2.1.1 / ^2.4.0 |

## 页面统计

前端共有 **21 个页面文件**（`src/app/` 下的 `page.tsx`），按路由组分布：

### 根路由
- `/` — 首页（健康检查 + 入口）

### `(auth)` 路由组（公开，无需认证）
- `/login` — 登录页

### `(dashboard)` 路由组（需认证，AppShell 侧边栏）
- `/workspaces` — Workspace 列表
- `/workspaces/[id]` — Workspace 详情（Spec Workspace 管理、Bootstrap SSE）
- `/workspaces/[id]/components` — 子组件列表
- `/workspaces/[id]/components/topology` — 拓扑图（@xyflow/react）
- `/workspaces/[id]/changes` — 变更列表
- `/workspaces/[id]/changes/[cid]` — 变更详情（文档矩阵、Agent dispatch）
- `/workspaces/[id]/changes/[cid]/tasks` — 任务看板
- `/workspaces/[id]/changes/[cid]/tasks/[tid]` — 任务详情
- `/workspaces/[id]/create-change` — 创建变更
- `/workspaces/[id]/scan-docs` — 扫描文档浏览
- `/workspaces/[id]/runtime` — 运行时进度
- `/workspaces/[id]/knowledge` — 知识库 & 日志
- `/workspaces/[id]/releases` — 发布管理
- `/workspaces/[id]/agent` — Agent 控制台
- `/workspaces/[id]/incidents` — 事件列表
- `/workspaces/[id]/incidents/[iid]` — 事件详情
- `/workspaces/[id]/audit` — 审计日志
- `/workspaces/[id]/approvals` — 审批中心
- `/settings` — 全局设置
- `/settings/git-identities` — Git 身份管理

### API Route Handler
- `/api/workspaces/[workspaceId]/agent/runs/[runId]/stream` — SSE 代理

## 开发命令

```bash
pnpm dev          # 启动开发服务器 (next dev)
pnpm build        # 生产构建 (next build)
pnpm start        # 启动生产服务器 (next start)
pnpm lint         # ESLint 检查 (next lint)
pnpm typecheck    # TypeScript 类型检查 (tsc --noEmit)
pnpm test         # 运行测试 (vitest run，单次)
pnpm test:watch   # 监听模式运行测试 (vitest)
```

## 项目定位

这是 SillyHub 多智能体平台的前端，核心功能包括：
1. **Workspace 管理** — 注册、扫描、解析项目工作区及其子组件
2. **变更管理（Change）** — 创建/执行变更、SillySpec 阶段流转、审批
3. **Agent 运行** — 触发/监控/输入 Agent 执行，SSE 实时日志流
4. **知识 & 文档** — 浏览扫描文档、知识库、Markdown 预览
5. **运维功能** — 发布、事件管理、审计、审批、健康监控
