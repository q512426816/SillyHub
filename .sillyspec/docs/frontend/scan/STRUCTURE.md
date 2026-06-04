---
author: scan-agent
created_at: "2026-06-03"
---

# SillyHub Frontend — 目录结构

## 目录树

```
frontend/
├── package.json
├── tsconfig.json
├── next.config.mjs
├── tailwind.config.ts
├── postcss.config.mjs
├── .next/                          # Next.js 构建输出（已忽略）
└── src/
    ├── app/                        # App Router 页面 & 布局
    │   ├── layout.tsx              # 根布局（HTML 骨架）
    │   ├── page.tsx                # 首页（/）
    │   ├── globals.css             # 全局样式 + CSS 变量
    │   ├── (auth)/                 # 认证路由组
    │   │   └── login/
    │   │       └── page.tsx
    │   ├── (dashboard)/            # 仪表盘路由组（需认证）
    │   │   ├── layout.tsx          # DashboardLayout（认证守卫 + AppShell）
    │   │   └── workspaces/
    │   │       ├── page.tsx        # /workspaces 列表
    │   │       └── [id]/
    │   │           ├── page.tsx    # Workspace 详情
    │   │           ├── agent/
    │   │           │   └── page.tsx
    │   │           ├── approvals/
    │   │           │   └── page.tsx
    │   │           ├── audit/
    │   │           │   └── page.tsx
    │   │           ├── changes/
    │   │           │   ├── page.tsx
    │   │           │   ├── [cid]/
    │   │           │   │   ├── page.tsx
    │   │           │   │   └── tasks/
    │   │           │   │       ├── page.tsx
    │   │           │   │       └── [tid]/
    │   │           │   │           └── page.tsx
    │   │           │   └── create-change/
    │   │           │       └── page.tsx
    │   │           ├── components/
    │   │           │   ├── page.tsx
    │   │           │   └── topology/
    │   │           │       └── page.tsx
    │   │           ├── incidents/
    │   │           │   ├── page.tsx
    │   │           │   └── [iid]/
    │   │           │       └── page.tsx
    │   │           ├── knowledge/
    │   │           │   └── page.tsx
    │   │           ├── releases/
    │   │           │   └── page.tsx
    │   │           ├── runtime/
    │   │           │   └── page.tsx
    │   │           └── scan-docs/
    │   │               └── page.tsx
    │   └── api/                     # Route Handlers
    │       └── workspaces/
    │           └── [workspaceId]/
    │               └── agent/runs/
    │                   └── [runId]/
    │                       └── stream/
    │                           └── route.ts  # SSE 代理
    ├── components/                 # 可复用组件
    │   ├── ui/                    # 基础 UI 组件（CVA 风格）
    │   │   ├── badge.tsx
    │   │   ├── button.tsx
    │   │   └── input.tsx
    │   ├── app-shell.tsx          # 侧边栏 + 主体布局
    │   ├── component-detail-drawer.tsx  # Workspace 详情抽屉
    │   ├── health-card.tsx        # 健康状态卡片（轮询）
    │   ├── sillyspec-step-progress.tsx  # Agent 步骤进度条
    │   ├── workspace-card.tsx     # Workspace 卡片
    │   └── workspace-scan-dialog.tsx    # 添加 Workspace 对话框
    ├── lib/                       # API 客户端 & 工具函数
    │   ├── __tests__/             # 单元测试
    │   │   ├── agent.test.ts
    │   │   ├── api.test.ts
    │   │   └── spec-workspaces.test.ts
    │   ├── agent.ts               # Agent Run CRUD + SSE 流
    │   ├── agent-stream.ts        # SSE 流客户端（断线重连）
    │   ├── api.ts                 # apiFetch 核心封装
    │   ├── approvals.ts           # 审批管理
    │   ├── archive.ts             # 变更归档
    │   ├── audit.ts               # 审计日志
    │   ├── auth.ts                # 登录/登出/刷新
    │   ├── change-writer.ts       # 变更创建 + 文档生成
    │   ├── changes.ts             # 变更管理 + 阶段流转
    │   ├── components.ts          # 兼容层（旧组件 API）
    │   ├── git-gateway.ts         # Git 操作网关
    │   ├── git-identities.ts      # Git 身份管理
    │   ├── health.ts              # 健康检查
    │   ├── incidents.ts           # 事件管理
    │   ├── knowledge.ts           # 知识库 & 日志
    │   ├── releases.ts            # 发布管理
    │   ├── runtime.ts             # 运行时进度
    │   ├── scan-docs.ts           # 扫描文档
    │   ├── settings.ts            # 设置 & 用户管理
    │   ├── spec-workspaces.ts     # Spec Workspace 管理
    │   ├── tasks.ts               # 任务管理
    │   ├── tool-gateway.ts        # 工具执行网关
    │   ├── utils.ts               # cn() 样式工具
    │   ├── workspaces.ts          # Workspace CRUD
    │   └── workflow.ts            # 阶段流转 + 评审
    ├── stores/                    # Zustand 状态管理
    │   └── session.ts             # 用户会话 store
    └── test/                      # 测试配置
        └── setup.ts               # Vitest 全局 setup
```

## 各目录职责

| 目录 | 职责 | 文件数 |
|------|------|--------|
| `src/app/` | App Router 页面（路由 + 布局） | ~22 个 page.tsx + 2 layout.tsx |
| `src/app/api/` | Next.js Route Handler（SSE 代理） | 1 |
| `src/components/ui/` | 基础 UI 组件（Button、Badge、Input） | 3 |
| `src/components/` | 业务组件（AppShell、卡片、对话框等） | 5 |
| `src/lib/` | API 客户端 + 工具（每个模块对齐后端一个 API） | ~22 (+ 3 tests) |
| `src/stores/` | Zustand 全局状态（仅 session） | 1 |
| `src/test/` | 测试全局配置 | 1 |

## 统计

- **页面文件**: 21 个 `page.tsx`
- **布局文件**: 2 个 `layout.tsx`（根 + dashboard）
- **API Route Handler**: 1 个
- **业务组件**: 5 个
- **UI 基础组件**: 3 个
- **API 客户端模块**: 22 个 `.ts`（`src/lib/` 下非测试文件）
- **测试文件**: 3 个
- **Zustand Store**: 1 个
