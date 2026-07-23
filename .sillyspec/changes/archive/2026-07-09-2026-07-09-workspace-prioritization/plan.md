---
author: qinyi
created_at: 2026-07-09T23:05:00
plan_level: full
---

# 实现计划（Plan）— 工作区前置化

> 来源：`design.md`（方案 A 客户端守卫，5 Phase，scale: large）/ `tasks.md` / `requirements.md`（FR-01~06）
> 无 Spike 前置（技术方案确定，无未经验证集成；task-03 含对 `listDaemonInstances` 字段的轻量核实，就地完成不单列 Spike）
> task 编号按 Wave 物理顺序连续（task-01~10），与 CLI 解析/task-NN.md 文件名一致。

## Wave 1（地基 + 数据，并行无依赖）

- [x] task-01: 新建 `frontend/src/stores/workspace.ts` — 工作区上下文 zustand store（非 persist），`CurrentWorkspace` 类型 + `setCurrent`/`clear`（覆盖：FR-01, D-002）
- [x] task-02: 修改 `frontend/src/app/page.tsx` — 登录态 `redirect("/workspaces")`、未登录 `redirect("/login")`，删双入口标题页（覆盖：FR-03, D-001）
- [x] task-03: daemon online 聚合 — 新建 `frontend/src/lib/workspace-daemon-status.ts`，导出 `useDaemonStatusMap`（`fetchMyBindings` 批量 + `listDaemonInstances` 映射 daemon_id→online），核实 `listDaemonInstances` 字段含 online/last_seen（CB-4）（覆盖：FR-06, R-02）

## Wave 2（依赖 Wave 1，并行）

- [x] task-04: 新建 `frontend/src/lib/use-workspace-context.ts` — 组合 hook：`useWorkspaceId`（从 app-shell 提取/复用）+ 进入 ws 写 store + `switchWorkspace(targetId)`（解析 pathname 保留模块段、替换 wsId、截断子路径）（覆盖：FR-01, D-002）
- [x] task-05: 修改 `frontend/src/app/(dashboard)/layout.tsx` — 加工作区守卫 `useEffect`（同 useSession 层），无 wsId 且非白名单 → `router.replace("/workspaces")`；实现顺序先判 `/workspaces/:id` 再判白名单前缀（CB-3）（覆盖：FR-02, D-001, D-006）
- [x] task-06: 新建 `frontend/src/components/workspace-binding-dialog.tsx` — 容器化包裹现有 `WorkspaceAccessGuide`（CB-2，不重写表单），props `{workspaceId, open, onBound, onClose}`（覆盖：FR-05, D-003, CB-2）

## Wave 3（依赖 Wave 1+2，并行）

- [x] task-07: 修改 `frontend/src/app/(dashboard)/workspaces/page.tsx` — 列表页改造选择器：顶部后台旁路入口（D-001）+ daemon 状态徽标（消费 task-03）+ 空状态创建引导（D-004）+ 卡片点击区分已绑定（进）/未绑定（弹 task-06）（覆盖：FR-03, D-001, D-004）
- [x] task-08: 新建 `frontend/src/components/workspace-switcher.tsx` — 当前 ws 名 + daemon 徽标（消费 task-03）+ 下拉切同模块（task-04 switchWorkspace）+ 未绑定项触发 task-06 弹窗 + 平台页引导态（覆盖：FR-04, D-002, D-005）
- [x] task-09: 修改 `frontend/src/components/top-bar.tsx` — 左侧接入 `<WorkspaceSwitcher />`（依赖 task-08）（覆盖：FR-04）

## Wave 4（收尾，依赖全部）

- [x] task-10: 修改 `frontend/src/components/app-shell.tsx` — `useWorkspaceId` 复用 `use-workspace-context`、进入 ws 写 store；`resolveHref` 不变；全量前端测试回归（记忆：改 layout/router 必跑回归）（覆盖：FR-01, R-06）

## 任务总表

| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | 改动文件 |
|---|---|---|---|---|---|---|
| task-01 | stores/workspace.ts | W1 | P0 | — | FR-01, D-002 | 新增 stores/workspace.ts |
| task-02 | app/page.tsx 重定向 | W1 | P0 | — | FR-03, D-001 | 修改 app/page.tsx |
| task-03 | daemon online 聚合 | W1 | P0 | — | FR-06, R-02 | 新增 lib/workspace-daemon-status.ts |
| task-04 | use-workspace-context hook | W2 | P0 | task-01, task-03 | FR-01, D-002 | 新增 lib/use-workspace-context.ts |
| task-05 | dashboard layout 守卫 | W2 | P0 | — | FR-02, D-001, D-006 | 修改 (dashboard)/layout.tsx |
| task-06 | workspace-binding-dialog | W2 | P0 | — | FR-05, D-003, CB-2 | 新增 components/workspace-binding-dialog.tsx |
| task-07 | workspaces 选择器改造 | W3 | P0 | task-03, task-06 | FR-03, D-001, D-004 | 修改 (dashboard)/workspaces/page.tsx |
| task-08 | workspace-switcher | W3 | P0 | task-03, task-04, task-06 | FR-04, D-002, D-005 | 新增 components/workspace-switcher.tsx |
| task-09 | top-bar 接入 | W3 | P1 | task-08 | FR-04 | 修改 components/top-bar.tsx |
| task-10 | app-shell 接入+回归 | W4 | P0 | task-04 | FR-01, R-06 | 修改 components/app-shell.tsx |

## 关键路径

task-01 → task-04 → task-08 → task-09（最长路径，4 步，决定最短交付周期）

## 全局验收标准

- [ ] AC-1：登录后落 `/workspaces` 选择器，未选时侧边栏只露全局菜单
- [ ] AC-2：选择器有"平台管理/系统设置"后台旁路，可直接进不报错
- [ ] AC-3：顶栏切换器显示当前工作区名 + daemon 状态徽标
- [ ] AC-4：A/changes 切到 B 跳 B/changes（保留模块段）
- [ ] AC-5：未绑定 daemon 的工作区点开弹绑定弹窗，绑好才进
- [ ] AC-6：daemon 离线切换器标红不阻断进入
- [ ] AC-7：刷新/深链 `/workspaces/B/changes` 直接进不丢上下文
- [ ] 前端全量测试通过（`pnpm test` + `pnpm typecheck` + `pnpm lint`），零回归
- [ ] （brownfield）现有平台后台路由（`/admin` `/settings` `/ppm` `/runtimes`）不被守卫阻断；现有菜单灰显逻辑、详情页 `WorkspaceBindingGuard` 编辑入口保留
- [ ] URL 路径派生行为不变（深链/刷新零回归）

## 覆盖矩阵（D-xxx 决策）

| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001（统一强制+后台旁路） | task-02, task-05, task-07 | AC-1, AC-2 |
| D-002（切换跳同模块截断子路径） | task-01, task-04, task-08 | AC-4 |
| D-003（未绑定弹窗非内嵌） | task-06 | AC-5 |
| D-004（空状态创建引导） | task-07 | AC-1（空状态分支） |
| D-005（daemon 离线不阻断） | task-03, task-08 | AC-6 |
| D-006（方案 A 客户端守卫） | task-05 | AC-1, 兼容性条款 |
| CB-1（列表弹窗 vs Guard 分工） | task-06, task-07 | AC-5 + Guard 编辑入口保留 |
| CB-2（Dialog 容器化 AccessGuide） | task-06 | 代码复用 AccessGuide |
| CB-3（守卫先 wsId 后白名单） | task-05 | 守卫单测 |
| R-02（MemberBindingView 无 online） | task-03 | daemon 映射实现 |
