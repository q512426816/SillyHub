---
author: qinyi
created_at: 2026-06-19 12:50:59
source_commit: 0303536
updated_at: 2026-06-19T04:50:59Z
generator: sillyspec-scan
---

# frontend 项目卡片

> 覆盖旧版文档。基于 `frontend/src/` 事实采集。

## 项目简介

- **名称**：frontend（multi-agent-platform 的 Web 前端子项目）
- **定位**：SillyHub 多智能体平台的控制台前端，提供工作区管理、agent 执行与日志、daemon 交互式会话、变更（SillySpec）流程、组件拓扑、发布/运行时/成员/知识/事件/审批/审计等全功能 Web UI
- **用户角色**：登录用户（含 admin / 普通成员），通过 `(dashboard)/admin` 管理组织/用户/角色权限，通过 `(dashboard)/workspaces/[id]/*` 操作工作区
- **形态**：Next.js App Router 单体应用（RSC + Client Components + Route Handler），独立 `frontend/` 子目录，pnpm 包管理，Docker 镜像部署
- **后端协作**：所有 API 经 Next.js rewrite 代理 `/api/*` → backend（默认 `http://localhost:8000`），含 REST 与 SSE 流式两类；前端不直接持有 backend host

## 技术栈

| 类别 | 选型 |
|---|---|
| 框架 | Next.js 14.2.5（App Router / RSC, `experimental.typedRoutes`）+ React 18.3.1 |
| 语言 | TypeScript strict（`noUncheckedIndexedAccess`, target ES2022），路径别名 `@/* → ./src/*` |
| UI 主库 | Ant Design 6.4.4 + `@ant-design/icons` + `@ant-design/nextjs-registry` |
| UI 补充 | shadcn/ui（components.json: default / rsc / slate / cssVariables）+ lucide-react |
| 样式 | Tailwind 3.4.7 + tailwindcss-animate + postcss + autoprefixer；`cn()` 合并工具 |
| 状态 | Zustand 4.5（`persist` 中间件，session store） |
| 数据 | 原生 `fetch` + 统一网关 `lib/api.ts`（401 自动刷新）；React Query 依赖未启用 |
| 流式 | `fetch + getReader + TextDecoder` 消费 SSE；3 个 Route Handler 透传 backend SSE |
| 可视化 | `@xyflow/react` 12（ReactFlow，组件拓扑图） |
| Markdown | `@uiw/react-markdown-preview` |
| 校验 | zod + class-variance-authority + clsx + tailwind-merge |
| 单测 | vitest 2 + jsdom + @testing-library/react + jest-dom（setup `src/test/setup.ts`） |
| E2E | `@playwright/test ≥1.60` + `puppeteer 24`（依赖已声明，脚本未落地） |
| Lint/类型 | eslint 8.57 + eslint-config-next；`tsc --noEmit` |
| 构建 | `next build`（可选 `NEXT_BUILD_STANDALONE=1` standalone）；`Dockerfile` 生产镜像 |
| 包管理 | pnpm（`pnpm-lock.yaml`；另有遗留 `package-lock.json`） |
| 环境变量 | `NEXT_PUBLIC_API_BASE_URL`、`NEXT_PUBLIC_COMMIT_SHA` |

## 关键入口

- 根布局：`src/app/layout.tsx`（metadata + antd registry）
- 主壳层：`src/app/(dashboard)/layout.tsx` + `src/components/app-shell.tsx`
- 工作区：`src/app/(dashboard)/workspaces/[id]/layout.tsx`（嵌套，承载 12 个子路由）
- 数据网关：`src/lib/api.ts`
- 会话 store：`src/stores/session.ts`
- SSE 透传：`src/app/api/**/stream/route.ts`（3 个）

## 命令（根 `local.yaml`）

- `build`：`cd frontend && pnpm build`
- `test`：`cd frontend && pnpm test`
- `lint`：`cd frontend && pnpm lint`
