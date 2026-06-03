---
author: qinyi
created_at: 2026-06-03T20:35:00+08:00
---

# Frontend - 目录结构和文件组织

## 根目录

```
frontend/
  package.json          # 依赖和脚本
  next.config.mjs       # Next.js 配置（API 代理、standalone 模式）
  tailwind.config.ts    # Tailwind CSS 配置（shadcn/ui 主题色）
  tsconfig.json         # TypeScript 配置（strict、路径别名 @/*）
  vitest.config.ts      # Vitest 测试配置（jsdom、路径别名）
  postcss.config.mjs    # PostCSS 配置（Tailwind）
  .eslintrc.json        # ESLint 配置
```

## src/ 目录结构

```
src/
  app/                          # Next.js App Router 页面
    layout.tsx                  # 根布局（lang=zh-CN、全局样式）
    page.tsx                    # 首页（健康检查、进入 Workspaces）
    globals.css                 # 全局 CSS（Tailwind 指令 + CSS 变量主题）

    (auth)/                     # 认证路由组
      login/
        page.tsx                # 登录页

    (dashboard)/                # 仪表盘路由组（需要登录）
      layout.tsx                # 仪表盘布局（AppShell、Auth Guard）
      settings/
        page.tsx                # 系统设置
        git-identities/
          page.tsx              # Git 身份管理
      workspaces/
        page.tsx                # Workspace 列表
        [id]/                   # 动态路由：单个 Workspace
          page.tsx              # Workspace 详情
          components/
            page.tsx            # 组件/关系列表
            topology/
              page.tsx          # 拓扑图（@xyflow/react）
          changes/
            page.tsx            # 变更列表
            [cid]/
              page.tsx          # 变更详情（文档、工作流、审批）
              tasks/
                page.tsx        # 任务看板
                [tid]/
                  page.tsx      # 任务详情
          create-change/
            page.tsx            # 创建变更
          scan-docs/
            page.tsx            # 扫描文档
          runtime/
            page.tsx            # 运行时监控
          knowledge/
            page.tsx            # 知识库
          releases/
            page.tsx            # 发布管理
          agent/
            page.tsx            # Agent 控制台
          approvals/
            page.tsx            # 审批中心
          audit/
            page.tsx            # 审计日志
          incidents/
            page.tsx            # 事件列表
            [iid]/
              page.tsx          # 事件详情

    api/                        # Next.js Route Handlers
      workspaces/
        [workspaceId]/
          agent/
            runs/
              [runId]/
                stream/
                  route.ts      # SSE 代理（Agent 日志流）

  components/                   # React 组件
    app-shell.tsx               # 主布局壳（侧边栏导航 + 内容区）
    health-card.tsx             # 健康检查卡片
    workspace-card.tsx          # Workspace 列表卡片
    workspace-scan-dialog.tsx   # Workspace 扫描/创建对话框
    component-detail-drawer.tsx # 组件详情抽屉
    sillyspec-step-progress.tsx # SillySpec 步骤进度组件

    ui/                         # 基础 UI 组件（shadcn/ui 风格）
      badge.tsx                 # Badge 标签
      button.tsx                # Button 按钮
      input.tsx                 # Input 输入框

  lib/                          # 工具函数和 API 客户端
    api.ts                      # 核心 HTTP 客户端（apiFetch、ApiError、Token 刷新）
    utils.ts                    # 通用工具（cn 函数）
    auth.ts                     # 认证 API（login/logout/refresh）
    health.ts                   # 健康检查 API
    workspaces.ts               # Workspace CRUD + 关系 + 拓扑
    components.ts               # 组件兼容层（映射 Workspace 到 Component）
    spec-workspaces.ts          # Spec Workspace 管理
    changes.ts                  # 变更 CRUD + 工作流 + Agent Dispatch
    change-writer.ts            # 变更写入（创建 + 文档批量生成）
    tasks.ts                    # 任务 CRUD + 看板
    workflow.ts                 # 工作流（transition + review）
    agent.ts                    # Agent Run 管理 + SSE 日志流
    agent-stream.ts             # Agent SSE 客户端（重连、去重、backoff）
    runtime.ts                  # 运行时进度 + Artifacts
    scan-docs.ts                # 扫描文档
    knowledge.ts                # 知识库 + Quicklog
    releases.ts                 # 发布管理
    approvals.ts                # 审批管理
    audit.ts                    # 审计日志
    incidents.ts                # 事件管理 + Postmortem
    archive.ts                  # 变更归档 + 知识蒸馏
    settings.ts                 # 系统设置 + 用户管理
    git-identities.ts           # Git 身份管理
    git-gateway.ts              # Git 操作网关
    tool-gateway.ts             # Tool 执行网关
    worktree.ts                 # Worktree 租约管理

    __tests__/                  # API 客户端单元测试
      api.test.ts               # apiFetch 核心测试
      agent.test.ts             # Agent API 测试
      spec-workspaces.test.ts   # Spec Workspace API 测试

  stores/                       # Zustand Store
    session.ts                  # 会话状态（user、tokens、hydration）

  test/                         # 测试基础设施
    setup.ts                    # Vitest setup（@testing-library/jest-dom/vitest）
```

## 文件统计

| 类别 | 数量 |
|------|------|
| 页面文件 (page.tsx) | ~20 |
| 布局文件 (layout.tsx) | 3 |
| API 客户端 (lib/*.ts) | 24 |
| 业务组件 (components/*.tsx) | 6 |
| 基础 UI 组件 (components/ui/*.tsx) | 3 |
| Route Handler (route.ts) | 1 |
| 测试文件 | 3 |
| Store | 1 |

## 组织原则

- **按功能分文件**: 每个后端模块对应一个 lib 文件，一对一映射
- **按路由分目录**: 页面目录结构完全反映 URL 层级
- **路由组隔离**: `(auth)` 和 `(dashboard)` 分别管理有无认证的布局
- **组件就近放置**: 拓扑图等特定页面的自定义节点组件直接放在页面文件中
