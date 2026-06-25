---
id: task-10
title: 运行并修正 frontend 类型检查、lint 与相关测试
priority: P1
estimated_hours: 3
depends_on: [task-06, task-07, task-08]
blocks: [task-11]
requirement_ids: [FR-03, FR-04, FR-05, FR-06]
decision_ids: [D-004@v1, D-006@v1]
allowed_paths:
  - frontend/src/lib/daemon.ts
  - frontend/src/lib/workspaces.ts
  - "frontend/src/lib/daemon.test.ts"
  - "frontend/src/lib/__tests__/**"
  - "frontend/src/app/(dashboard)/runtimes/**"
  - "frontend/src/app/(dashboard)/workspaces/**"
  - frontend/src/components/workspace-card.tsx
  - "frontend/src/components/__tests__/**"
  - .sillyspec/changes/2026-06-25-admin-global-daemon-workspace-management/tasks/task-10.md
author: qinyi
created_at: "2026-06-25 18:10:00"
---

# task-10: 运行并修正 frontend 类型检查、lint 与相关测试

> 本 task 在 task-06/07/08 实现落地后，集中跑 frontend 类型检查、lint 与相关 vitest，把 task-02 的 checkpoint 全部转绿并修正回归。

## 修改文件

| 操作 | 路径 | 说明 |
|---|---|---|
| 可能修改 | `frontend/src/lib/daemon.ts`、`frontend/src/lib/workspaces.ts` | 仅修正 task-06 引入、由类型/lint/测试暴露的真实缺陷。 |
| 可能修改 | `frontend/src/app/(dashboard)/runtimes/**`、`workspaces/**`、`components/workspace-card.tsx` | 仅修正 task-07/08 引入的缺陷或同步测试 mock。 |
| 可能修改 | 各 `__tests__/**`、`*.test.tsx` | 把 task-02 的 `it.todo` checkpoint 转可执行并跑绿；修正因结构变化失败的既有测试。 |
| 修改 | 本 task 文件 | 记录运行结果与修正点。 |

## 覆盖来源

| 来源 | 本 task 落点 |
|---|---|
| FR-03/FR-04/FR-06 | client 契约测试、别名/分页/兼容测试通过。 |
| FR-05 | 页面筛选条/分页器/人员搜索交互测试通过。 |
| D-004@v1 | 服务端分页与卡片样式相关断言通过。 |
| D-006@v1 | 嵌套 owner 类型与展示断言通过。 |

## 实现要求

1. 读 `local.yaml` 确认前端命令（`cd frontend && pnpm test`、`pnpm lint`、`pnpm build` 或 `tsc --noEmit`）。
2. 优先跑本变更相关测试：
   ```bash
   cd frontend && pnpm exec vitest run \
     src/lib/daemon.test.ts \
     src/lib/__tests__/workspaces-client.test.ts \
     "src/app/(dashboard)/runtimes" \
     "src/app/(dashboard)/workspaces" \
     src/components/__tests__
   ```
3. 再跑类型检查与 lint：
   ```bash
   cd frontend && pnpm lint
   cd frontend && pnpm exec tsc --noEmit   # 或 pnpm build 的类型阶段
   ```
4. 对 task-02 的所有 `it.todo` checkpoint：必须转为可执行测试并跑绿；若某项因实现取舍无法落地，必须在 task 文件记录未实现范围与残余风险（不得静默保留 todo）。
5. 失败归因：
   - client/页面/组件实现缺陷 → 在对应 allowed_paths 内修正。
   - 测试 mock 过期（如仍 mock `listDaemonRuntimes` 而页面已用 `listDaemonRuntimesPage`）→ 同步 mock，不降低断言。
   - 类型缺失（`display_alias`/`owner` 未在 `DaemonRuntimeRead`/`Workspace` 上声明）→ 回 task-06 补类型。
6. 关注 apiFetch query 序列化：`offset=0` 必须出现在 query（task-06 边界）；`null`/`undefined`/空串被正确省略。
7. 关注 antd `App.useApp()` 使用处必须有上层 `<AntApp>`（参考 runtimes page 现状）；测试里沿用现有 `<AntApp>` wrapper 模式。
8. 关注 `useSession` selector：测试用 `useSession.setState({ user: { is_platform_admin: true/false } })` 驱动人员搜索显隐（参考 task-02 约定）。
9. 记录：命令、通过/失败数、`it.todo` 转换情况、关键修正点、残余风险（如某项需真实浏览器手工验收）。

## 接口定义

本 task 无新接口，只运行验证命令。

## 边界处理

1. **`it.todo` 收口**：task-02 所有 checkpoint 必须转可执行并绿，否则记录未实现范围。
2. **mock 过期**：页面数据源迁移后，测试 mock 必须同步到 `listDaemonRuntimesPage`/`listWorkspaces(params)`。
3. **类型严格**：strict 模式下 `owner?.email/display_name` 必须用 optional chaining；不引入 `any` 绕过。
4. **既有回归**：daemon usage 测试、session dialog 测试、workspace-daemon-switcher 测试若被本变更破坏，必须修复。
5. **不降低断言凑过**：遵守 CLAUDE.md 规则 8。
6. **可访问名**：筛选/分页控件使用中文 `aria-label`（task-02 约定），测试用 `getByRole`/`getByLabelText` 定位，不依赖 Tailwind class。
7. **apiFetch query 边界**：`offset=0`/`limit` 保留，空值省略。
8. **环境缺失**：若 `pnpm build`/Playwright 无法运行，记录原因并标注需手工验收项。
9. **范围控制**：修正只落在本变更前端文件；不重构无关组件。

## 非目标

- 不新增页面/组件/client 实现（task-06/07/08 提供）。
- 不修改后端、daemon 客户端。
- 不做 Playwright/真实浏览器截图（如需，记录为手工验收项）。
- 不重构现有 usage 统计、session dialog、scan dialog 测试。
- 不把 `window.confirm` 强制改 antd modal（非本变更目标）。

## 参考

- `.sillyspec/changes/2026-06-25-admin-global-daemon-workspace-management/tasks/task-02.md`（checkpoint 名称、`it.todo` 收口约定）。
- `.sillyspec/changes/2026-06-25-admin-global-daemon-workspace-management/tasks/task-06.md`、`task-07.md`、`task-08.md`。
- `.sillyspec/local.yaml`（frontend 命令）。
- `.sillyspec/docs/frontend/scan/CONVENTIONS.md`、`ARCHITECTURE.md`、相关 modules 文档。
- 现有测试：`src/lib/daemon.test.ts`、`src/lib/__tests__/admin.test.ts`、`src/app/(dashboard)/runtimes/page.test.tsx`、`src/components/__tests__/workspace-daemon-switcher.test.tsx`。

## TDD 步骤

1. 跑本变更相关 vitest，记录红绿。
2. 把 task-02 `it.todo` 全部转可执行。
3. 跑 lint + tsc。
4. 按归因修正实现/类型/mock。
5. 重跑直到相关测试 + 类型 + lint 全绿；残余手工验收项列明。
6. 交 task-11 做 verify 前自检。

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | 本变更相关 vitest | client 契约、runtimes、workspaces、workspace-card 测试全绿。 |
| AC-02 | task-02 checkpoint | 全部从 `it.todo` 转可执行并绿；未转项有明确残余风险记录。 |
| AC-03 | `pnpm lint` | 本变更文件无新增 lint 错误。 |
| AC-04 | `tsc --noEmit`/`pnpm build` 类型阶段 | 无类型错误；`display_alias`/`owner` 类型与 task-06 契约一致。 |
| AC-05 | apiFetch query 断言 | `offset=0`/`limit` 保留，空值省略，`user_id` 仅平台管理员携带。 |
| AC-06 | 既有测试回归 | usage/session/switcher 等既有前端测试无回归。 |
| AC-07 | 失败归因记录 | 命令、红绿、修正点、残余风险写入 task 文件。 |
