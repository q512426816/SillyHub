---
author: qinyi
created_at: 2026-06-10T00:00:00
---

# Frontend 项目概览

## 项目简介

Multi-Agent Platform Web 前端，是 SillySpec 原生的多 Agent 执行平台管理界面。提供工作空间管理、SillySpec 变更工作流、Agent 运行监控、拓扑可视化、审批中心等功能。

项目名称: `multi-agent-platform-web`
版本: `0.1.0`
许可证: 私有项目

## 技术栈

| 分类 | 技术 |
|------|------|
| 框架 | Next.js 14 (App Router) |
| 语言 | TypeScript 5.5 (strict) |
| UI | React 18 + Tailwind CSS 3.4 + shadcn/ui |
| 状态 | Zustand 4.5 (persist) |
| 数据 | 原生 fetch (apiFetch 封装) |
| 拓扑 | @xyflow/react (React Flow) |
| 校验 | Zod (已安装，未使用) |
| 测试 | Vitest + Testing Library |
| 包管理 | pnpm 9.6 |

## 功能模块

### 认证系统
- JWT Bearer Token 认证
- 自动 token refresh + 重试
- Session 持久化 (localStorage)

### 工作空间管理
- 工作空间扫描、创建、激活、删除
- 组件列表与详情
- 拓扑图可视化 (React Flow)
- 关系管理 (组件间依赖)

### 变更工作流 (SillySpec)
- 变更创建与执行
- 阶段流转 (brainstorm → propose → plan → execute → verify → archive)
- 人工审批门禁 (proposal review, plan review, human test, archive confirm)
- 文档矩阵与内容查看
- 反馈提交

### Agent 控制台
- Agent Run 创建与管理
- 实时日志流 (SSE + EventSource)
- Agent 输入提交
- Run 终止

### 运维功能
- Daemon 运行时管理 (12 个 AI Agent 提供商)
- 发布管理 (创建/审批/部署/回滚)
- 事件管理 (创建/更新/复盘)
- 审计日志
- 知识库
- Git 身份管理
- 审批中心

## 路由结构

| 路径 | 功能 |
|------|------|
| `/login` | 登录页 |
| `/workspaces` | 工作空间列表 |
| `/workspaces/[id]` | 工作空间首页 |
| `/workspaces/[id]/changes` | 变更中心 |
| `/workspaces/[id]/agent` | Agent 控制台 |
| `/workspaces/[id]/components` | 组件列表 |
| `/workspaces/[id]/components/topology` | 拓扑图 |
| `/workspaces/[id]/releases` | 发布管理 |
| `/workspaces/[id]/incidents` | 事件管理 |
| `/workspaces/[id]/approvals` | 审批中心 |
| `/workspaces/[id]/audit` | 审计日志 |
| `/workspaces/[id]/knowledge` | 知识库 |
| `/workspaces/[id]/scan-docs` | 扫描文档 |
| `/workspaces/[id]/runtime` | 运行时 |
| `/settings` | 系统设置 |
| `/settings/git-identities` | Git 身份管理 |
| `/runtimes` | Daemon 运行时 |

## 开发命令

```bash
pnpm dev          # 启动开发服务器
pnpm build        # 生产构建
pnpm start        # 启动生产服务器
pnpm lint         # ESLint 检查
pnpm typecheck    # TypeScript 类型检查
pnpm test         # 运行单元测试
pnpm test:watch   # 监听模式运行测试
```

## 代码规模

| 分类 | 文件数 |
|------|--------|
| 页面 (page.tsx) | 23 |
| 布局 (layout.tsx) | 2 |
| 组件 (.tsx) | 11 |
| API 客户端 (.ts) | 20+ |
| Store | 1 |
| 测试 | 3 |
