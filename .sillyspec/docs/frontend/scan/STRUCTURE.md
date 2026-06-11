---
author: qinyi
created_at: 2026-06-10T00:00:00
---

# Frontend 目录结构 + 模块说明

## 顶层结构

```
frontend/
  package.json          — 项目配置, pnpm 管理
  next.config.mjs       — Next.js 配置 (API rewrite, standalone output)
  tailwind.config.ts    — Tailwind CSS 配置 (shadcn/ui 主题变量)
  tsconfig.json         — TypeScript strict 模式, @/ 路径别名
  vitest.config.ts      — Vitest 测试配置 (jsdom 环境)
  components.json       — shadcn/ui CLI 配置
  .eslintrc.json        — ESLint (eslint-config-next)
  postcss.config.mjs    — PostCSS 配置
```

## src/ 目录结构

```
src/
  app/                              — Next.js App Router 页面
    layout.tsx                      — 根布局 (html/body, 全局 metadata)
    page.tsx                        — 首页 (重定向到 /workspaces 或 /login)
    globals.css                     — 全局样式 + Tailwind + CSS 变量

    (auth)/                         — 认证路由组 (无侧边栏)
      login/page.tsx               — 登录页面

    (dashboard)/                    — 主面板路由组 (受保护, 有侧边栏)
      layout.tsx                   — Dashboard 布局 (session 检查 + AppShell)
      settings/
        page.tsx                   — 系统设置
        git-identities/page.tsx    — Git 身份管理
      runtimes/page.tsx            — Daemon 运行时管理
      workspaces/
        page.tsx                   — 工作空间列表
        [id]/                      — 工作空间详情 (嵌套路由)
          page.tsx                 — 工作空间首页
          agent/page.tsx           — Agent 控制台
          changes/
            page.tsx               — 变更列表
            [cid]/
              page.tsx             — 变更详情
              tasks/
                page.tsx           — 任务列表
                [tid]/page.tsx     — 任务详情
          create-change/page.tsx   — 创建变更
          components/
            page.tsx               — 项目组件列表
            topology/page.tsx      — 拓扑图 (React Flow)
          knowledge/page.tsx       — 知识库
          releases/page.tsx        — 发布管理
          scan-docs/page.tsx       — 扫描文档
          runtime/page.tsx         — 运行时
          approvals/page.tsx       — 审批中心
          audit/page.tsx           — 审计日志
          incidents/
            page.tsx               — 事件列表
            [iid]/page.tsx         — 事件详情

    api/                            — BFF API Routes
      workspaces/[workspaceId]/agent/runs/[runId]/stream/
        route.ts                   — SSE 代理转发

  components/                       — 可复用 UI 组件
    ui/                             — shadcn/ui 基础组件
      button.tsx
      badge.tsx
      input.tsx
    app-shell.tsx                   — 主侧边栏 + 内容区布局
    health-card.tsx                 — 健康检查卡片
    workspace-card.tsx              — 工作空间卡片
    workspace-scan-dialog.tsx       — 扫描工作空间对话框
    component-detail-drawer.tsx     — 组件详情抽屉
    agent-log-viewer.tsx            — Agent 日志查看器
    sillyspec-step-progress.tsx     — SillySpec 步骤进度条
    agent-log/                      — Agent 日志子模块
      types.ts                     — 类型定义
      normalize.ts                 — 日志归一化
      tool-renderers.tsx           — 工具调用渲染器

  lib/                              — 数据层 / 工具库
    api.ts                          — 核心 fetch 封装 (apiFetch, ApiError)
    auth.ts                         — 认证 API (login/logout/refresh)
    agent.ts                        — Agent API (CRUD runs, logs, stream)
    agent-stream.ts                 — SSE 流客户端类
    workspaces.ts                   — 工作空间 API
    changes.ts                      — 变更 API + 工作流 (transition/review)
    tasks.ts                        — 任务 API
    components.ts                   — 组件 API
    releases.ts                     — 发布 API
    incidents.ts                    — 事件 API
    approvals.ts                    — 审批 API
    audit.ts                        — 审计 API
    knowledge.ts                    — 知识库 API
    settings.ts                     — 设置 API
    scan-docs.ts                    — 扫描文档 API
    runtime.ts                      — 运行时 API
    daemon.ts                       — Daemon 运行时 API
    git-identities.ts               — Git 身份 API
    git-gateway.ts                  — Git 操作网关
    tool-gateway.ts                 — 工具执行网关
    worktree.ts                     — Worktree API
    workflow.ts                     — 工作流 API (transition/review)
    change-writer.ts                — 变更文档写入
    spec-workspaces.ts              — SillySpec 工作空间引导
    archive.ts                      — 归档 API
    utils.ts                        — 工具函数 (cn)
    health.ts                       — 健康检查 API
    __tests__/                      — 单元测试
      api.test.ts
      agent.test.ts
      spec-workspaces.test.ts

  stores/                           — Zustand 状态管理
    session.ts                      — 用户认证 session (persist)

  test/
    setup.ts                        — Vitest 测试 setup (@testing-library/jest-dom/vitest)
```

## 模块依赖关系

```
页面组件 (app/*)
  ├── components/*        — UI 组件
  ├── lib/*               — API 客户端函数
  │     └── lib/api.ts    — 所有 lib 通过 apiFetch 统一调用
  └── stores/session.ts   — 认证状态
        └── lib/api.ts    — apiFetch 从 store 读取 token
```
