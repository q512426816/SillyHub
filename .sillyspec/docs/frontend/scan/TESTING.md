---
author: qinyi
created_at: 2026-08-18 01:06:26
source_commit: 744e3de4
updated_at: 2026-08-17T17:06:26Z
generator: sillyspec-scan
---

# 测试（Testing）

> 子项目：`frontend/`（Next.js 14 App Router）。扫描范围仅限 `frontend/`，CI 部分读仓库根 `.github/workflows/frontend-ci.yml`。文件数为 Glob 实测；用例总数本次未复跑（项目记录最近一次全量约 1400 用例全绿，2026-08-11，本次未核实）。

## 命令（package.json scripts）

- `pnpm test` — `vitest run`（单次全量，CI 用）
- `pnpm test:watch` — `vitest`（watch 模式）
- `pnpm typecheck` — `tsc --noEmit`
- `pnpm lint` — `next lint`
- `pnpm gen:types` — dump `backend/openapi.json` + 生成 `src/lib/api-types.ts`
- `pnpm gen:types:check` — 上一步 + `git diff --exit-code src/lib/api-types.ts` 漂移守护

## vitest.config.ts 关键配置

- `environment: "jsdom"`、`globals: true`（tsconfig `types: ["vitest/globals", "@testing-library/jest-dom"]`，测试内免 import describe/it/expect）、`setupFiles: ["./src/test/setup.ts"]`、`css: false`、插件 `@vitejs/plugin-react`、别名 `@/* → ./src/*`。
- `clearMocks: true`（P1 隔离加固）：每测试自动清 mock 调用计数；刻意不启用 `restoreMocks`——大量测试在 describe/beforeAll 级持久化 spy 实现，restore 会还原原实现致组件渲染为空（配置注释载明 21 用例红的教训）。
- `testTimeout: 15000`：全量并行时 jsdom environment setup 累积变慢（page-team-toggle 曾超 5s 默认值），只放宽上限不拖慢通过用例。
- `environmentMatchGlobs`：纯逻辑测试切 node 环境省 jsdom 启动（全量 collect/environment 累计 300s+ 的大头是 jsdom 启动）——两组白名单精确匹配 `src/lib` 下确定无 DOM 的 `.test.ts`；用 renderHook / fake EventSource 依赖 jsdom 的 use-* 与 daemon-session 不在列，引入 DOM 依赖时须从白名单移除。

## setup 文件（src/test/setup.ts）

- 注册 jest-dom 匹配器（`@testing-library/jest-dom/vitest`）；`configure({ asyncUtilTimeout: 5000 })`——CI 满载并发下 `findBy*`/`waitFor` 默认 1s 等待偶发 flake（ImportModuleModal 曾连续超时），合法等待更宽容、通过仍毫秒级。
- 手动 polyfill 三件：`localStorage`（jsdom + Node 22 实验性 localStorage 不可用，zustand persist 依赖）、`matchMedia`（antd Modal/TreeSelect/Select）、`ResizeObserver`（antd Drawer）。

## 测试文件分布（Glob 实测，共 157 个）

- 合计：`.test.tsx` 115 + `.test.ts` 42 = **157 个**；全仓不使用 `*.spec.ts` 命名（Glob 0 命中）。
- `src/components/**`：**88 个**（83 tsx + 5 ts）——组件层，如 agent-run-panel、daemon/interactive-session-panel（+ offline / changeid 变体）、changes/detail 卡片族、llm-providers 表单族、sessions 面板族、mobile 组件。
- `src/app/**`：**35 个**（31 tsx + 4 ts）——页面层（runtimes、workspaces 与 workspaces/[id] 各子页、sessions、agent-profiles、settings/{mcp,skills,providers}、ppm 系列、m/ 移动端）+ Route Handler `app/api/daemon/sessions/[sessionId]/stream/__tests__/route.test.ts`。
- `src/lib/**`：**32 个**（31 ts + 1 tsx）——数据层与 hook（api、agent、daemon、daemon-session、fetch-sse、token-refresh、use-agent-run-stream、mcp-tokens、permission 等）。
- 其余 2 个：`src/middleware.test.ts`、`src/stores/workspace.test.ts`。
- colocate 惯例：测试与源码同目录，放 `__tests__/` 子目录或同名 `.test.ts(x)` 并排，无集中 test 目录。

## 测试模式

- @testing-library/react ^16 + jest-dom ^6.4.6：render / screen / fireEvent / waitFor / renderHook / act。
- mock 惯例：统一 `vi.mock("<模块路径>")`。真实例：`src/components/permissions/session-permission-panel.test.tsx:38` —— `vi.mock("@/lib/api", () => ({ getApiBaseUrl: () => "http://localhost" }))`。
- 已知 jsdom 坑（`next/dynamic ssr:false` 组件同步渲染 null，须 vi.mock）：`ui/markdown-text`（现有 **14 个**测试文件各自 mock）与 `charts/index.tsx` 桶导出；图表测试的绕法是直接 import 具体组件文件跳过桶导出（`components/__tests__/work-hour-bar-chart.test.tsx:4-6` 有注释说明）。

## E2E

- `@playwright/test ^1.60.0` 与 `puppeteer ^24.43.1` 均在 devDependencies，但 `playwright.config.*`、`*.spec.ts`、e2e/tests 目录全仓 **0 命中**——**E2E 未启用**（详见 scan/CONCERNS.md）。

## CI（.github/workflows/frontend-ci.yml）

- 触发：push / PR 涉及 `frontend/**`；单 job `lint-build-test`，ubuntu-latest，timeout 15 分钟，working-directory `frontend`。
- 环境：pnpm 9.6.0 + Node 20 + `pnpm install --frozen-lockfile`（cache 依赖 `frontend/pnpm-lock.yaml`）。
- 步骤：`pnpm lint` → `pnpm typecheck` → `pnpm test` → `pnpm build`（`NEXT_PUBLIC_API_BASE_URL=http://localhost:8000`）。
- `gen:types:check` **不在任何 CI workflow**（workflows 目录 grep `gen:types` 0 命中）——OpenAPI 类型漂移守护仅靠本地跑 + 流程纪律（CLAUDE.md 规则 21）。

## 类型守护

- `tsc --noEmit` 为 CI 硬门禁；`tsconfig.json` 开 `strict` + `noUncheckedIndexedAccess`，`types` 含 vitest/globals 与 jest-dom。
- 类型逃逸口受控：全 src `@ts-ignore` 0 处，`@ts-expect-error` 仅 1 处（`app/api/daemon/sessions/[sessionId]/stream/route.ts:63`，undici compress 非标准 RequestInit 字段的注释性豁免）。
- `src/lib/api-types.ts`（32857 行生成物）由 openapi-typescript ^7.13.0 从 `backend/openapi.json` 生成，禁止手写；nullable 字段需 `?? null` 兜底，`gen:types:check` 是发现此类回归的闸门。
