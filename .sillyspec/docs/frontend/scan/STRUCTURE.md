---
author: qinyi
created_at: 2026-05-29T17:40:00
---

# STRUCTURE — frontend

## 目录树

```text
frontend/
├── public/
│   └── .gitkeep
├── src/
│   ├── app/                          Next.js App Router
│   │   ├── globals.css               全局样式（Tailwind + CSS 变量）
│   │   ├── layout.tsx                根布局 (lang=zh-CN)
│   │   ├── page.tsx                  首页 (/)
│   │   ├── (auth)/                   未认证路由组
│   │   │   └── login/page.tsx        登录页
│   │   └── (dashboard)/              已认证路由组
│   │       ├── layout.tsx            Auth guard + AppShell
│   │       ├── settings/
│   │       │   ├── page.tsx          设置首页
│   │       │   └── git-identities/   Git 身份管理
│   │       └── workspaces/
│   │           ├── page.tsx          工作区列表
│   │           └── [id]/             工作区详情（20 个子路由）
│   ├── components/                   共享组件
│   │   ├── app-shell.tsx             Sidebar 导航外壳
│   │   ├── component-detail-drawer.tsx
│   │   ├── health-card.tsx
│   │   ├── workspace-card.tsx
│   │   ├── workspace-scan-dialog.tsx
│   │   └── ui/                       shadcn/ui 基础组件
│   │       ├── badge.tsx
│   │       ├── button.tsx
│   │       └── input.tsx
│   ├── lib/                          API 层 + 类型（21 个模块）
│   │   ├── __tests__/api.test.ts
│   │   ├── api.ts                    核心 apiFetch<T>() 封装
│   │   ├── agent.ts
│   │   ├── approvals.ts
│   │   ├── audit.ts
│   │   ├── auth.ts
│   │   ├── changes.ts
│   │   ├── change-writer.ts
│   │   ├── components.ts
│   │   ├── git-identities.ts
│   │   ├── health.ts
│   │   ├── incidents.ts
│   │   ├── knowledge.ts
│   │   ├── releases.ts
│   │   ├── runtime.ts
│   │   ├── scan-docs.ts
│   │   ├── settings.ts
│   │   ├── spec-workspaces.ts
│   │   ├── tasks.ts
│   │   ├── utils.ts                  cn() 工具函数
│   │   ├── workflow.ts
│   │   └── workspaces.ts
│   ├── stores/
│   │   └── session.ts                Zustand session store (persist)
│   └── test/
│       └── setup.ts                  Vitest 全局 setup
├── package.json
├── next.config.mjs
├── tailwind.config.ts
├── tsconfig.json
├── vitest.config.ts
├── postcss.config.mjs
├── Dockerfile
└── .env.example
```

## 模块说明

- `src/lib/`: 21 个 API 模块，每个对应一个后端业务域，包含类型定义 + API 调用函数
- `src/components/`: 5 个业务组件 + 3 个 shadcn/ui 基础组件
- `src/stores/`: 1 个 Zustand store（session，含 persist middleware）
- `src/app/`: 22 个页面路由，分 (auth) 和 (dashboard) 两个路由组
