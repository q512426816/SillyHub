---
schema_version: 1
doc_type: module-card
module_id: test-utils
source_commit: ba87eec
author: qinyi
created_at: 2026-06-24T01:02:04
---
# test-utils

## 定位
前端单元测试基础设施与测试用例集合。基于 Vitest + jsdom + @testing-library/react，覆盖 `lib` 层（API client、纯函数）与部分组件层（admin/daemon/charts/shared）。提供全局 setup（jest-dom 断言、localStorage polyfill）、Vitest 配置（环境/别名/globals），以及分散在 `__tests__` 目录下的约 36 个 `.test.ts(x)` 文件。

## 契约摘要
- 配置：`vitest.config.ts` — `environment: jsdom`、`globals: true`、`setupFiles: ["./src/test/setup.ts"]`、`css: false`、`@` 别名指向 `./src`、`@vitejs/plugin-react`。
- `src/test/setup.ts` — 全局 setup：引入 `@testing-library/jest-dom/vitest`；补 localStorage polyfill（vitest jsdom + Node 22 实验性 localStorage 不可用，daemon/admin 等测试经 zustand persist 依赖 localStorage）。
- 测试目录：
  - `src/lib/__tests__/` — lib 层：admin / agent / api / client-path / daemon-permission / daemon-session / format-token / menu-permissions / permission / ppm-workday / spec-workspaces / use-agent-run-stream / workspace-path。
  - `src/lib/ppm/__tests__/` — aggregations / format。
  - `src/components/__tests__/` — 组件层：admin-organization-tree / admin-role-permission-picker / admin-user-drawer / agent-log-viewer / agent-run-panel / logout-confirm-dialog / project-plan-cost-bar-chart / top-bar / work-hour-bar-chart / work-hour-pie-chart / workspace-daemon-switcher。
  - `src/components/daemon/__tests__/` — interactive-session-panel。
- npm scripts：`test` = `vitest run`、`test:watch` = `vitest`。
- tsconfig `types: ["vitest/globals", "@testing-library/jest-dom"]`，使 `describe/it/expect` 全局可用无需 import。

## 关键逻辑
```
// vitest.config.ts 关键项
test: { environment:"jsdom", globals:true, setupFiles:["./src/test/setup.ts"], css:false }
resolve.alias: { "@": path.resolve(__dirname, "./src") }

// setup.ts localStorage polyfill（节选）
if (!globalThis.localStorage) {
  // 实现 getItem/setItem/removeItem/clear/key/length 的内存 store
}
```

## 注意事项
- **测试集中在 lib 层**，页面与组件集成测试覆盖偏低（已知 concerns）；新增复杂组件应补 `__tests__`。
- localStorage polyfill 是 daemon/admin 测试前置依赖（zustand persist 持久化读 localStorage），移除会致相关测试报错。
- `globals: true` + tsconfig `vitest/globals` 类型：测试文件无需 import 断言 API，但 ESLint 可能告未定义，已通过 types 配置解决。
- 测试默认 `vitest run`（单次），CI 用此；本地迭代用 `test:watch`。
- daemon 测试涉及 SSE/EventSource，可能需 mock `EventSource`（参见 daemon-session.test 相关 mock 模式）。

## 人工备注
<!-- MANUAL_NOTES_START -->
<!-- MANUAL_NOTES_END -->
