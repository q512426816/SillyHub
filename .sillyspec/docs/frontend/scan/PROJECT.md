---
author: qinyi
created_at: 2026-07-27 00:35:31
source_commit: 6e78b29a
updated_at: 2026-07-26T16:35:31Z
generator: sillyspec-scan
---

# 项目(Project)

> 子项目:`frontend/`,包名 `multi-agent-platform-web`。monorepo(SillyHub / multi-agent-platform)下的 Web 控制台前端,与 backend(FastAPI)+ sillyhub-daemon 协同。事实来自 `frontend/src/` + 配置文件 + 根 `README.md`。

## 项目简介

frontend 是平台面向用户的统一 Web 控制台(thin client),**不持有业务逻辑**,所有数据经 REST API(`/api/*`,由 Next.js rewrites 代理到 backend)+ SSE(日志/会话流)与后端通信。承担以下职责(取自根 `README.md` 功能清单 + 实际路由):

- **工作空间(workspace)管理**:注册 Git 仓库为工作空间,扫描 `.sillyspec` 目录;daemon 工作区、成员、宿主路径、daemon 切换(`app/(dashboard)/workspaces/**`,含 `[id]` 详情下的 components/topology/files/members/skills/mcp/knowledge/incidents/releases/missions/agent/runtime/audit/changes)。
- **变更生命周期**:proposal → design → plan → tasks → execute → verify 全流程页面与进度展示(`workspaces/[id]/changes/**`)。
- **Agent Run 面板 + 编排**:触发后台 agent 调度,经 SSE 实时流式展示执行日志/工具调用/待审批权限/pending_input;核心 `components/agent-run-panel.tsx` + hook `useAgentRunStream`(race guard 专项)。
- **交互式 daemon 会话**:聊天式会话面板(`components/daemon/interactive-session-panel.tsx`),流式回复 + 权限交互;`daemon/runtime-session-dialog` 管理生命周期。
- **PPM(项目/项目群管理)**:最大业务模块(`app/(dashboard)/ppm/*`),含 projects / project-plans / plan-nodes / milestone-details / kanban / work-hours / work-hour-statistics / problem-list / task-plans / task-execute / customers / project-members / project-stakeholders / project-members / workbench(待办) / weekly-plan 等 16+ 子路由 + 看板甘特/工时图表;**已正式上线**(CLAUDE.md 规则 11)。
- **移动端**:独立路由 `app/m/**`(layout + login + workspaces + ppm/{workbench,milestone-details,problem-list,task-plans,project-plans} + account),与桌面端共享 PPM 组件但布局适配。
- **管理后台**:组织 / 用户 / 角色权限树(`app/(dashboard)/admin/{organizations,users,roles}`)。
- **设置**:API Key、Git 身份、MCP、技能(`app/(dashboard)/settings/**`)。
- **运行时监控**:后端健康、组件状态、daemon usage 审计(`app/(dashboard)/runtimes/**`)。
- **拓扑可视化**:基于 `@xyflow/react` 的组件拓扑交互视图。
- **认证**:JWT + refresh token,会话/token 由 `stores/session.ts`(zustand persist)持有;中间件 `src/middleware.ts` + `lib/auth/route-guard.ts` 做路由守卫。
- **形态**:Next.js App Router 单体应用(Server + Client Components 混合 + Route Handler),独立 `frontend/` 子目录,pnpm 包管理,Docker 镜像部署。UI 默认中文(CLAUDE.md 规则 12)。

## 技术栈

| 类别 | 选型(版本取自 `package.json`) |
|---|---|
| 框架 | Next.js **14.2.5**(App Router,`output` 可选 standalone,`reactStrictMode`)+ React **18.3.1** |
| 语言 | TypeScript **5.5.4**(`strict` + `noUncheckedIndexedAccess`,`target: ES2022`),别名 `@/* → ./src/*` |
| UI 主库 | Ant Design **6.4.4** + `@ant-design/icons ^6.2.5` + `@ant-design/nextjs-registry ^1.3.0` |
| UI 补充 | shadcn/ui 风格原子件(`src/components/ui/`)+ Radix(`@radix-ui/react-{avatar,dialog,dropdown-menu}`)+ `lucide-react ^0.400.0` |
| 样式 | Tailwind 3.4.7 + tailwindcss-animate + postcss + autoprefixer;`darkMode: ["class"]`,HSL CSS 变量语义色;`class-variance-authority` + `clsx` + `tailwind-merge` 组合 |
| 字体 | `@fontsource/inter ^5.2.8` |
| 客户端状态 | Zustand **4.5**(`stores/session.ts`、`stores/kanban.ts`、`stores/workspace.ts`) |
| 服务端数据 | TanStack React Query **^5.51**(+ `react-query-devtools`);`lib/query-client.ts` + `lib/query-keys.ts` 统一管理 |
| 流式 | `EventSource`(`AgentRunStreamClient`)消费 SSE;3 个 Route Handler 透传 backend SSE(`api/daemon/sessions/[sessionId]/stream` 等) |
| 可视化 | ECharts **6.1.0**(`echarts` + `echarts-for-react ^3.0.6`)、`@xyflow/react ^12.10.2`(拓扑流程图) |
| Markdown | `@uiw/react-markdown-preview ^5.2.1`(`next/dynamic ssr:false` 加载) |
| 校验/日期 | zod **^3.23**、dayjs ^1.11.21 |
| API 层 | 统一 fetch 封装 `src/lib/api.ts`(注入 `x-request-id`、抛 `ApiError`)+ 33 个模块化客户端(`lib/{agent,daemon,admin,workspaces,changes,...}.ts`)+ 生成类型 `src/lib/api-types.ts`(openapi-typescript) |
| 单测 | vitest **^2.0** + jsdom ^24.1.3 + @testing-library/react ^16 + jest-dom ^6.4.6(详见 `scan/TESTING.md`) |
| 类型守护 | openapi-typescript ^7.13.0 + `gen:types:check`(git diff 守漂移) |
| E2E | `@playwright/test ^1.60.0` + `puppeteer ^24.43.1`(**依赖已声明,脚本未落地**) |
| Lint/类型 | eslint 8.57 + eslint-config-next 14.2.5(`next lint`);`tsc --noEmit` |
| 构建 | `next build`(可选 `NEXT_BUILD_STANDALONE=1` standalone);`frontend/Dockerfile` 生产镜像 |
| 包管理 | pnpm **9.6.0**(`pnpm-lock.yaml`;另有遗留 `package-lock.json`) |
| 运行时 | Node `>=20.0.0`(`engines`) |
| 环境变量 | `NEXT_PUBLIC_API_BASE_URL`、`INTERNAL_API_BASE_URL`、`NEXT_BUILD_STANDALONE` |

## 关键命令

- `pnpm dev` / `pnpm build` / `pnpm start`:开发 / 构建 / 生产启动
- `pnpm test`(`vitest run`)/ `pnpm test:watch`
- `pnpm typecheck`(`tsc --noEmit`)/ `pnpm lint`(`next lint`)
- `pnpm gen:types` / `pnpm gen:types:check`(OpenAPI 类型生成 + 漂移守护)

> 仓库根通过 `cd frontend && pnpm <cmd>` 或顶层 `make frontend-*` 调用。

## 规模参考

- `src/app/**/page.tsx`:**60 个页面路由**(含 `(dashboard)` 与 `(auth)` 路由组 + 移动端 `m/*`)。
- `src/lib/`:**52 个 `.ts` 文件**(数据层 / API 客户端 / 权限 / SSE / 工具 / hook)。
- `src/stores/`:3 个 zustand store(session / kanban / workspace)。
- 测试文件:**114 个**(详见 `scan/TESTING.md`);最新基线 1059 passed / 29 todo / 1 skipped。
- 设计系统总纲:`.sillyspec/changes/archive/2026-06-21-2026-06-21-frontend-style-system/design.md`;页面级规范:`.sillyspec/docs/SillyHub/scan/FRONTEND_PAGE_STYLE.md`(以 `/ppm/projects` 为基准)。
