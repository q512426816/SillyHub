---
author: qinyi
created_at: 2026-06-03T10:00:00
---

# STRUCTURE — frontend

## 目录树

```
frontend/
├── src/
│   ├── app/                    # Next.js App Router
│   │   ├── (auth)/             # 认证路由组
│   │   │   └── login/          # 登录页
│   │   ├── (dashboard)/        # 仪表盘路由组
│   │   │   ├── settings/       # 设置页（全局 + Git 凭据）
│   │   │   └── workspaces/     # 工作区相关页面
│   │   │       ├── page.tsx    # 工作区列表
│   │   │       └── [id]/       # 单个工作区
│   │   │           ├── page.tsx       # 工作区详情
│   │   │           ├── agent/         # Agent 控制台
│   │   │           ├── changes/       # 变更管理
│   │   │           ├── components/    # 组件文档树
│   │   │           ├── incidents/     # 事件管理
│   │   │           ├── knowledge/     # 知识库
│   │   │           ├── releases/      # 发布管理
│   │   │           ├── runtime/       # 运行时
│   │   │           ├── scan-docs/     # 扫描文档
│   │   │           └── ...            # approvals, audit, create-change, topology
│   │   ├── api/                # API Routes
│   │   └── page.tsx            # 首页（重定向到 workspaces）
│   ├── components/             # 共享组件
│   │   ├── ui/                 # 基础 UI 组件（Badge 等）
│   │   ├── app-shell.tsx       # 应用外壳
│   │   ├── workspace-card.tsx  # 工作区卡片
│   │   ├── workspace-scan-dialog.tsx  # 扫描对话框
│   │   ├── component-detail-drawer.tsx # 组件详情抽屉
│   │   ├── health-card.tsx     # 健康状态卡片
│   │   └── sillyspec-step-progress.tsx # SillySpec 步骤进度条
│   ├── lib/                    # API 客户端 + 工具函数（26 个文件）
│   ├── stores/                 # Zustand 状态管理
│   │   └── session.ts         # 用户会话 store
│   └── test/                   # 测试 setup
├── package.json
├── tailwind.config.ts
├── vitest.config.ts
└── next.config.mjs
```

## 目录说明

| 目录 | 职责 |
|------|------|
| `src/app/` | Next.js App Router 页面路由，按路由组组织（auth/dashboard） |
| `src/components/` | 共享 UI 组件，含 `ui/` 基础组件目录 |
| `src/lib/` | API 客户端封装和工具函数，每个后端模块对应一个文件 |
| `src/stores/` | Zustand 全局状态管理 |
| `src/test/` | 测试 setup 配置 |

## 页面路由

22 个页面路由，覆盖：
- 认证: login
- 设置: 全局设置, Git 凭据
- 工作区: 列表、详情、Agent、变更、组件文档树、事件、知识库、发布、运行时、扫描文档、审批、审计、创建变更、拓扑图

## Lib 文件

26 个文件，与后端模块一一对应（如 `api.ts`, `workspaces.ts`, `changes.ts`, `agent.ts` 等）。
