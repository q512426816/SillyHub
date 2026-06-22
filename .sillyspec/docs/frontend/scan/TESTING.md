---
source_commit: fcbf3fa7
updated_at: 2026-06-22T18:12:36Z
generator: sillyspec-scan
author: qinyi
created_at: 2026-06-23 02:12:36
---

# frontend 测试扫描

> 基于 `frontend/src/**/*.{test,spec}.{ts,tsx}` glob + grep 摘录，覆盖旧版文档。

## 框架与配置

- **单元/组件测试**：vitest 2 + jsdom + `@testing-library/react` + `@testing-library/jest-dom`
- **config**：`frontend/vitest.config.ts`（`environment: jsdom`、`globals: true`、`setupFiles: ["./src/test/setup.ts"]`、`@/*` alias）
- **setup**：`src/test/setup.ts`（注册 jest-dom 自定义匹配器，配置 jsdom）
- **tsconfig**：`types: ["vitest/globals", "@testing-library/jest-dom"]`，测试内无需 import `describe/it/expect`
- **运行命令**：`cd frontend && pnpm test`（CI） / `pnpm test:watch`（监听）
- **E2E**：`@playwright/test ≥1.60` + `puppeteer 24` 已声明依赖，但 `frontend/` 下未发现 `e2e/` / `tests/` / `playwright/` 目录与 spec 文件（glob 0 命中）——E2E 脚本尚未落地

## 测试范围

测试文件按源文件就近放置在 `__tests__/` 子目录，co-locate 约定。覆盖重心：

- **数据层（`lib/`）**：`api.test.ts`、`agent.test.ts`、`daemon.test.ts`、`spec-workspaces.test.ts`、`admin.test.ts`、`menu-permissions.test.ts`、`permission.test.ts`、`daemon-permission.test.ts`、`daemon-session.test.ts`、`use-agent-run-stream.test.ts`、`client-path.test.ts`、`workspace-path.test.ts`、`format-token.test.ts`、`ppm-workday.test.ts`，以及 `lib/ppm/__tests__/{aggregations,format}.test.ts`
- **组件层（`components/`）**：`agent-run-panel`、`ask-user-dialog-card`、`permission-approval-dialog`、`admin-organization-tree`、`admin-role-permission-picker`、`admin-user-drawer`、`agent-log-viewer`、`project-plan-cost-bar-chart`、`work-hour-bar-chart`、`work-hour-pie-chart`、`workspace-daemon-switcher`、`interactive-session-panel`
- **页面层（`app/`）**：`app/(dashboard)/runtimes/page.test.tsx`、`app/(dashboard)/ppm/milestone-details/__tests__/milestone-details.test.tsx`
- **Route Handler**：`app/api/daemon/sessions/[sessionId]/stream/__tests__/route.test.ts`（验证 SSE Accept / Content-Type / 状态码透传）
- **工具层**：`components/agent-log/__tests__/normalize.test.ts`（SSE 日志归一化）

## 测试风格

- **断言库**：vitest 原生 `describe / it / test` + `expect`（globals 开启，无需 import）。
- **mock 策略**：fetch/Response 在测试内手动构造（如 SSE 测试用 `new Response("data: {}\n\n", { headers: { "Content-Type": "text/event-stream" } })`）；hook 测试用 `@testing-library/react` 的 `renderHook` / `act`。
- **覆盖重心**：数据层（lib/）+ 关键交互组件（admin / daemon / permission / charts）+ SSE 透传 Route Handler；页面级测试覆盖较薄（仅 runtimes 与 milestone-details）。
- **race guard 测试**：`use-agent-run-stream.test.ts` 专门覆盖 unmount/依赖变化下的 `cancelled` flag 行为。
