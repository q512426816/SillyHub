---
author: qinyi
created_at: 2026-05-31T23:30:00
---

# 目录结构

## 顶层结构

```
frontend/
├── .eslintrc.json          # ESLint 配置 (extends next/core-web-vitals)
├── next.config.mjs         # Next.js 配置 (rewrites, standalone, typedRoutes)
├── package.json            # 依赖声明 + 脚本
├── postcss.config.mjs      # PostCSS 配置 (tailwindcss + autoprefixer)
├── tailwind.config.ts      # Tailwind CSS 配置 (主题色 + 动画插件)
├── tsconfig.json           # TypeScript 配置 (strict, ES2022, bundler)
├── vitest.config.ts        # Vitest 测试配置 (jsdom, @ alias)
├── pnpm-lock.yaml          # pnpm 锁文件
└── src/
    ├── app/                # Next.js App Router 页面
    ├── components/         # 可复用 UI 组件
    ├── lib/                # API 客户端 + 工具函数
    ├── stores/             # Zustand 全局状态
    └── test/               # 测试配置
```

## src/app/ — 页面路由

Next.js App Router 约定目录，每个子目录对应一个 URL 路径段。

```
src/app/
├── layout.tsx                          # 根布局 (服务端组件)
├── page.tsx                            # 首页：平台入口 + HealthCard
├── globals.css                         # 全局 CSS 变量 + Tailwind 层
│
├── (auth)/                             # 认证路由组 (无需 DashboardLayout)
│   └── login/
│       └── page.tsx                    # 登录页面
│
└── (dashboard)/                        # 仪表盘路由组 (需认证)
    ├── layout.tsx                      # 认证守卫 + AppShell 包裹
    ├── workspaces/
    │   ├── page.tsx                    # Workspace 列表 + 创建
    │   └── [id]/                       # 动态路由：workspaceId
    │       ├── page.tsx                # Workspace 详情 (概览卡片 + Spec 管理)
    │       ├── agent/
    │       │   └── page.tsx            # Agent 控制台 (运行列表 + 日志)
    │       ├── approvals/
    │       │   └── page.tsx            # 审批中心
    │       ├── audit/
    │       │   └── page.tsx            # 审计日志
    │       ├── changes/
    │       │   ├── page.tsx            # 变更列表
    │       │   ├── [cid]/              # 动态路由：changeId
    │       │   │   ├── page.tsx        # 变更详情
    │       │   │   └── tasks/
    │       │   │       ├── page.tsx    # 任务列表/看板
    │       │   │       └── [tid]/
    │       │   │           └── page.tsx # 任务详情
    │       │   └── ...
    │       ├── components/
    │       │   ├── page.tsx            # 组件列表
    │       │   └── topology/
    │       │       └── page.tsx        # 拓扑图 (@xyflow/react)
    │       ├── create-change/
    │       │   └── page.tsx            # 创建变更
    │       ├── incidents/
    │       │   ├── page.tsx            # 事件列表
    │       │   └── [iid]/
    │       │       └── page.tsx        # 事件详情 + Postmortem
    │       ├── knowledge/
    │       │   └── page.tsx            # 知识库 + 快速日志
    │       ├── releases/
    │       │   └── page.tsx            # 发布管理
    │       ├── runtime/
    │       │   └── page.tsx            # 运行时进度 + 制品
    │       └── scan-docs/
    │           └── page.tsx            # 扫描文档浏览
    └── settings/
        ├── page.tsx                    # 平台设置
        └── git-identities/
            └── page.tsx                # Git 身份管理
```

### 路由分组职责

- `(dashboard)` — 所有需要认证的业务页面，共享认证守卫和侧边栏布局
- `(auth)` — 不需要认证的公开页面，仅有登录

## src/components/ — UI 组件

```
src/components/
├── ui/                                 # 基础 UI 原子组件 (shadcn/ui 风格)
│   ├── button.tsx                      # 按钮 (variant: default/destructive/outline/ghost/secondary/link)
│   ├── input.tsx                       # 输入框
│   └── badge.tsx                       # 状态标签 (variant: default/success/warning/destructive/outline)
│
├── app-shell.tsx                       # 应用外壳：可折叠侧边栏 + 导航 + 退出
├── workspace-card.tsx                  # Workspace 卡片 (信息 + rescan/delete)
├── workspace-scan-dialog.tsx           # Workspace 创建向导 (扫描→预览→策略→创建)
├── health-card.tsx                     # 健康检查卡片 (轮询 /api/health)
└── component-detail-drawer.tsx         # 组件详情抽屉 (元数据 + 关联关系)
```

### UI 组件设计

- 使用 CVA (class-variance-authority) 管理 variant
- Tailwind 原子类直接编写，无 CSS Modules
- `cn()` 工具函数 (clsx + tailwind-merge) 合并类名

## src/lib/ — API 层与工具

```
src/lib/
├── api.ts                  # 核心 fetch 封装 (apiFetch, ApiError, token 自动刷新)
├── utils.ts                # 工具函数 (cn 类名合并)
│
├── auth.ts                 # 认证 API (login, logout, refreshTokens)
├── workspaces.ts           # Workspace CRUD + 扫描 + 关系 + 拓扑
├── components.ts           # 组件兼容层 (Workspace→Component 映射)
├── changes.ts              # 变更 CRUD + 阶段流转 + 反馈 + 归档门禁 + Agent Dispatch
├── workflow.ts             # 工作流 (评审/阶段流转/任务流转)
├── tasks.ts                # 任务 CRUD + 看板 + 重解析
├── agent.ts                # Agent 运行 CRUD + SSE 日志流
├── approvals.ts            # 审批请求 CRUD
├── audit.ts                # 审计日志查询
├── incidents.ts            # 事件 CRUD + Postmortem
├── releases.ts             # 发布 CRUD + 审批/部署/晋升/回滚
├── runtime.ts              # 运行时进度 + 用户输入 + 制品
├── knowledge.ts            # 知识条目 + 快速日志
├── scan-docs.ts            # 扫描文档 CRUD + 重解析
├── health.ts               # 健康检查 API
│
├── spec-workspaces.ts      # 规范空间管理 (策略/同步/冲突)
├── git-identities.ts       # Git 身份 CRUD + 访问检查
├── settings.ts             # 平台设置 + 用户管理
├── archive.ts              # 归档 + 知识蒸馏
│
├── worktree.ts             # Worktree 租约管理
├── git-gateway.ts          # Git 操作网关
├── tool-gateway.ts         # 工具执行网关
├── change-writer.ts        # 变更创建 + 文档批量生成
│
├── __tests__/
│   └── api.test.ts         # apiFetch 单元测试
└── ...
```

### API 层职责划分

- **核心** (`api.ts`) — 统一 fetch 封装、错误处理、token 注入、自动刷新
- **认证** (`auth.ts`) — 登录/登出/token 刷新，直接操作 session store
- **业务领域** — 每个文件对应后端一个模块，类型定义 + API 函数
- **兼容层** (`components.ts`) — 旧组件 API 到新 Workspace API 的映射适配
- **基础设施** (`worktree.ts`, `git-gateway.ts`, `tool-gateway.ts`) — Agent 执行底层的 Worktree/工具操作

## src/stores/ — 状态管理

```
src/stores/
└── session.ts              # Zustand store: 用户会话 (tokens + user)，localStorage 持久化
```

## src/test/ — 测试配置

```
src/test/
└── setup.ts                # Vitest 测试初始化
```

## 配置文件

| 文件 | 用途 |
|------|------|
| `next.config.mjs` | Next.js: rewrites 代理、standalone 输出、typedRoutes、reactStrictMode |
| `tailwind.config.ts` | Tailwind: 主题色 (CSS 变量驱动)、darkMode class、动画插件 |
| `tsconfig.json` | TypeScript: strict mode、ES2022 target、bundler moduleResolution、`@/*` 路径别名 |
| `vitest.config.ts` | Vitest: jsdom 环境、全局 API、React 插件、路径别名 |
| `.eslintrc.json` | ESLint: next/core-web-vitals 预设、未使用变量警告 |
| `postcss.config.mjs` | PostCSS: tailwindcss + autoprefixer |
