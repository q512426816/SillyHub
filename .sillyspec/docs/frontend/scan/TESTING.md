---
source_commit: ba87eec
updated_at: 2026-06-23T16:24:51Z
created_at: 2026-06-24T00:24:51
author: qinyi
generator: sillyspec-scan
---

# frontend 测试扫描

> 基于 `frontend/` 配置文件 + `src/**/*.test.{ts,tsx}` grep 事实，全量重扫覆盖旧版。源码未逐行 Read，仅做摘要级统计。

## 框架与配置

- **单元/组件测试**：vitest 2（`vitest@^2.0.0`）+ `@testing-library/react@^16.0.0` + `@testing-library/jest-dom@^6.4.6`，运行环境 jsdom（`jsdom@^24.1.0`）。
- **vitest 配置**（`frontend/vitest.config.ts`）：`environment: "jsdom"`、`globals: true`、`setupFiles: ["./src/test/setup.ts"]`、`css: false`、`@vitejs/plugin-react` 插件、`@/* → ./src/*` alias。
- **setup**（`src/test/setup.ts`）：注册 `@testing-library/jest-dom/vitest` 自定义匹配器；并手写 localStorage polyfill（vitest jsdom + Node 22 实验性 localStorage 不可用，daemon/admin 经 zustand persist 依赖 localStorage）。
- **tsconfig**：`types: ["vitest/globals", "@testing-library/jest-dom"]`，测试内无需 import `describe/it/expect`。
- **运行命令**：`pnpm test`（`vitest run`，CI）/ `pnpm test:watch`（监听）。typecheck=`tsc --noEmit`，lint=`next lint`。
- **E2E**：依赖声明 `@playwright/test@^1.60.0` + `puppeteer@^24.43.1`，但 `frontend/` 下 `e2e/` / `tests/` / `playwright/` 目录均不存在（0 命中）—— E2E 脚本尚未落地，依赖仅占位。

## 测试规模与分布

- **测试文件总数**：36 个（`*.test.{ts,tsx}`），`describe/it/test` 块合计约 522 处。
- **co-locate 约定**：测试就近放在源文件旁的 `__tests__/` 子目录或同级 `xxx.test.tsx`。
- **testing-library 用法**：`render/screen/fireEvent/waitFor/renderHook/act` 等导入合计约 627 处；典型导入 `import { fireEvent, render, screen } from "@testing-library/react"`，`waitFor`/`within`/`cleanup`/`act` 按需引入。

### 按层分布

| 层 | 文件 | 覆盖内容 |
|---|---|---|
| 数据层 `lib/` | `api`、`agent`、`daemon`、`spec-workspaces`、`admin`、`menu-permissions`、`permission`、`daemon-permission`、`daemon-session`、`use-agent-run-stream`、`client-path`、`workspace-path`、`format-token`、`ppm-workday`；`lib/ppm/__tests__/{aggregations,format}` | API 封装、权限/菜单计算、SSE hook race、路径与格式化 |
| 组件层 `components/` | `agent-run-panel`（含同级 `agent-run-panel.test.tsx`）、`ask-user-dialog-card`、`permission-approval-dialog`、`admin-organization-tree`、`admin-role-permission-picker`、`admin-user-drawer`、`agent-log-viewer`、`project-plan-cost-bar-chart`、`work-hour-bar-chart`、`work-hour-pie-chart`、`workspace-daemon-switcher`、`logout-confirm-dialog`、`top-bar`、`daemon/__tests__/interactive-session-panel`、`daemon/runtime-session-dialog` | 关键交互/表单/图表/会话面板 |
| 工具层 | `components/agent-log/__tests__/normalize` | SSE 日志归一化 |
| 页面层 `app/` | `app/(dashboard)/runtimes/page.test.tsx`、`app/(dashboard)/ppm/milestone-details/__tests__/milestone-details.test.tsx` | 仅 2 个页面级 |
| Route Handler | `app/api/daemon/sessions/[sessionId]/stream/__tests__/route.test.ts` | SSE 透传（Accept / Content-Type / 状态码） |

## 测试风格

- **断言**：vitest 原生 `describe / it / test` + `expect`（globals 开启）。
- **mock 策略**：fetch/Response 在测试内手动构造（如 SSE 测试用 `new Response("data: {}\n\n", { headers: { "Content-Type": "text/event-stream" } })`）；hook 用 `renderHook` / `act`；交互组件测试中存在 `any` 形参用于构造 fake 连接（如 `interactive-session-panel.test.tsx` 的 FakeConn handlers）。
- **race guard 专项**：`use-agent-run-stream.test.ts` 覆盖 StrictMode 双调用 / 快速重连 / unmount 后旧 effect 闭包写 state 的 `cancelled` flag（源 `lib/use-agent-run-stream.ts` 有 8 处 `if (cancelled) return;`）。
- **薄弱点**：页面级测试仅 runtimes + milestone-details；PPM 其余 14 个子路由、admin 页面、agent-run 页面无页面级覆盖。
