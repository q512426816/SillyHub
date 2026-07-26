---
author: qinyi
created_at: 2026-07-27 00:35:31
source_commit: 6e78b29a
updated_at: 2026-07-26T16:35:31Z
generator: sillyspec-scan
---

# 架构(Architecture)

> 子项目:`frontend/`(包名 `multi-agent-platform-web`)——SillyHub 平台的 Next.js 前端,承担 SillySpec 变更查看器、多 Agent 执行控制台、PPM 项目/任务管理三大前台界面。
> 本文为 `--force-rescan` 重新生成的快照,依据 `frontend/` 实际源码(commit `6e78b29a`),排除 `node_modules`。

## 技术栈

- **框架**:Next.js 14.2.5(App Router,`src/app/` 目录),React 18.3.1,React DOM 18.3.1;Node ≥ 20,pnpm 9.6.0 管理。
- **语言**:TypeScript 5.5.4,`strict` + `noUncheckedIndexedAccess` 全开(`tsconfig.json`),路径别名 `@/* → ./src/*`,开启实验性 `typedRoutes`。
- **UI 组件**:antd 6.4 + `@ant-design/icons` 6.2 + `@ant-design/nextjs-registry`(SSR 样式注入);Tailwind CSS 3.4.7 + `tailwindcss-animate`;Radix UI(`react-avatar` / `react-dialog` / `react-dropdown-menu`)封装的 headless 组件位于 `src/components/ui/`;`lucide-react` 图标;`class-variance-authority` + `clsx` + `tailwind-merge` 做变体与类名合并。
- **数据/状态**:`@tanstack/react-query` 5.51 做服务端状态(查询/变更缓存,`src/lib/query-client.ts` 工厂 + `src/lib/providers.tsx` 全局 Provider);`zustand` 4.5 做客户端状态(`src/stores/session.ts` 鉴权会话、`workspace.ts` 当前工作区、`kanban.ts`);`zod` 运行时校验;`dayjs` 时间处理。
- **可视化**:`echarts` 6.1 + `echarts-for-react`(图表在 `src/components/charts/`);`@xyflow/react` 12.10 组件拓扑图;`@uiw/react-markdown-preview` 渲染 Agent 输出与文档。
- **API 类型**:`scripts/gen-api-types.mjs` 先跑 backend `dump_openapi.py` 刷新 `openapi.json`,再用 `openapi-typescript` 生成 `src/lib/api-types.ts`;`pnpm gen:types:check` 以 `git diff --exit-code` 守护类型漂移。
- **构建优化**:`next.config.mjs` 对 `antd` / `@ant-design/icons` / `lucide-react` / `@xyflow/react` 启用 `optimizePackageImports`(命名导入按需转换,减小 chunk);`NEXT_BUILD_STANDALONE=1` 切 standalone 输出供 Docker 镜像。
- **测试**:`vitest` 2 + `@testing-library/react` + `jsdom`(单测,`types` 引入 `vitest/globals` 与 `@testing-library/jest-dom`);`@playwright/test` 与 `puppeteer` 做 e2e。

## 架构概览

### 路由组织(App Router 路由组)

`src/app/` 用路由组(`(...)`)与动态段组织三大类入口:

- `(auth)/login` —— 登录页(根级,不经 Dashboard 外壳)。
- `(dashboard)/...` —— 主桌面台,外层 `(dashboard)/layout.tsx` 装配 `AppShell`,内含登录守卫 + 工作区守卫(白名单 `/workspaces` `/admin` `/settings` `/ppm` `/runtimes` `/account`;依赖工作区但无 `wsId` 的路由重定向到 `/workspaces` 选择器)。下设:
  - `workspaces/[id]/...` —— 单工作区维度:changes(变更/任务/创建)、agent(执行面板)、runtime、scan-docs、files、members、mcp、skills、knowledge、incidents、releases、approvals、audit、components/topology 等。
  - `ppm/...` —— PPM 项目管理:projects、project-plans、project-members、task-plans、task-execute、workbench、kanban、problem-list、plan-nodes、milestone-details、work-hours、work-hour-statistics、weekly-plan、customers、project-stakeholders。
  - `runtimes`、`admin/{users,roles,organizations}`、`settings/{api-keys,git-identities,skills,mcp}`、`account` —— 平台级后台。
- `m/...` —— 移动端精简入口(`m/login`、`m/ppm/{workbench,project-plans,task-plans,milestone-details,problem-list}`、`m/workspaces`、`m/account`),独立 `m/layout.tsx`。

### 分层(自下而上)

1. **API 层** `src/lib/api.ts` 的 `apiFetch<T>()`:薄 fetch 封装,自动注入 `x-request-id`(便于后端日志关联)与 `Authorization: Bearer <accessToken>`(从 `useSession` zustand store 读);浏览器端走相对 URL,经 Next.js rewrite 代理到 backend(`next.config.mjs` 的 `rewrites` 把 `/api/:path*` 与 `/daemon/:path*` 转发到 `INTERNAL_API_BASE_URL` / `NEXT_PUBLIC_API_BASE_URL`,默认 `http://localhost:8000`);SSR 直连绝对地址。401 触发单飞 token 刷新(`token-refresh.ts` 模块级 inflight 保证并发风暴只发 1 次 `POST /api/auth/refresh`),成功后带 `x-auth-retry:1` 重试一次,失败清 session 跳 `/login`;非 2xx 抛 `ApiError`(`code` / `status` / `requestId` / `details`)。
2. **领域服务层** `src/lib/<domain>.ts`(如 `changes.ts` / `daemon.ts` / `workspaces.ts` / `tasks.ts` / `agent.ts` / `releases.ts` / `scan-docs.ts` / `auth.ts` / `admin.ts` / `ppm/*`):每个文件按业务域封装一组 API 调用 + 本地类型,react-query 的 hook(`use-*.ts`、`use-agent-runs.ts`、`use-daemon-runtimes.ts`、`use-agent-run-stream.ts` 等)与 `query-keys.ts`(查询键工厂)在其上构建缓存策略。
3. **状态层** zustand store(`src/stores/`)持有跨页面的客户端态:鉴权 token、当前工作区、看板视图。
4. **组件层** `src/components/`:
   - `layout/`(`page-container` / `page-header` / `section-card` / `data-table` / `form-layout` / `search-bar`)—— 页面级统一布局骨架。
   - `ui/`(`button` / `card` / `dialog` / `dropdown-menu` / `avatar` / `badge` / `input` / `empty-state` / `markdown-text`)—— Radix + cva 封装的基础组件(设计系统原子)。
   - 业务组件按域分目录:`daemon/`(runtime 卡片、交互式会话面板、远程文件夹选择)、`charts/`(echarts 图表)、`permissions/`(会话权限面板)、`ppm/`(里程碑/问题导入抽屉)、`changes/`(变更会话段)、`agent-log/`(工具渲染器)等;以及顶层业务组件(`agent-run-panel`、`mission-console`、`team-progress`、`workspace-card`、`top-bar`、`app-shell`、`error-boundary`)。
5. **页面层** `src/app/.../page.tsx` 组合上述组件 + hook 渲染。

### Provider 装配链(根 layout)

`src/app/layout.tsx` 自外向内:`<html lang="zh-CN">` → `AntdRegistry`(antd SSR 样式)→ `AntdProviders`(antd ConfigProvider/主题)→ `AppProviders`(`QueryClientProvider` + `ReactQueryDevtools`,dev 才挂 DevTools;`QueryClient` 用 `useState` 工厂法创建稳定实例,避免 SSR 跨请求共享缓存)。Inter 字体由 `src/styles/fonts.ts` 注入。

### 数据流与约定

- **服务端状态**:统一走 react-query(`useQuery` / `useMutation`),查询键集中在 `query-keys.ts`,变更后按需 invalidate;流式场景(Agent 输出)由 `agent-stream.ts` / `use-agent-run-stream.ts` 处理。
- **类型真相**:后端 OpenAPI 生成的 `api-types.ts` 是接口形状的唯一来源,手写类型仅作局部视图模型;`gen:types:check` 守护漂移。
- **样式**:Tailwind utility 为主,设计 token 集中在 `src/styles/tokens.ts`;页面级规范参考 `.sillyspec/changes/archive/2026-06-21-2026-06-21-frontend-style-system/` 与 `docs/SillyHub/scan/FRONTEND_PAGE_STYLE.md`。
- **i18n / 文案**:UI 与文档默认中文(本项目未正式上线,PPM 模块已上线)。
