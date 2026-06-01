---
author: qinyi
created_at: 2026-05-31T23:30:00
---

# 前端架构

## 技术栈概览

| 层级 | 技术 | 版本 |
|------|------|------|
| 框架 | Next.js (App Router) | 14.2.5 |
| UI 库 | React | 18.3.1 |
| 语言 | TypeScript | 5.5.4 |
| 样式 | Tailwind CSS | 3.4.7 |
| 组件库 | shadcn/ui 风格 (手写) | — |
| 状态管理 | Zustand | ^4.5.0 |
| 服务端请求 | TanStack React Query | ^5.51.0 |
| 流程图 | @xyflow/react | ^12.10.2 |
| 图标 | lucide-react | ^0.400.0 |
| 校验 | Zod | ^3.23.0 |
| 构建工具 | Next.js 内置 (SWC) | — |
| 测试 | Vitest + Testing Library | ^2.0.0 |
| 包管理 | pnpm | 9.6.0 |

## Next.js App Router 架构

项目采用 Next.js 14 App Router 架构，核心特征如下：

### 路由分组 (Route Groups)

- `(dashboard)` — 需认证的仪表盘路由组，包含所有业务页面
  - 共享 `layout.tsx`：认证守卫 + AppShell 侧边栏布局
- `(auth)` — 公开的认证路由组
  - `login/page.tsx` — 登录页面

### 路由结构层次

```
src/app/
├── layout.tsx              # 根布局：HTML 骨架 + 全局样式
├── page.tsx                # 首页：平台入口 + 健康检查
├── globals.css             # CSS 变量定义 + Tailwind 基础样式
├── (auth)/
│   └── login/page.tsx      # 登录页
└── (dashboard)/
    ├── layout.tsx          # 认证守卫 + AppShell
    ├── workspaces/
    │   ├── page.tsx        # Workspace 列表
    │   └── [id]/
    │       ├── page.tsx    # Workspace 详情
    │       ├── agent/      # Agent 控制台
    │       ├── approvals/  # 审批中心
    │       ├── audit/      # 审计中心
    │       ├── changes/    # 变更管理 (含 [cid] 子路由)
    │       ├── components/ # 项目组件 + 拓扑图
    │       ├── create-change/ # 创建变更
    │       ├── incidents/  # 事件管理 (含 [iid] 子路由)
    │       ├── knowledge/  # 知识 & 日志
    │       ├── releases/   # 发布管理
    │       ├── runtime/    # 运行时进度
    │       └── scan-docs/  # 扫描文档
    └── settings/           # 设置 + Git 身份管理
```

### 布局嵌套

```
RootLayout (html + body)
  └── DashboardLayout (认证守卫 + AppShell)
        └── 各业务页面
```

- `RootLayout`：服务端组件，仅负责 HTML 骨架和全局 CSS
- `DashboardLayout`：客户端组件 (`"use client"`)，从 Zustand 读取 token 做认证守卫
- 业务页面：大部分为客户端组件，直接调用 API 层

## 组件层次

### UI 原子组件 (src/components/ui/)

手写的 shadcn/ui 风格基础组件，使用 CVA (class-variance-authority) + Tailwind：

- `button.tsx` — 按钮，支持 variant/size
- `input.tsx` — 输入框
- `badge.tsx` — 状态标签，支持多种语义变体 (success/warning/destructive/outline/default)

### 业务组件 (src/components/)

- `app-shell.tsx` — 应用外壳：可折叠侧边栏 + 顶部导航 + 内容区
- `workspace-card.tsx` — Workspace 卡片：展示基本信息 + 操作按钮
- `workspace-scan-dialog.tsx` — Workspace 创建向导：扫描 → 预览 → 配置策略 → 创建
- `health-card.tsx` — 平台健康检查卡片：轮询后端 /api/health
- `component-detail-drawer.tsx` — 组件详情抽屉：展示 Workspace 元数据 + 关联关系

### 页面级组件 (src/app/)

每个 `page.tsx` 即为页面级组件，多数使用 `"use client"` 指令直接在页面内管理状态。

## 数据流

### 请求数据流

```
页面组件
  → 调用 src/lib/*.ts 中的 API 函数
    → apiFetch() (src/lib/api.ts)
      → resolveUrl(): 浏览器用相对路径 /api/*，SSR 用绝对后端 URL
        → fetch() 到后端
          → Next.js rewrites 代理 /api/* → 后端服务
```

### 状态管理

1. **服务端状态**：通过 `useState` + `useEffect` 手动管理（非 React Query）
   - TanStack React Query 已安装但页面中尚未大量使用
2. **客户端全局状态**：Zustand store
   - `src/stores/session.ts` — 用户会话 (token + 用户信息)，使用 `persist` 中间件持久化到 localStorage

### 认证流

1. 用户登录 → `auth.ts:login()` → POST `/api/auth/login` → 获取 token pair
2. Token 写入 Zustand store → 自动持久化到 localStorage
3. DashboardLayout 检测 token 存在 → 渲染 AppShell
4. `apiFetch()` 自动从 store 读取 `accessToken` 附加到请求头
5. Token 过期 (401) → 自动尝试 refresh → 失败则清除 store 并跳转 /login

### API 代理架构

Next.js 通过 `rewrites` 配置实现 API 代理：

- 开发/生产环境：前端 `/api/*` → 后端 `http://localhost:8000/api/*`
- `INTERNAL_API_BASE_URL` 优先于 `NEXT_PUBLIC_API_BASE_URL`
- 浏览器端始终使用相对路径，支持 frp 隧道 / LAN 等多场景访问

## 渲染策略

- 根布局 (`layout.tsx`)：服务端渲染
- Dashboard 布局：客户端渲染 (`"use client"`)
- 所有业务页面：客户端渲染（数据驱动型管理后台，需交互）
- 无 `getServerSideProps` / `getStaticProps` 使用
- `next.config.mjs` 中启用 `experimental.typedRoutes`，支持类型安全路由
- 支持 standalone 输出模式 (`NEXT_BUILD_STANDALONE=1`)
