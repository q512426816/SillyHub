---
source_commit: ba87eec
updated_at: 2026-06-23T16:24:51Z
created_at: 2026-06-24T00:24:51
author: qinyi
generator: sillyspec-scan
---

# frontend 项目

> monorepo（SillyHub / multi-agent-platform）下的 Web 控制台前端。包名 `multi-agent-platform-web`，独立子项目，与 backend（FastAPI）+ sillyhub-daemon 协同。基于 `frontend/src/` 与配置文件事实采集，全量重扫覆盖旧版。

## 项目简介

frontend 是平台面向用户的统一 Web 控制台（thin client），**不包含业务逻辑**，所有数据通过 REST API（`/api/*`，由 Next.js rewrites 代理到 backend）+ SSE（日志/会话流）与后端通信。承担以下职责：

- **工作区（workspace）管理**：daemon 工作区、成员、宿主路径、daemon 切换（`workspace-daemon-switcher`、`workspace-path-fields`、`workspace-scan-dialog`，路由 `app/(dashboard)/workspaces`）。
- **Agent Run 面板**：触发后台 agent 调度，经 SSE 实时流式展示执行日志 / 工具调用 / 待审批权限 / pending_input（用户提问）。核心 `components/agent-run-panel.tsx` + hook `useAgentRunStream`。
- **交互式 daemon 会话**：聊天式会话面板（`components/daemon/interactive-session-panel.tsx`），支持流式回复与权限交互；`daemon/runtime-session-dialog` 管理会话生命周期。
- **PPM（项目管理系统）**：项目 / 计划 / 里程碑 / 任务 / 问题 / 变更 / 看板 / 工时统计的完整 CRUD 与图表，是最大业务模块（`app/(dashboard)/ppm/*`，含 16 个子路由：projects / project-plans / plan-nodes / milestone-details / kanban / work-hours / work-hour-statistics / problem-list / problem-changes / task-plans / task-execute / customers / project-members / project-stakeholders）。
- **管理后台**：组织 / 用户 / 角色权限树（`app/(dashboard)/admin/*`）。
- **设置**：API Key、Git 身份管理（`app/(dashboard)/settings/*`）。
- **运行时（Runtimes）**：后端服务健康、组件状态展示（`app/(dashboard)/runtimes`）。

- **用户角色**：登录用户（admin / 普通成员），会话与 token 由 `stores/session.ts`（zustand persist）持有。
- **形态**：Next.js App Router 单体应用（Server + Client Components 混合 + Route Handler），独立 `frontend/` 子目录，pnpm 包管理，Docker 镜像部署。
- **SSE 透传**：3 个 Route Handler 透传 backend SSE —— `api/daemon-chat/[runId]/stream`、`api/daemon/sessions/[sessionId]/stream`、`api/workspaces/[workspaceId]/agent/runs/[runId]/stream`。

## 技术栈

| 类别 | 选型 |
|---|---|
| 框架 | Next.js 14.2.5（App Router，`output` 可选 standalone，`reactStrictMode`）+ React 18.3.1 |
| 语言 | TypeScript（`strict` + `noUncheckedIndexedAccess`，`target: ES2022`），路径别名 `@/* → ./src/*` |
| UI 主库 | Ant Design 6.4.4 + `@ant-design/icons` 6.2 + `@ant-design/nextjs-registry` |
| UI 补充 | shadcn/ui + Radix（`@radix-ui/react-{avatar,dialog,dropdown-menu,tooltip}`）+ lucide-react |
| 样式 | Tailwind 3.4 + tailwindcss-animate + postcss；`darkMode: ["class"]`，HSL CSS 变量语义色 |
| 字体 | `@fontsource/inter` |
| 客户端状态 | Zustand 4.5（`stores/session.ts`、`stores/kanban.ts`） |
| 服务端数据 | TanStack React Query 5.51 |
| 流式 | `EventSource`（`AgentRunStreamClient`）消费 SSE；3 个 Route Handler 透传 backend SSE |
| 可视化 | ECharts 6（`echarts` + `echarts-for-react`）、`@xyflow/react` 12（流程图） |
| Markdown | `@uiw/react-markdown-preview` |
| 校验/组合 | zod 3 + class-variance-authority + clsx + tailwind-merge |
| 日期 | dayjs |
| 单测 | vitest 2 + jsdom 24 + @testing-library/react 16 + jest-dom 6（setup `src/test/setup.ts`） |
| E2E | `@playwright/test ≥1.60` + `puppeteer 24.43`（依赖已声明，脚本未落地） |
| Lint/类型 | eslint + eslint-config-next（`next lint`）；`tsc --noEmit` |
| 构建 | `next build`（可选 `NEXT_BUILD_STANDALONE=1` standalone）；`Dockerfile` 生产镜像 |
| 包管理 | pnpm 9.6.0（`pnpm-lock.yaml`；另有遗留 `package-lock.json`） |
| 环境变量 | `NEXT_PUBLIC_API_BASE_URL`、`INTERNAL_API_BASE_URL`、`NEXT_BUILD_STANDALONE` |

## 关键命令

- `pnpm dev` / `pnpm build` / `pnpm start`：开发 / 构建 / 生产启动
- `pnpm lint`（ESLint）/ `pnpm typecheck`（`tsc --noEmit`）
- `pnpm test`（`vitest run`）/ `pnpm test:watch`

> 仓库根通过 `cd frontend && pnpm <cmd>` 调用。

## 规模参考

- `src/lib/` 约 66 个 `.ts` 文件（数据层 / API / 权限 / SSE / 工具）。
- 测试文件 36 个，`describe/it/test` 块约 522 处（详见 `scan/TESTING.md`）。
