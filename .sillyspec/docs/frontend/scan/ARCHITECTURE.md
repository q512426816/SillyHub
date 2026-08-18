---
author: qinyi
created_at: 2026-08-18 01:06:26
source_commit: 744e3de4
updated_at: 2026-08-17T17:06:26Z
generator: sillyspec-scan
---

# 架构（Architecture）

> 子项目：`frontend/`（包名 `multi-agent-platform-web`）——SillyHub 平台的 Next.js 前端，承担 SillySpec 变更/会话驱动控制台、多 Agent 执行面板、PPM 项目/任务管理三大前台界面与移动端精简入口。
> 本文为全量重扫快照，依据 `frontend/` 实际源码（commit `744e3de4`），排除 `node_modules`。

## 技术栈

- **框架**：Next.js 14.2.5（App Router，`src/app/` 目录），React 18.3.1 / React DOM 18.3.1；Node ≥ 20，pnpm 9.6.0 管理。
- **语言**：TypeScript 5.5.4（`typecheck` = `tsc --noEmit`），路径别名 `@/* → ./src/*`。
- **UI 组件**：antd 6.4.4 + `@ant-design/icons` 6.2.5 + `@ant-design/nextjs-registry`（SSR 样式注入）；Tailwind CSS 3.4.7 + `tailwindcss-animate`；Radix UI（`react-avatar` / `react-dialog` / `react-dropdown-menu`）封装的 headless 基础组件在 `src/components/ui/`；`lucide-react` 图标；`class-variance-authority` + `clsx` + `tailwind-merge` 做变体与类名合并。
- **数据/状态**：`@tanstack/react-query` 5.51 做服务端状态（`src/lib/query-client.ts` 工厂 + `src/lib/providers.tsx` 全局 Provider）；`@tanstack/react-virtual` 3.14 长列表虚拟化；`zustand` 4.5 客户端状态（`src/stores/`）；`zod` 运行时校验；`dayjs` 时间处理。
- **可视化/富文本**：`echarts` 6.1 + `echarts-for-react`（`src/components/charts/`）；`@xyflow/react` 12.10 组件拓扑图；`@uiw/react-markdown-preview` + `rehype-sanitize` 渲染 Agent 输出与文档（sanitize 防 XSS）。
- **API 类型**：`scripts/gen-api-types.mjs` 跑 backend `dump_openapi.py` 后用 `openapi-typescript` 生成 `src/lib/api-types.ts`（约 3.29 万行）；`pnpm gen:types:check` 以 `git diff --exit-code` 守护类型漂移（api-types.ts 禁手写，见根 CLAUDE.md 规则 21）。
- **字体/构建**：`@fontsource/inter`；`next.config.mjs` 对 `antd` / `@ant-design/icons` / `lucide-react` / `@xyflow/react` 启用 `optimizePackageImports`；rewrites 把 `/api/*` 与 `/daemon/*` 代理到 `INTERNAL_API_BASE_URL ?? NEXT_PUBLIC_API_BASE_URL`（默认 `http://localhost:8000`）。
- **测试**：`vitest` 2 + `@testing-library/react` + `jsdom`（`src/test/setup.ts`）；`@playwright/test` 与 `puppeteer` 做 e2e。

## 架构概览

### 分层图（自上而下）

```
src/app/                    路由层（App Router：页面 + Route Handler SSE 中继）
   │
src/components/             组件层（layout/ ui/ 基础件 + 按域分组业务组件）
   │
src/lib/                    领域服务层（<domain>.ts 封装 API 调用；use-*.ts hooks；query-keys.ts）
   │                          ├─ stores/（zustand 客户端态）  ├─ config/（llmProviderPresets）
   │
src/lib/api.ts + api-types.ts   API client 层（apiFetch<T> 薄 fetch 封装 + OpenAPI 生成类型）
   │
浏览器相对 URL → Next rewrites(/api,/daemon) → 后端 FastAPI（SSE 经 src/app/api/* Route Handler 中继）
```

### 路由组织（App Router 路由组 + 移动段）

- `(auth)/login` —— 登录页，根级、不经 Dashboard 外壳。
- `(dashboard)/...` —— 主桌面台：`layout.tsx`（client）装配 `AppShell` + 登录守卫（无 accessToken 跳 `/login`）+ 工作区守卫（白名单 `/workspaces /admin /settings /ppm /runtimes /account /agent-profiles /sessions`；先判 `/workspaces/:id` 放行再判前缀，避免重定向循环）。
- `m/...` —— 移动端精简入口（独立 `m/layout.tsx`）；`src/middleware.ts` 服务端按 UA 把白名单页（`/ppm/*` `/workspaces/*` `/login`）rewrite 到 `/m/` 段，URL 不变、无 FOUC；平板走桌面。
- `api/...` —— SSE 中继 Route Handler（见「服务器通信」）。

### 路由域地图（`ls src/app/` 核实）

- **(dashboard) 顶层**：`sessions/`（智能体会话总入口，平台级跨工作区）、`agent-profiles/`（智能体档案全局页）、`account/`、`runtimes/`（+ `[id]` 执行机详情）、`admin/{users,roles,organizations}`、`settings/{api-keys,git-identities,mcp,providers,skills}`（providers = LLM 供应商配置）、`workspaces/`（选择器）、`ppm/`。
- **workspaces/[id]/（18 个子域）**：`agent`、`agent-profiles`、`approvals`、`audit`、`changes`（含 `[cid]/` 详情 + `[cid]/tasks/[tid]` 任务页——会话驱动化后详情页左主右辅）、`components`（拓扑）、`files`、`incidents`、`knowledge`、`mcp`、`mcp-tokens`（MCP 令牌签发/吊销）、`members`、`missions`、`releases`、`runtime`、`scan-docs`、`sessions`、`skills`。
- **ppm/**（16 子域）：projects、project-plans、project-members、project-stakeholders、task-plans、task-execute、workbench、kanban、problem-list、plan-nodes、milestone-details、work-hours、work-hour-statistics、weekly-plan、customers + `_components/`。
- **m/**：login、workspaces、account、ppm/{workbench,project-plans,task-plans,milestone-details,problem-list}。

## 数据层

- **API client**：`src/lib/api.ts` 的 `apiFetch<T>()`——薄 fetch 封装，自动注入 `x-request-id`（后端日志关联）与 `Authorization: Bearer <accessToken>`（从 `useSession` zustand store 读）；浏览器端走相对 URL 经 Next rewrites 代理，SSR 直连绝对地址；401 触发单飞 token 刷新（`token-refresh.ts` 模块级 inflight，并发风暴只发 1 次 `POST /api/auth/refresh`）；非 2xx 抛 `ApiError`（`code` / `status` / `requestId` / `details`）。
- **类型真相**：`src/lib/api-types.ts` 为 OpenAPI 生成物（接口形状唯一来源），手写类型仅作局部视图模型。
- **查询键**：集中 `src/lib/query-keys.ts`（66 行工厂），变更后按需 invalidate。
- **领域服务**：`src/lib/` 按业务域一文件（changes / daemon / workspaces / tasks / agent / agent-profiles / sessions 相关 / approvals / audit / incidents / releases / scan-docs / knowledge / mcp-tokens / mcp-settings / api-keys / git-identities / admin / settings / quicklog / workflow / `api/llm-providers` 等）；`src/lib/ppm/` 独立子域（project / task / plan / problem / kanban / workbench / weekly-plan / aggregations / export 等）。hooks 亦在 lib/：`use-agent-run-stream` / `use-agent-runs` / `use-daemon-machines` / `use-workspace-context`。
- **zustand stores**（Glob `src/stores/` 核实）：`session.ts`（鉴权会话）、`workspace.ts`（当前工作区）、`kanban.ts`（看板视图）。

## 服务器通信

- **REST**：统一 `@tanstack/react-query`（`useQuery` / `useMutation`），经 `apiFetch` 走 rewrites 代理。
- **SSE**：`src/lib/fetch-sse.ts`——用 fetch + ReadableStream 手解析 `text/event-stream` 的 EventSource 替代品，**唯一理由是 token 走 `Authorization` header**（EventSource 无法自定义头，token 进 query 会被访问日志明文记录）；接口形状贴近 EventSource（onopen/onmessage/onerror/addEventListener/readyState/close），**不做自动重连**，断连由调用方查询兜底/手动重建。上层封装：`agent-stream.ts` / `use-agent-run-stream.ts`。
- **SSE 中继 Route Handler**（`src/app/api/`，nodejs runtime + force-dynamic，无缓冲代理转发 backend，透传 Authorization header 与 abort，token 不进 backend URL query）：
  - `api/daemon/sessions/[sessionId]/stream/route.ts`（session 级）
  - `api/daemon-chat/[runId]/stream/route.ts`（daemon 聊天 run 级）
  - `api/workspaces/[workspaceId]/agent/runs/[runId]/stream/route.ts`（workspace agent run 级）

## 组件体系

- **layout/**（页面骨架）：`page-container` / `page-header` / `section-card` / `data-table` / `search-bar`。
- **ui/**（设计系统原子，Radix + cva 的 shadcn 风格）：`button` / `card` / `dialog` / `dropdown-menu` / `avatar` / `badge` / `input` / `empty-state` / `markdown-text` / `json-editor` / `status-badge` / `confirm-captcha`。
- **业务组件按域分目录**（实际 ls 核实）：`agent/`（借阅方案文件面板）、`agent-log/`（工具调用渲染）、`agent-profile/`（卡片网格/预览）、`changes/`（quicklog 抽屉/表格 + `detail/` 详情页 9 卡：stage-header / step-timeline / task-board / files / review-history / sessions / agent-run-log / stage-actions / quicklog-linked）、`charts/`（echarts 用量/工时图）、`daemon/`（runtime 卡片、交互式会话面板、远程文件夹选择、turn 时间线）、`llm-providers/`（表单/列表/用量底栏）、`mobile/`（mobile-app-shell / tab-bar / card-list / filter-drawer 等 12 件）、`permissions/`（会话权限面板）、`ppm/`（milestone/ problem/）、`sessions/`（会话列表/配置栏/新建表单）、`workspace/`（共享 daemon 管理/绑定）。
- **顶层业务组件**：`app-shell` / `top-bar` / `agent-run-panel` / `mission-console` / `mission-summary-card` / `team-progress` / `workspace-card` / `workspace-switcher` / `workspace-scan-dialog` / `error-boundary` / `agent-log-viewer` / `stage-team-config` / `logout-confirm-dialog` 等。

## 样式体系

- **Tailwind + antd 共存**：根 `src/app/layout.tsx` 自外向内 `<html lang="zh-CN">` → `AntdRegistry`（antd SSR 样式注入）→ `AntdProviders`（antd ConfigProvider/主题，`src/components/antd-providers.tsx`）→ `AppProviders`（`QueryClientProvider` + ReactQueryDevtools，dev 才挂；`QueryClient` 用 `useState` 工厂法创建稳定实例避免 SSR 跨请求共享缓存）。
- Tailwind utility 为主，设计 token 集中 `src/styles/tokens.ts`；Inter 字体 `src/styles/fonts.ts`（`@fontsource/inter`）。
- 页面级规范参考 `.sillyspec/changes/archive/2026-06-21-2026-06-21-frontend-style-system/` 与 `docs/SillyHub/scan/FRONTEND_PAGE_STYLE.md`（根 CLAUDE.md 规则 20）。
- i18n/文案：UI 默认中文；日期格式化显式传 `"zh-CN"`（`toLocaleString` 陷阱，见 QUICKLOG ql-007/010 债已清）。
