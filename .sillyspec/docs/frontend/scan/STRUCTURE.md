---
author: qinyi
created_at: 2026-07-27 00:35:31
source_commit: 6e78b29a
updated_at: 2026-07-26T16:35:31Z
generator: sillyspec-scan
---

# 目录结构(Structure)

frontend 子项目基于 Next.js 14 App Router(`next@14.2.5`)构建,采用 `src/` 目录布局,TypeScript 严格模式(`strict` + `noUncheckedIndexedAccess`),路径别名 `@/*` → `./src/*`(见 `tsconfig.json`)。下文覆盖旧版扫描结果。

## 顶层配置文件

```
frontend/
├── package.json              # pnpm@9.6.0 工程清单(依赖+脚本 dev/build/test/gen:types)
├── next.config.mjs           # Next 配置:rewrites /api 与 /daemon → backend、typedRoutes、optimizePackageImports
├── tsconfig.json             # TS 严格配置(strict+noUncheckedIndexedAccess),paths @/* → src/*
├── tailwind.config.ts        # Tailwind 主题(darkMode class + 语义色,接 antd tokens)
├── postcss.config.mjs        # Tailwind + autoprefixer
├── components.json           # shadcn/ui 配置(基础组件在 src/components/ui)
├── vitest.config.ts          # 单测配置(jsdom + globals + @ alias + test/setup.ts)
├── Dockerfile                # 生产镜像(NEXT_BUILD_STANDALONE=1 → standalone)
├── .env.example              # 环境变量样例(NEXT_PUBLIC_API_BASE_URL / NEXT_PUBLIC_COMMIT_SHA 等)
├── .eslintrc.json            # eslint-config-next
├── pnpm-lock.yaml            # pnpm 锁文件
└── next-env.d.ts / tsconfig.tsbuildinfo
```

## 源码目录 `src/`

### `src/app` — Next.js App Router 路由

```
src/app/
├── layout.tsx                # 根 layout(metadata + AntdRegistry + AntdProviders + Inter 字体 + Providers)
├── page.tsx                  # 首页 /
├── globals.css               # Tailwind 指令 + 全局样式
├── favicon.ico
├── (auth)/login/page.tsx     # 登录路由组(client 组件)
├── (dashboard)/              # 主控台路由组
│   ├── layout.tsx            # 主壳层(挂 AppShell)
│   ├── loading.tsx           # 路由级 loading
│   ├── account/              # 账户中心
│   ├── admin/                # 后台(layout.tsx + organizations)
│   ├── ppm/                  # PPM 项目管理(当前最大业务域),见下
│   ├── runtimes/             # 运行时健康(含 [id]/audit、usage、install-daemon-os 测试)
│   ├── settings/             # 设置(api-keys / git-identities / mcp / skills)
│   └── workspaces/           # 工作空间
│       ├── page.tsx          # 列表
│       └── [id]/             # 详情(最大子树)
│           ├── layout.tsx / page.tsx / error.tsx
│           ├── agent/        # Agent 执行面板
│           ├── approvals/    # 审批中心
│           ├── audit/        # 审计日志
│           ├── changes/      # 变更中心([cid]/ + tasks/ + tasks/[tid])
│           ├── components/   # 组件清单 + topology/(拓扑可视化)
│           ├── create-change/  # 新建变更
│           ├── files/        # 文件中心
│           ├── incidents/    # 事件([iid])
│           ├── knowledge/    # 知识库
│           ├── mcp/          # MCP 服务配置
│           ├── members/      # 成员管理
│           ├── missions/     # 任务(missions)控制台
│           ├── releases/     # 发布
│           ├── runtime/      # 运行时绑定
│           ├── scan-docs/    # 扫描文档
│           └── skills/       # 工作空间技能
├── m/                        # 移动端独立路由组(/m/*)
│   ├── layout.tsx / login/ / account/ / workspaces/
│   └── ppm/{project-plans, milestone-details, problem-list, task-plans, workbench}
└── api/                      # Next.js Route Handlers(SSE/流式代理)
    ├── daemon-chat/[runId]/stream/route.ts
    ├── daemon/sessions/[sessionId]/stream/route.ts (+ __tests__)
    └── workspaces/[workspaceId]/agent/runs/[runId]/stream/route.ts
```

**PPM 子模块**(`src/app/(dashboard)/ppm/`):`page.tsx` + `shared.tsx`;`workbench`(工作台,`_components/`:todo-list-panel、work-calendar-panel、personal-metric-strip、profile-summary-card、quick-entry-grid、message-placeholder、workbench-task-table)、`kanban`(看板,`_components/`:kanban-gantt、kanban-actual-gantt、kanban-date-nav、kanban-work-hour-chart、kanban-task-context-menu、kanban-task-detail-drawer、kanban-search-bar)、`projects`、`project-members`、`project-plans`、`project-stakeholders`、`plan-nodes`、`milestone-details`、`task-execute`、`problem-list`(`_problem-drawer`、`_forms`)、`work-hour-statistics`、`customers`;共享 `_components/`(problem-detail-modal、task-detail-modal)。

### `src/components` — React 组件

按域分组:`agent-log/`(normalize、tool-renderers、tool-kind-meta、types + 测试)、`daemon/`(interactive-session-panel、runtime-session-dialog、remote-folder-picker、session-list-layout、machine-card、session-log-sanitize + 测试)、`changes/`(change-session-section)、`charts/`(RuntimeUsageLineChart、WorkHourBarChart、WorkHourPieChart,基于 echarts)、`permissions/`(session-permission-panel、dialog-context-bar)、`layout/`(page-container、page-header、section-card、search-bar、data-table、form-layout + index.ts)、`ui/`(shadcn 基础件 avatar/badge/button/card/dialog/dropdown-menu/empty-state/input/markdown-text)。顶层组件覆盖工作空间(workspace-card、workspace-tabs、workspace-binding-*、workspace-path-*、workspace-config-card、workspace-daemon-switcher、workspace-switcher、workspace-member-*、workspace-access-guide、workspace-binding-guard)、Agent(agent-run-panel、agent-log-viewer、AgentModelInput、AgentProviderSelect)、PPM(ppm-* 系列:project-plan-form/detail、project-members-table、resource-table、status-actions、sub-table、user-select、dict-select、text)、管理后台(admin-org-tree、admin-organization-tree、admin-user-drawer、admin-role-permission-picker)、文件中心(file-upload、file-viewer、file-image)、App 外壳(app-shell、top-bar、antd-providers、error-boundary)、mission(mission-console、mission-summary-card、team-progress)、sillyspec-step-progress、daemon-required-notice、logout-confirm-dialog、api-key-create-dialog、custom-skill-edit-dialog、ask-user-dialog-card、permission-approval-card。各域配 `__tests__/`。

### `src/lib` — TypeScript 工具与 API 客户端

- 入口客户端:`api.ts`(apiFetch + Token 注入 + 401 自动 refresh,浏览器走 `window.location.origin` 经 Next rewrite 代理,server 走 `SERVER_API_BASE_URL`)、`api-types.ts`(openapi-typescript 生成,>14000 行)、`query-client.ts`(react-query makeQueryClient 工厂)、`query-keys.ts`、`auth.ts` + `auth/route-guard.ts`、`token-refresh.ts`、`errors.ts`
- 数据 hooks:`use-agent-runs.ts`、`use-agent-run-stream.ts`、`use-daemon-runtimes.ts`、`use-daemon-machines.ts`、`use-workspace-context.ts`
- 业务封装:`daemon.ts`、`daemon-audit.ts`、`workspaces.ts`、`workspace-members.ts`、`workspace-binding.ts`、`workspace-path.ts`、`workspace-daemon-status.ts`、`workspace-skills-view.ts`、`spec-workspaces.ts`、`changes.ts`、`change-files.ts`、`tasks.ts`、`approvals.ts`、`incidents.ts`、`knowledge.ts`、`releases.ts`、`audit.ts`、`runtime.ts`、`admin.ts`、`health.ts`、`settings.ts`、`providers.tsx`、`permission.ts`、`menu-permissions.ts`、`custom-skills.ts`、`git-identities.ts`、`api-keys.ts`、`mcp-settings.ts`、`scan-docs.ts`、`scan-docs-tree.ts`、`workflow.ts`、`status-labels.ts`、`format-token.ts`、`client-path.ts`、`utils.ts`、`agent.ts` + `agent-stream.ts`
- 子目录:`ppm/`(aggregations、kanban、plan、task、problem、workbench、weekly-plan、workday、project、export、format、status-label、types、index + 测试)、`file/`(api、utils)、`api/`(llm-providers + 测试)

### `src/stores` — Zustand 状态

`session.ts`(useSession 登录态)、`kanban.ts`(useKanbanStore 看板视图)、`workspace.ts`(工作空间相关 store + 测试)。配合 persist 中间件做 localStorage 恢复(见 `auth/route-guard.ts` 的 hydrated 守卫)。

### `src/styles` — 设计系统令牌

`tokens.ts`(颜色/间距 token + cssVars `--color-primary` 等,接 Tailwind 与 antd)、`fonts.ts`(Inter localFont + @fontsource/inter)、`index.ts`(统一导出)。

### `src/test` — 测试基础设施

`setup.ts`:vitest 全局 setup(jest-dom 匹配器 + jsdom)。

### `public/` — 静态资源

`.gitkeep`、`logo.png`(品牌 Logo)、`templates/dev-plan-template.xlsx`(PPM 导入模板)。
