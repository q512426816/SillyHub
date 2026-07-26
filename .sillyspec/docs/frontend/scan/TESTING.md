---
author: qinyi
created_at: 2026-07-27 00:35:31
source_commit: 6e78b29a
updated_at: 2026-07-26T16:35:31Z
generator: sillyspec-scan
---

# 测试(Testing)

> 子项目:`frontend/`(Next.js 14 App Router)。扫描范围仅限 `frontend/` 内,排除 `node_modules`。事实来自配置文件 + `src/**/*.test.{ts,tsx}` grep,基线数字引用 `docs/code-quality-hardening-2026-07-24.md`。

## 测试框架与运行时

- **单元/组件测试**:Vitest 2(`pnpm test` = `vitest run`),配置见 `vitest.config.ts`。环境 `jsdom`,`globals: true`(tsconfig `types: ["vitest/globals", ...]`,测试内免 import `describe/it/expect`),setup 文件 `src/test/setup.ts`,`css: false`,插件 `@vitejs/plugin-react`,别名 `@/* → ./src/*`。
- **DOM 断言**:`@testing-library/jest-dom ^6.4.6`(vitest 版)+ `@testing-library/react ^16.0.0`,提供 `render/screen/fireEvent/waitFor/renderHook/act`。
- **超时**:`testTimeout: 15000`(默认 5s 提到 15s)。原因见 `vitest.config.ts` 注释:全量并行时 jsdom environment setup 累积变慢,个别组件测试(如 `page-team-toggle`)在全量下超默认上限;只放宽上限不拖慢通过用例。
- **setup.ts polyfill**(`src/test/setup.ts`):注册 jest-dom 匹配器;手动补 `localStorage`(jsdom + Node 22 实验性 localStorage 不可用,zustand persist 依赖)、`matchMedia`(antd Modal/TreeSelect/Select)、`ResizeObserver`(antd Drawer)。
- **E2E 工具链声明但未落地**:`@playwright/test ^1.60.0` 与 `puppeteer ^24.43.1` 已进 `devDependencies`,但仓库内 `frontend/{e2e,tests,playwright}` 目录、`playwright.config.*`、任意 `*.spec.ts` 均 **0 命中**(Glob 全量确认)。即端到端测试尚未编写,当前仅靠 vitest 组件测覆盖前端;`@playwright/test` 当前仅作为 `next` 的间接运行时依赖被安装。

## 测试规模与分布

- **测试文件数:114 个**(仅 `src/` 内 `*.test.ts` / `*.test.tsx`,`find` 精确统计;仓库不使用 `*.spec.ts` 命名)。
- **就近原则(co-located)**:测试与源码同目录,统一放 `__tests__/` 子目录或同文件名 `.test.tsx`。
- **按层分布**:
  - 数据层 `lib/`(40+ 文件):`api`、`agent`、`daemon`、`admin`、`permission`、`daemon-permission`、`daemon-session`、`daemon-audit`、`daemon-usage`、`use-agent-run-stream`(SSE race 专项)、`use-daemon-machines`、`use-daemon-runtimes`、`use-workspace-context`、`ppm/{aggregations,format,workday}`、`scan-docs-tree`、`spec-workspaces`、`menu-permissions`、`client-path`、`workspace-path`、`format-token`、`token-refresh`、`query-client`、`errors` 等。
  - 组件层 `components/`(30+ 文件):`agent-run-panel`、`agent-log-viewer`(+ tool-kind 变体)、`workspace-card`、`workspace-daemon-switcher`、`workspace-config-card`、`workspace-binding-dialog`、`workspace-path-picker`、`workspace-access-guide`、`top-bar`、`admin-{org-tree,organization-tree,role-permission-picker,user-drawer}`、`change-file-tree`、`change-session-section`、`stage-team-config`、`mission-console`、`team-progress`、`file-upload`、`file-viewer`、`runtime-usage-line-chart`、`work-hour-{bar,pie}-chart`、`logout-confirm-dialog`、`ask-user-dialog-card`、`daemon/{interactive-session-panel,runtime-session-dialog,remote-folder-picker,session-list-layout,machine-card,runtime-card,session-log-sanitize}`、`permissions/{session-permission-panel,dialog-context-bar}`、`mobile/{mobile-tab-bar,mobile-card-list}` 等。
  - 页面层 `app/`:`runtimes/page`(+ usage 变体)、`runtimes/[id]/audit/page`、`workspaces/page`、`workspaces/[id]/page`(+ sync/team-toggle/create-change/mcp/skills 变体)、`ppm/{milestone-details,task-detail-modal,problem-detail-modal,kanban-task-detail-drawer,kanban-gantt-helpers,workbench/todo-list-panel,ImportModuleModal}`、`settings/{mcp,skills}/page`、`account/page`、`layout`、`m/{layout,ppm/milestone-details}`、`app/page`、`middleware`、`lib/auth/route-guard`。
  - Route Handler:`app/api/daemon/sessions/[sessionId]/stream/__tests__/route.test.ts`(SSE 透传 Accept / Content-Type / 状态码)。
- **最新基线**(取自 `docs/code-quality-hardening-2026-07-24.md` §0/§3):**1059 passed / 29 todo / 1 file skipped**,tsc 全绿;六批代码质量加固前后均零回归。

## 类型守护(契约级测试)

- **OpenAPI 类型漂移守护**:`pnpm gen:types:check`(`scripts/gen-api-types.mjs`)——先驱动 backend `uv run python scripts/dump_openapi.py` 刷新 `backend/openapi.json`,再用 `openapi-typescript --no-install` 重新生成 `src/lib/api-types.ts`,最后 `git diff --exit-code` 守护生成结果未漂移。这是「手写类型 → 生成类型」迁移后的硬性闸门。
- **静态类型检查**:`pnpm typecheck`(`tsc --noEmit`);全仓 `@ts-ignore` / `@ts-expect-error` 计数为 **0**(零类型绕过债)。

## 已知测试坑(均已在代码/注释中处理,引用记忆)

1. **MarkdownText jsdom 渲染 null**:`src/components/ui/markdown-text.tsx` 用 `next/dynamic` + `ssr:false`(react-markdown 依赖浏览器 API),jsdom 同步 render 处于 loading 返回 null。所有用到该组件的测试需 `vi.mock` 替换为纯文本渲染(20+ 处文件注释标明此坑,例:`components/__tests__/agent-log-viewer.test.tsx:18`、`components/daemon/runtime-session-dialog.test.tsx:46`、`app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-team-toggle.test.tsx:25`)。ECharts 包装(`components/charts/index.tsx`)同款 `next/dynamic ssr:false`,测试绕过方式见 `components/__tests__/work-hour-bar-chart.test.tsx:4`(直接 import 具体组件文件,绕过 charts/index.ts 的 dynamic)。
2. **`refetchInterval` 需抽纯函数**:react-query 轮询钩子在测试里需把 `refetchInterval` 计算抽成纯函数以便断言(27 个源文件用到 `refetchInterval` —— `lib/query-client.ts`、`lib/daemon-audit.ts`、`lib/use-daemon-{machines,runtimes}.ts`、`lib/use-agent-runs.ts`、`lib/workspace-daemon-status.ts` 等,印证迁移面广)。
3. **`console.error` 静默**:`app/(dashboard)/workspaces/[id]/agent/__tests__/page.test.tsx:138` 与 `lib/__tests__/use-agent-runs.test.tsx:35` 用 `vi.spyOn(console,"error").mockImplementation(()=>{})` 屏蔽预期错误日志——属必要静默但会掩盖真实报错,新增测试应优先断言错误而非静默。
4. **antd 两汉字按钮自动插空格**:antd 6 对连续两个 CJK 字符的按钮文案会自动插入空格,测试文本断言需注意。
5. **OpenAPI 生成类型 nullable**:`api-types.ts` 中 nullable 字段需 `?? null`;后端 `by_alias=False` 会让字段别名与预期不一致——`gen:types:check` 是发现这类回归的唯一闸门。
6. **SSE hook race 专项**:`lib/use-agent-run-stream.ts` 含多处 `if (cancelled) return;` 处理 StrictMode 双调用 / 快速重连 / unmount 后旧闭包写 state;改动前先读顶部注释,保留 `use-agent-run-stream.test.ts` 的 cancelled 断言。

## 常用命令

- `pnpm test` — `vitest run`(单次全量,CI 用)
- `pnpm test:watch` — `vitest`(watch 模式)
- `pnpm typecheck` — `tsc --noEmit`
- `pnpm gen:types` — dump openapi.json + 生成 `src/lib/api-types.ts`
- `pnpm gen:types:check` — 上一步 + `git diff --exit-code` 漂移守护
- `pnpm lint` — `next lint`(ESLint)
- 顶层 Makefile 别名:`make frontend-test` / `make frontend-typecheck` / `make frontend-lint` / `make frontend-build`。
