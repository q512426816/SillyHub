---
author: qinyi
created_at: 2026-07-09T22:48:00
---

# 任务清单（Tasks）— 工作区前置化

> brainstorm 阶段高层任务骨架（按 design.md 5 Phase），plan 阶段拆 Wave + 细化依赖/验收。

## P1: 工作区上下文 store（地基）

- **task-01**: 新建 `frontend/src/stores/workspace.ts` — zustand store（非 persist），`CurrentWorkspace` 类型 + `setCurrent`/`clear`。
- **task-02**: 新建 `frontend/src/lib/use-workspace-context.ts` — 组合 hook：`useWorkspaceId`（从 app-shell 提取/复用）+ 进入 ws 写 store + `switchWorkspace(targetId)`（解析 pathname 保留模块段，替换 wsId，截断子路径）。
  - 单测：switchWorkspace 路径替换（`A/changes→B/changes`、`A/changes/123→B/changes`、`A→B`）。

## P2: 守卫 + 落地页（核心）

- **task-03**: 修改 `frontend/src/app/(dashboard)/layout.tsx` — 加工作区守卫 `useEffect`（同 useSession 层），无 wsId 且非白名单 → `router.replace("/workspaces")`；实现顺序先 wsId 后白名单前缀（CB-3）。
  - 单测：守卫白名单覆盖、`/workspaces/:id` 放行、平台路由放行。
- **task-04**: 修改 `frontend/src/app/page.tsx` — 登录态 `redirect("/workspaces")`，未登录 `redirect("/login")`。
- **task-05**: 修改 `frontend/src/app/(dashboard)/workspaces/page.tsx` — 列表页改造选择器：顶部后台旁路入口（D-001）、daemon 状态徽标强化、空状态创建引导（D-004）、卡片点击区分已绑定（进）/未绑定（弹窗）。

## P3: 顶栏切换器（核心）

- **task-06**: 新建 `frontend/src/components/workspace-switcher.tsx` — 当前 ws 名 + daemon 徽标 + 下拉（最近优先，每项 daemon 状态）+ 切同模块 + 未绑定项触发弹窗 + 平台页引导态。
- **task-07**: 修改 `frontend/src/components/top-bar.tsx` — 接入 `<WorkspaceSwitcher />`。

## P4: daemon 绑定弹窗（核心）

- **task-08**: 新建 `frontend/src/components/workspace-binding-dialog.tsx` — 容器化包裹 `WorkspaceAccessGuide`（CB-2，不重写表单），props `{workspaceId, open, onBound, onClose}`；选择器/切换器未绑定项点击触发。
  - 确认：详情页 `WorkspaceBindingGuard` 保留为编辑入口（CB-1），不删除。

## P5: daemon 状态接入 + 收尾（渐进）

- **task-09**: daemon online 聚合 — `fetchMyBindings` + `listDaemonInstances` 映射 daemon_id→online，切换器/store 消费（R-02）。核实 `listDaemonInstances` 返回字段含 online/last_seen（CB-4 对齐判定标准）。
- **task-10**: 修改 `frontend/src/components/app-shell.tsx` — `useWorkspaceId` 复用 `use-workspace-context`，进入 ws 写 store；`resolveHref` 不变。全量前端测试回归（记忆：改 router/layout 必跑回归）。

## 待 plan 细化

- Wave 分组与依赖（P1 地基先行，P2/P3/P4 可并行，P5 收尾）
- 每个 task 的验收标准与测试用例
- 依赖 worktree/环境注意（记忆：worktree 缺 .env/node_modules 等）
