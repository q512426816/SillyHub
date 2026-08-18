---
schema_version: 1
doc_type: module-card
module_id: test-utils
author: qinyi
created_at: 2026-08-18 01:45:00
---

# 测试基础设施（test-utils）

## 定位
前端测试基础设施与测试用例集合。技术栈 Vitest 2 + jsdom + @testing-library/react。两部分骨架：`src/test/setup.ts`（全局断言扩展、超时调优、三个 polyfill）与 vitest.config.ts（文件路径属 build 模块，但测试语义归此卡管辖）。测试文件全仓约 157 个 `.test.ts(x)`，两种摆放约定并存：`__tests__/` 目录（约 114 个，主约定）与同层 colocated（仅 `src/lib/{daemon,errors,workspace-binding,workspaces}.test.ts` 与 `src/stores/workspace.test.ts` 共 5 个）。

## 契约摘要
vitest.config.ts 关键项：
- `environment: "jsdom"`、`globals: true`（配合 tsconfig types `vitest/globals` + `@testing-library/jest-dom`，测试文件免 import 断言 API）、`setupFiles: ["./src/test/setup.ts"]`、`css: false`。
- `clearMocks: true` — 每测试自动清 mock 调用计数，统一隔离防文件内调用计数跨测试堆叠；**刻意不启用 restoreMocks**（大量测试在 describe/beforeAll 级持久 spy/mock 实现，逐测试还原原实现会致组件渲染为空，曾 21 用例红）。
- `testTimeout: 15000` — 全量并行时 jsdom environment setup 累积变慢，个别组件测试全量下超 5s 上限（治 flaky，不拖慢通过的用例）。
- `environmentMatchGlobs` 纯逻辑测试切 **node 环境**（省 jsdom 每文件初始化，全量 collect/environment 累计 300s+ 的大头）：白名单精确匹配两批——`src/lib/__tests__/{admin,agent,api,client-path,daemon-audit,daemon-permission,daemon-usage,format-token,mcp-tokens,menu-permissions,permission,ppm-workday,query-client,scan-docs-tree,token-refresh,workspace-path}.test.ts` 与 `src/lib/{daemon,errors,workspace-binding,workspaces}.test.ts`；5 个依赖 jsdom 的（use-*、daemon-session 等用 renderHook/fake EventSource）不在此列。
- `resolve.alias`：`@` → `path.resolve(__dirname, "./src")`。

src/test/setup.ts：
- 引入 `@testing-library/jest-dom/vitest`；`configure({ asyncUtilTimeout: 5000 })`（CI 满载并发 128 文件下 `findBy*`/`waitFor` 默认 1s 偶发超时，ImportModuleModal 曾连续 flake）。
- localStorage polyfill（内存实现 getItem/setItem/removeItem/clear/key/length）：vitest jsdom + Node 22 实验性 localStorage 不可用，zustand persist 测试（daemon/admin/session）依赖。
- matchMedia polyfill（matches:false + 全 no-op listener）：antd Modal/TreeSelect/Select 等响应式组件需要。
- ResizeObserver polyfill（no-op class）：antd Drawer 等需要；三者均为 `if (!globalThis.x)` 守卫式注入。

目录分布（枚举核实）：
- `src/lib/__tests__/` 23 个：admin/agent/api/client-path/daemon-audit/daemon-permission/daemon-session/daemon-usage/fetch-sse/format-token/mcp-tokens/menu-permissions/permission/ppm-workday/query-client/scan-docs-tree/token-refresh/use-agent-run-stream/use-agent-runs(.tsx)/use-daemon-machines/use-workspace-context/workspace-daemon-status/workspace-path。
- `src/lib/api/__tests__/` 1 个（llm-providers）；`src/lib/ppm/__tests__/` 2 个（aggregations/format）。
- `src/components/__tests__/` 26 个（admin 系/agent-log-viewer 系/agent-profile-form/change-file-tree/charts 系/workspace 系/top-bar 等）。
- `src/components/{agent-log,agent,agent-profile,daemon,sessions,workspace}/__tests__/` = 3/1/2/12/4/2 个。
- `src/app/**/*.test.tsx` 页面级 31 个（account/layout/runtimes 系/sessions/settings 系 mcp/providers/skills/ppm 组件/workspaces agent/agent-profiles 等）。
- scripts：`test` = `vitest run`（CI 用单次），`test:watch` = `vitest`。

## 关键逻辑
```
// 纯逻辑测试切 node（省 jsdom 启动）
environmentMatchGlobs: [
  ["src/lib/__tests__/{admin,api,client-path,...}.test.ts", "node"],   // 白名单精确匹配
  ["src/lib/{daemon,errors,workspace-binding,workspaces}.test.ts", "node"],
]
// 隔离策略：清计数不清实现
clearMocks: true   // restoreMocks=false：describe/beforeAll 级持久 spy 需保留实现
// setup polyfill 三件套均为守卫式
if (!globalThis.localStorage) { ...内存实现... }   // zustand persist 前置
```

## 注意事项
- **环境白名单是精确匹配**：新加 lib 纯逻辑测试要享 node 环境须手动进 environmentMatchGlobs；文件改名不同步就静默回 jsdom（只慢不红，难察觉）。反之，引入 DOM 依赖（renderHook / EventSource / document）的文件**不得**进白名单。
- localStorage / matchMedia / ResizeObserver 三个 polyfill 是 antd + zustand persist 测试的硬前置，移除即大面积红；扩展时保持 `if (!globalThis.x)` 守卫，别覆盖 jsdom 未来原生实现。
- 持久 spy 惯例（describe/beforeAll 级 mock）与 restoreMocks 互斥；未来要开 restoreMocks 须先把这批 spy 下沉到 beforeEach（独立重构，workspace-access-guide / layout / interactive-session-panel 等都受影响）。
- 摆放约定：组件测试放组件目录 `__tests__/`；lib 纯逻辑优先 `src/lib/__tests__/` 并评估进白名单；同层 colocated 仅限既有 5 个文件，别新增扩散。
- asyncUtilTimeout=5000 与 testTimeout=15000 是「放宽上限不掩盖逻辑错误」的取舍（通过仍毫秒级），遇超时先怀疑真挂/环境慢，别先改阈值。
- 页面级测试较旧卡时代已显著增多（约 30 个 page.test.tsx，覆盖 runtimes/sessions/providers/skills/agent 等），但整体重心仍是 lib 层与组件单测。

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
