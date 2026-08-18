---
author: qinyi
created_at: 2026-08-18 01:06:26
source_commit: 744e3de4
updated_at: 2026-08-17T17:06:26Z
generator: sillyspec-scan
---

# 项目（Project）

> 子项目：`frontend/`，包名 `multi-agent-platform-web`。monorepo（SillyHub / multi-agent-platform）下的 Web 控制台前端，与 backend（FastAPI）+ sillyhub-daemon 协同。事实来自 `frontend/` 配置文件 + `src/` Glob 实测（frontend/ 自身无 README）。

## 项目简介

frontend 是 SillyHub 平台面向用户的统一 Web 控制台（thin client），不持有业务逻辑：所有数据经 Next.js rewrites 把 `/api/*` 与 `/daemon/*` 代理到 backend（`next.config.mjs`，`INTERNAL_API_BASE_URL ?? NEXT_PUBLIC_API_BASE_URL ?? http://localhost:8000`），实时流（日志/会话）走 SSE——3 个 Route Handler 透传后端 SSE（daemon-chat/[runId]/stream、daemon/sessions/[sessionId]/stream、workspaces/[workspaceId]/agent/runs/[runId]/stream）。承担：工作空间与变更全流程管理（proposal→…→archive 页面与进度投影）、Agent Run 面板、交互式 daemon 会话、任务派发、文件中心、审批、审计、MCP token 管理、PPM 项目管理（已上线模块）、LLM 供应商设置、组织/角色/用户管理。UI 默认中文（CLAUDE.md 规则 12）。

## 技术栈

| 类别 | 选型（版本取自 package.json / 配置实测） |
|---|---|
| 框架 | Next.js **14.2.5**（App Router，精确锁版；`NEXT_BUILD_STANDALONE=1` 可切 standalone；`reactStrictMode` + 实验 `typedRoutes`）+ React / react-dom **18.3.1** |
| 语言 | TypeScript **5.5.4**（`strict` + `noUncheckedIndexedAccess`，target ES2022），别名 `@/* → ./src/*` |
| UI 主库 | Ant Design **^6.4.4** + `@ant-design/icons ^6.2.5` + `@ant-design/nextjs-registry ^1.3.0` |
| UI 补充 | shadcn/ui 风格原子件（`src/components/ui/`）+ Radix（avatar/dialog/dropdown-menu）+ `lucide-react ^0.400.0` |
| 样式 | Tailwind 3.4.7（`darkMode: ["class"]`，HSL CSS 变量语义色 + 状态语义色 success/warning/error/info）+ tailwindcss-animate + cva + clsx + tailwind-merge |
| 字体 | `@fontsource/inter ^5.2.8`（中文降级 PingFang SC / Microsoft YaHei） |
| 客户端状态 | Zustand **^4.5**（`stores/{session,kanban,workspace}.ts` 3 个 store） |
| 服务端数据 | TanStack React Query **^5.51**（`lib/query-client.ts` 统一配置）+ `@tanstack/react-virtual ^3.14.9` |
| 流式 | fetch-SSE 消费；3 个 Route Handler 无缓冲代理 backend SSE（鉴权走 Authorization header，token 不落 URL query） |
| 可视化 | ECharts **^6.1.0**（经 `echarts-for-react ^3.0.6`，桶导出 `next/dynamic ssr:false`）+ `@xyflow/react ^12.10.2`（组件拓扑） |
| Markdown | `@uiw/react-markdown-preview ^5.2.1` + `rehype-sanitize ^6.0.0`（`ui/markdown-text.tsx`，ssr:false） |
| 校验/日期 | zod ^3.23、dayjs ^1.11.21 |
| API 层 | 统一 fetch 封装 `src/lib/api.ts` + 模块化客户端（`lib/{agent,daemon,workspaces,admin,…}.ts`，共 71 个非测试 `.ts`）+ 生成类型 `src/lib/api-types.ts` |
| 单测 | vitest ^2.0 + jsdom ^24.1.3 + @testing-library/react ^16 + jest-dom ^6.4.6（详见 `scan/TESTING.md`） |
| 类型生成 | openapi-typescript ^7.13.0（`pnpm gen:types`，`gen:types:check` 守漂移） |
| E2E | `@playwright/test ^1.60.0` + `puppeteer ^24.43.1`（依赖已声明、**未启用**，见 `scan/CONCERNS.md`） |
| Lint / 构建 | eslint 8.57 + eslint-config-next 14.2.5（`next lint`）；`next build` + `frontend/Dockerfile` 生产镜像 |
| 包管理 / 运行时 | pnpm 9.6.0（仅 `pnpm-lock.yaml`）；Node >=20（engines） |

## 页面域清单（65 个 page.tsx 路由，Glob 实测）

- 顶层：`(auth)/login`、根跳转页。
- `(dashboard)` 顶层：`workspaces`、`sessions`（会话中心）、`agent-profiles`、`runtimes`（+ `[id]/audit`）、`ppm/*` 16 子域（projects、project-plans、plan-nodes、milestone-details、kanban、work-hours、work-hour-statistics、problem-list、task-plans、task-execute、customers、project-members、project-stakeholders、workbench、weekly-plan、index）、`admin/{organizations,users,roles}`、`settings/{index,api-keys,git-identities,mcp,skills,providers}`、`account`。
- `workspaces/[id]/` 子域：index、components（+ topology 拓扑）、files、members、skills、mcp、mcp-tokens、knowledge、incidents（+ `[iid]`）、releases、missions、agent、agent-profiles、runtime、audit、approvals、sessions、scan-docs、changes（+ `[cid]` 详情与 `[cid]/tasks/[tid]` 任务页）。
- 移动端 `m/`：login、workspaces、account、`ppm/{workbench,milestone-details,problem-list,task-plans,project-plans}`。

## 与后端契约

- `src/lib/api-types.ts` 必须由 `pnpm gen:types` 从 `backend/openapi.json` 生成（openapi-typescript），**禁止手写**（CLAUDE.md 规则 21）；后端 schema 有改动时同 change 内须 regen 并提交 `api-types.ts` + `backend/openapi.json`；`gen:types:check` 用 `git diff --exit-code` 守漂移（当前不在 CI，见 `scan/CONCERNS.md`）。
- 前端服务端代理契约：`/api/*` 与 `/daemon/*`（daemon 安装脚本公开端点）两条 rewrite 规则。

## 关键命令

- `pnpm dev` / `pnpm build` / `pnpm start`
- `pnpm test` / `pnpm test:watch` / `pnpm typecheck` / `pnpm lint`
- `pnpm gen:types` / `pnpm gen:types:check`

## 规模参考

- 65 个页面路由（Glob 实测）；`src/lib/` 71 个非测试 `.ts`；3 个 zustand store；157 个测试文件（分布详见 `scan/TESTING.md`）；`api-types.ts` 32857 行（生成物，wc 实测）。
- 设计系统总纲：`.sillyspec/changes/archive/2026-06-21-2026-06-21-frontend-style-system/`；页面级规范：`.sillyspec/docs/SillyHub/scan/FRONTEND_PAGE_STYLE.md`。
