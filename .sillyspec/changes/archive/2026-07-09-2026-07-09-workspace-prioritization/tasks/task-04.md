---
id: task-04
title: 新建 frontend/src/lib/use-workspace-context.ts — 组合 hook：useWorkspaceId（从 app-shell 提取/复用）+ 进入 ws 写 store + switchWorkspace（切同模块）+ 暴露 current/daemonOnline
title_zh: 工作区上下文组合 hook + switchWorkspace
author: qinyi
created_at: 2026-07-09 23:10:00
priority: P0
depends_on: [task-01, task-03]
blocks: [task-08, task-10]
allowed_paths:
  - frontend/src/lib/use-workspace-context.ts
---

## 目标(goal)

提供统一的工作区上下文组合 hook，串联 URL 派生（真相源）、store 缓存（task-01）、daemon 在线聚合（task-03），并实现 `switchWorkspace` 切同模块路径替换（D-002）。供 `WorkspaceSwitcher`（task-08）与 `app-shell.tsx`（task-10）消费。

覆盖：FR-01（工作区为顶层会话）、D-002（切换跳同模块、保留首个模块段、截断子路径）。

## 实现(implementation)

新建 `frontend/src/lib/use-workspace-context.ts`，导出：

- `useWorkspaceContext()`：组合 hook，返回 `{ workspaceId, current, daemonOnline, switchWorkspace }`
  - `workspaceId`：复用 app-shell `useWorkspaceId` 的正则解析逻辑（`pathname.match(/^\/workspaces\/([^/]+)/)?.[1] ?? null`，`app-shell.tsx:104-108`）。本任务在本文件内重新实现同名内部 hook（非 import，因 app-shell 未导出；task-10 接入时 app-shell 改为复用本文件导出）。
  - `current`：读 `useWorkspaceStore(s => s.current)`（task-01 `stores/workspace.ts`）。
  - `daemonOnline`：读 `useDaemonStatusMap()`（task-03 `workspace-daemon-status.ts`）后按 `current.daemon_id` 查 map；`current` 为 null 或 daemon_id 为 null 时为 `false`。
  - 进入 ws 写 store：`useEffect` 监听 `workspaceId` 变化，非 null 时调 `setCurrent`。**注意**：本任务只搭脚手架（写 store 的 effect 依赖 task-01 store 的 `setCurrent` + `CurrentWorkspace`），但写什么数据需列表查询（workspace name/daemon_id）。因列表数据源未在本任务 allowed_paths 内，effect 内只调 `setCurrent` 占位（如 `workspaceId` 存在且 `current?.id !== workspaceId` 时先不阻塞；真实数据填充由 task-08/task-10 消费方用 React Query 写入，或 task-10 接入时补）。**实现取舍**：effect 内若拿不到完整 `CurrentWorkspace` 对象则只保证 `current.id` 与 URL 一致的最小写法（`setCurrent({ id: workspaceId, name: '', daemon_id: null, daemon_online: false })`），数据完整化留给 task-08 切换器（切换时已有列表项）。
- `switchWorkspace(targetId: string)`：解析当前 `pathname`，按 D-002 规则构造新路径并 `router.push`：
  - 用 `usePathname()` 取当前路径，匹配 `^/workspaces/([^/]+)(/.*)?$`。
  - 替换 wsId 段为 `targetId`。
  - **保留首个模块段，截断子路径**（D-002）：
    - `/workspaces/A/changes` → `/workspaces/B/changes`
    - `/workspaces/A/changes/123` → `/workspaces/B/changes`（截断 `/123`）
    - `/workspaces/A` → `/workspaces/B`（无模块段）
    - `/workspaces/A/changes/123/edit` → `/workspaces/B/changes`（只留首个模块段）
  - 非 `/workspaces/*` 路径调用时降级为 `router.push('/workspaces/' + targetId)`（守卫兜底）。
  - 实现为纯函数（便于单测）：导出 `buildSwitchPath(pathname: string, targetId: string): string`，`switchWorkspace` 内部 `router.push(buildSwitchPath(...))`。

接口签名以 `design.md` §7（第 126-132 行 `useWorkspaceContext` + 第 105-109 行 `switchWorkspace` 注释）为准。

## provides

- `frontend/src/lib/use-workspace-context.ts`
- `useWorkspaceContext()`：返回 `{ workspaceId: string|null; current: CurrentWorkspace|null; daemonOnline: boolean; switchWorkspace: (id: string) => void }`
- `switchWorkspace(targetId: string): void`（基于 `buildSwitchPath` + `router.push`）
- `buildSwitchPath(pathname: string, targetId: string): string`（纯函数，D-002 路径替换，便于单测）

## expects_from

- **task-01**：`frontend/src/stores/workspace.ts` 的 `useWorkspaceStore`、`CurrentWorkspace` 类型、`setCurrent` setter
- **task-03**：`frontend/src/lib/workspace-daemon-status.ts` 的 `useDaemonStatusMap()`（返回 `daemon_id → online` 映射）

## 验收标准

- [ ] 文件 `frontend/src/lib/use-workspace-context.ts` 存在
- [ ] `useWorkspaceContext` 返回对象含全部 4 字段（workspaceId/current/daemonOnline/switchWorkspace）
- [ ] `workspaceId` 由 URL 正则派生（`/workspaces/([^/]+)`），与 app-shell 现有解析一致
- [ ] 进入 ws（workspaceId 非空且变化）时触发 `setCurrent` 写 store（task-01 store 可被 mock 验证）
- [ ] `daemonOnline` 由 `useDaemonStatusMap()` + `current.daemon_id` 聚合，无 current/无 daemon_id 时为 false
- [ ] `switchWorkspace` 调 `router.push(buildSwitchPath(...))`
- [ ] `buildSwitchPath` 纯函数单测覆盖 3 case：`A/changes→B/changes`、`A/changes/123→B/changes`、`A→B`（外加 `A/changes/123/edit→B/changes` 截断 case）

## 验证(verify)

```bash
cd frontend
pnpm test -- lib/use-workspace-context   # buildSwitchPath 路径替换 + setCurrent effect 单测
pnpm typecheck
```

## 约束(constraints)

- **URL 路径派生为真相源**：`workspaceId` 始终从 `usePathname` 解析，store 仅缓存（用户硬约束，刷新零回归）。
- `switchWorkspace` 必须截断子路径（D-002）：只保留首个模块段，避免目标 ws 无对应条目 404。
- 本任务不消费 React Query 列表数据（列表在 task-07/task-08 消费），写 store 的 effect 用最小 `CurrentWorkspace` 占位（id 一致即可），完整字段由 task-08 切换器填充。
- `useWorkspaceId` 逻辑本文件内重新实现（app-shell 未导出）；task-10 接入时 app-shell 改为 import 本文件导出，消除重复。
- 仅改 `frontend/src/lib/use-workspace-context.ts` 一个文件（allowed_paths）。
