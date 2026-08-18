---
author: qinyi
created_at: 2026-08-18 01:06:26
source_commit: 744e3de4
updated_at: 2026-08-17T17:06:26Z
generator: sillyspec-scan
---

# 目录结构（Structure）

frontend 子项目基于 Next.js 14 App Router（`next@14.2.5`）构建，采用 `src/` 目录布局，TypeScript 严格模式（`strict` + `noUncheckedIndexedAccess`），路径别名 `@/*` → `./src/*`（见 `frontend/tsconfig.json`）。全站共 65 个 `page.tsx` 路由文件。本文覆盖旧版（6e78b29a，2026-07-26）扫描结果；相对旧版新增 sessions / agent-profiles / mcp-tokens 页面域、`m/` 移动路由段（含 `src/middleware.ts` UA 分流）、`fetch-sse.ts` SSE 通道等。

## 顶层目录与配置文件

```
frontend/
├── src/                      # 源码（见下）
├── public/                   # 静态资源（logo.png + templates/dev-plan-template.xlsx PPM 导入模板）
├── scripts/                  # 工程脚本
│   └── gen-api-types.mjs     # 后端 OpenAPI → src/lib/api-types.ts 类型生成（pnpm gen:types）
├── package.json              # pnpm@9.6.0 工程清单（dev/build/lint/typecheck/test/gen:types 脚本）
├── next.config.mjs           # /api 与 /daemon rewrite 代理到 backend；typedRoutes；optimizePackageImports
├── tsconfig.json             # TS 严格配置（strict+noUncheckedIndexedAccess），@/* → src/*
├── tailwind.config.ts        # Tailwind 主题（darkMode class + 语义色，接 antd tokens）
├── postcss.config.mjs        # Tailwind + autoprefixer
├── components.json           # shadcn/ui 配置（基础组件在 src/components/ui）
├── vitest.config.ts          # 单测配置（jsdom + globals + @ alias + clearMocks + 纯逻辑测试 node 环境白名单）
├── Dockerfile                # 生产镜像（NEXT_BUILD_STANDALONE=1 → standalone）
├── .env.example              # 环境变量样例（NEXT_PUBLIC_API_BASE_URL / NEXT_PUBLIC_COMMIT_SHA）
├── .eslintrc.json            # eslint-config-next
└── pnpm-lock.yaml            # pnpm 锁文件
```

## `src/` 一级目录

```
src/
├── app/          # Next.js App Router 路由（页面 + Route Handlers）
├── components/   # React 组件（按域分组，见下）
├── lib/          # API 客户端、类型契约、业务封装、数据 hooks
├── config/       # 前端静态配置（llmProviderPresets.ts：LLM 供应商预设）
├── stores/       # Zustand 状态（session / kanban / workspace）
├── styles/       # 设计系统令牌（tokens.ts / fonts.ts / index.ts）
├── test/         # 测试基础设施（setup.ts：vitest 全局 setup）
├── middleware.ts # 移动端 UA 分流中间件（+ middleware.test.ts）
```

注：项目无独立 `hooks/` 目录，数据 hooks（`use-agent-runs.ts` 等）放在 `src/lib/` 下。

## `src/app` — 路由树（page.tsx 全量核实）

```
src/app/
├── layout.tsx                # 根 layout（AntdRegistry + AntdProviders + AppProviders 嵌套）
├── page.tsx                  # 首页 /
├── error.tsx / global-error.tsx  # 路由级 / 全局错误边界
├── globals.css               # Tailwind 指令 + 全局样式
├── (auth)/login/page.tsx     # 登录
├── (dashboard)/              # 主控台路由组（layout.tsx 挂 AppShell + loading.tsx）
│   ├── account/              # 账户中心
│   ├── admin/                # 后台（organizations / roles / users）
│   ├── agent-profiles/       # Agent 档案全局页
│   ├── sessions/             # 会话中心（顶层会话列表）
│   ├── ppm/                  # PPM 项目管理（最大业务域），见下
│   ├── runtimes/             # 运行时健康（+ [id]/audit）
│   ├── settings/             # 设置（index / api-keys / git-identities / mcp / providers / skills）
│   └── workspaces/           # 工作空间
│       ├── page.tsx          # 列表
│       └── [id]/             # 工作空间详情（最大子树）
│           ├── page.tsx      # 概览
│           ├── agent/        # Agent 执行面板
│           ├── agent-profiles/  # 工作空间级 Agent 档案
│           ├── approvals/    # 审批中心
│           ├── audit/        # 审计日志
│           ├── changes/      # 变更中心（[cid]/ 详情 + tasks/ + tasks/[tid]/）
│           ├── components/   # 组件清单 + topology/（@xyflow 拓扑可视化）
│           ├── files/        # 文件中心
│           ├── incidents/    # 事件（[iid]）
│           ├── knowledge/    # 知识库
│           ├── mcp/          # MCP 服务配置
│           ├── mcp-tokens/   # MCP Token 签发/吊销
│           ├── members/      # 成员管理
│           ├── missions/     # 任务控制台
│           ├── releases/     # 发布
│           ├── runtime/      # 运行时绑定
│           ├── scan-docs/    # 扫描文档
│           ├── sessions/     # 工作空间会话面板
│           └── skills/       # 工作空间技能
├── m/                        # 移动端独立路由组（/m/*，由 middleware UA 分流进入）
│   ├── layout.tsx / login/ / account/ / workspaces/
│   └── ppm/{workbench, project-plans, milestone-details, problem-list, task-plans}
└── api/                      # Next.js Route Handlers（SSE 流式代理，3 个 route.ts）
    ├── daemon-chat/[runId]/stream/route.ts
    ├── daemon/sessions/[sessionId]/stream/route.ts（+ __tests__）
    └── workspaces/[workspaceId]/agent/runs/[runId]/stream/route.ts
```

**PPM 子模块**（`src/app/(dashboard)/ppm/`，16 个页面）：`page.tsx` 概览；`workbench` 工作台（`_components/`：todo-list-panel、work-calendar-panel、personal-metric-strip、profile-summary-card、quick-entry-grid、message-placeholder、workbench-task-table）；`kanban` 看板（`_components/`：kanban-gantt、kanban-actual-gantt、kanban-date-nav、kanban-work-hour-chart、kanban-workload-grid、kanban-task-context-menu、kanban-task-detail-drawer、kanban-search-bar）；`projects`、`project-members`、`project-plans`、`project-stakeholders`、`plan-nodes`、`milestone-details`、`task-plans`、`task-execute`、`weekly-plan`、`problem-list`、`work-hours`、`work-hour-statistics`、`customers`；共享 `_components/`（problem-detail-modal、task-detail-modal）。

## `src/components` — 组件分组

- `ui/`：shadcn 基础件（avatar / badge / button / card / confirm-captcha / dialog / dropdown-menu / empty-state / input / json-editor / markdown-text / status-badge）。
- `layout/`：页面骨架（page-container / page-header / section-card / search-bar / data-table + index.ts 统一导出）。
- `agent/`：Agent 借用方案文件面板（borrowed-solution-files*）。
- `agent-log/`：Agent 日志渲染（normalize、tool-renderers、tool-kind-meta、run-error-item、types）。
- `agent-profile/`：Agent 档案卡片网格 / 卡片 / 预览。
- `daemon/`：daemon 会话与运行时 UI（interactive-session-panel、runtime-session-dialog、runtime-card、session-input-bar、session-list-layout、turn-timeline、machine-card、remote-folder-picker、session-log-sanitize 等）。
- `sessions/`：会话面板（session-list-panel【@tanstack/react-virtual 虚拟滚动】、new-session-form、session-config-bar、ctx-usage-bar）。
- `changes/`：变更中心组件（change-session-section、change-step-badge、quicklog-drawer、quicklog-table、detail/ 子目录）。
- `charts/`：echarts 图表（RuntimeUsageLineChart、WorkHourBarChart、WorkHourPieChart + index.tsx）。
- `permissions/`：会话权限（session-permission-panel、dialog-context-bar）。
- `llm-providers/`：LLM 供应商设置（llm-provider-form、llm-provider-list、model-input-with-fetch、usage-footer）。
- `mobile/`：移动端组件族（mobile-app-shell、mobile-top-bar、mobile-tab-bar、mobile-card-list、mobile-filter-drawer、mobile-detail-sheet、milestone-sheet、mobile-action-menu、mobile-batch-bar、mobile-export-button）。
- `ppm/`：PPM 域组件（milestone/、problem/ 子目录）。
- `workspace/`：工作空间管理（shared-daemon-manager、shared-daemon-toggle、LinkWorkspaceDialog、LinkedProjectsSection）。
- 顶层散件：App 外壳（app-shell、top-bar、antd-providers、error-boundary、logout-confirm-dialog）、工作空间系列（workspace-card / tabs / binding-dialog / binding-guard / path-picker / path-fields / config-card / daemon-switcher / switcher / member-* / access-guide / scan-dialog / session-section）、Agent（agent-run-panel、agent-log-viewer、AgentModelInput、AgentProviderSelect）、PPM 系列（ppm-project-plan-form/detail、ppm-project-members-table、ppm-resource-table、ppm-status-actions、ppm-sub-table、ppm-user-select、ppm-dict-select、ppm-text）、管理后台（admin-org-tree、admin-organization-tree、admin-user-drawer、admin-role-permission-picker）、其它（mission-console、mission-summary-card、team-progress、stage-team-config、skill-content-drawer、api-key-create-dialog、mcp-token-create-dialog、custom-skill-edit-dialog、ask-user-dialog-card、permission-approval-card、daemon-required-notice、change-file-tree、file-upload、file-viewer、file-image）。各域配 `__tests__/` 或同级 `.test.tsx`。

## `src/lib` — API 客户端与业务封装

- 入口客户端：`api.ts`（apiFetch：浏览器相对 URL 走 Next rewrite、server 走 SERVER_API_BASE_URL；`x-request-id` 头、Bearer Authorization、ApiError 结构、401 自动 refresh）、`api-types.ts`（openapi-typescript 生成，32857 行，前后端类型契约事实源）、`token-refresh.ts`、`auth.ts` + `auth/route-guard.ts`、`errors.ts`、`fetch-sse.ts`（fetch+ReadableStream 的 SSE 订阅，token 走 Authorization header）、`query-client.ts` / `query-keys.ts`（react-query）、`providers.tsx`（AppProviders）、`utils.ts`（cn 等）。
- 数据 hooks：`use-agent-runs.ts`、`use-agent-run-stream.ts`、`use-daemon-machines.ts`、`use-workspace-context.ts`。
- 实时/流式：`agent-stream.ts`（AgentRunStreamClient，基于 fetch-sse）、`daemon.ts`（daemon 会话流 + permission 通道 SSE）、`spec-workspaces.ts`（POST /import 的 SSE 进度流，fetch+ReadableStream 自解析）。
- 业务封装：workspaces / workspace / workspace-members / workspace-binding / workspace-path / workspace-daemon-status / workspace-skills-view、changes / change-files / tasks / quicklog、agent / agent-profiles、approvals、incidents、knowledge、releases、audit / daemon-audit、runtime、admin、health、settings、providers（menu-permissions、permission）、custom-skills、git-identities、api-keys、mcp-settings、mcp-tokens、scan-docs / scan-docs-tree、components、workflow、status-labels、format-token、client-path。
- 子目录：`ppm/`（aggregations、kanban、plan、task、problem、workbench、weekly-plan、workday、project、export、execute-time、format、status-label、types、index）、`file/`（api、utils.tsx）、`api/`（llm-providers）、`auth/`（route-guard）、`__tests__/`。

## `src/stores` — Zustand 状态

`session.ts`（useSession 登录态）、`kanban.ts`（useKanbanStore 看板视图）、`workspace.ts`（工作空间 store，+ 测试）。配合 persist 中间件做 localStorage 恢复。

## `src/styles` / `src/config` / `src/test`

- `styles/tokens.ts`（颜色/间距 token + cssVars，接 Tailwind 与 antd）、`styles/fonts.ts`（@fontsource/inter + localFont）、`styles/index.ts`。
- `config/llmProviderPresets.ts`（LLM 供应商预设常量）。
- `test/setup.ts`（vitest 全局 setup：jest-dom 匹配器 + jsdom）。
