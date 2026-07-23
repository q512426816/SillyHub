---
id: task-01
title: 新建 frontend/src/stores/workspace.ts — 工作区上下文 zustand store（非 persist），CurrentWorkspace 类型 + setCurrent/clear
title_zh: 工作区上下文缓存 store
author: qinyi
created_at: 2026-07-09 22:47:13
priority: P0
depends_on: []
blocks: [task-04]
allowed_paths:
  - frontend/src/stores/workspace.ts
---

## 目标(goal)

为工作区前置化提供客户端上下文缓存层。新建 `frontend/src/stores/workspace.ts`，缓存"当前工作区"对象（`CurrentWorkspace`），供顶栏切换器/侧边栏菜单状态/各模块消费。URL 路径仍是真相源，store 仅叠加缓存，刷新后由 `use-workspace-context`（task-04）从 URL 重建。

覆盖：FR-01（工作区为顶层会话）、D-002（切换跳同模块截断子路径，本任务只提供 store 字段，switchWorkspace 在 task-04）。

## 实现(implementation)

新建 `frontend/src/stores/workspace.ts`，参照现有 `frontend/src/stores/session.ts`（同用 `zustand` `create`），但**关键差异：本 store 不用 `persist` 中间件**（用户硬约束，避免 URL 与 localStorage 状态不同步；刷新由 use-workspace-context 重建）。

导出：
- 类型 `CurrentWorkspace`：`{ id: string; name: string; daemon_id: string | null; daemon_online: boolean; root_path?: string | null }`
- 类型 `WorkspaceStore`：`{ current: CurrentWorkspace | null; setCurrent: (ws: CurrentWorkspace | null) => void; clear: () => void }`
- `useWorkspaceStore` hook（`create<WorkspaceStore>()((set) => ({ current: null, setCurrent: (ws) => set({ current: ws }), clear: () => set({ current: null }) }))`，无 persist 包装）

接口签名以 `design.md` §7 的 `CurrentWorkspace`/`WorkspaceStore` 定义为准。

## provides

- `frontend/src/stores/workspace.ts`：`useWorkspaceStore`、`CurrentWorkspace` 类型、`WorkspaceStore` 类型
- `CurrentWorkspace` 字段：`id`、`name`、`daemon_id`(string|null)、`daemon_online`(boolean)、`root_path?`(string|null)
- `current` 字段（初始 null）
- `setCurrent(ws: CurrentWorkspace | null)` setter
- `clear()` 重置为 null

## expects_from

（无 —— Wave 1 地基，无前置依赖）

## 验收标准

- [ ] 文件 `frontend/src/stores/workspace.ts` 存在
- [ ] `CurrentWorkspace` 类型含全部 5 个字段（id/name/daemon_id/daemon_online/root_path?）
- [ ] `setCurrent` / `clear` / `current` 可被外部消费
- [ ] store **未**使用 `persist`（无 `import { persist }`，无 `name`/`partialize` 配置）
- [ ] 初始 `current === null`
- [ ] 新增 store 单测：覆盖 setCurrent 写入 / clear 清空 / 初始 null

## 验证(verify)

```bash
cd frontend
pnpm test -- stores/workspace   # 新增 store 单测
pnpm typecheck
```

## 约束(constraints)

- **非 persist**（用户硬约束）：随 URL，刷新从 use-workspace-context 重建，避免 localStorage 与 URL 派生状态不同步。
- `switchWorkspace` 不在本任务实现（需 router，放 task-04 的 `lib/use-workspace-context.ts`）。
- `daemon_online` 字段在本任务只定义类型与占位，聚合数据源由 task-03（`workspace-daemon-status.ts`）提供，写入时机由 task-04 控制。
- 仅改 `frontend/src/stores/workspace.ts` 一个文件（allowed_paths）。
