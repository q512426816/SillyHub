---
schema_version: 1
doc_type: module-card
module_id: frontend_stores
author: qinyi
created_at: 2026-08-18 01:45:00
---

# 前端全局状态层（frontend_stores）

## 定位
SillyHub 前端全局客户端状态层（frontend/src/stores/**，Zustand）。三个 store 按域隔离：session（认证持久化，全站守卫与 token 注入的唯一数据源）、workspace（当前工作区上下文内存缓存）、kanban（ppm 看板页状态，对齐源项目 Pinia 语义）。与后端无直接契约，取数统一走 frontend_lib。

## 契约摘要
- `stores/session.ts`：`useSession`
  - State：`hydrated` / `user: SessionUser | null` / `accessToken` / `refreshToken`
  - `SessionUser`：id / email / displayName / `is_platform_admin?` / `permissions?: string[]`（权限渲染与菜单过滤用）
  - Actions：`setUser` / `setTokens` / `clear` / `markHydrated`
  - persist → localStorage，key `multi-agent-platform.session`，version 1，partialize 四字段，`onRehydrateStorage` 回调 `markHydrated()` 让守卫判定确定化
- `stores/workspace.ts`：`useWorkspaceStore`（**非 persist**）
  - State：`current: CurrentWorkspace | null`（id / name / `daemon_id` / `daemon_online` / `root_path?`）
  - Actions：`setCurrent` / `clear`
  - 定位是缓存：URL 才是真相源，刷新后由 `lib/use-workspace-context` 从 URL 重建
- `stores/kanban.ts`：`useKanbanStore`
  - State：`users`（KanbanUserColumn[]）/ `tasks`（KanbanTaskCard[]）/ `filters: KanbanFilters`（user_ids / status / project_id / keyword / group_by_org / start_date / end_date）/ `loading`
  - Actions：`fetchUsers` / `fetchTasks`（按 filters 调 lib/ppm/kanban）、`assignTask`（跨列拖拽）/ `reorderTasks`（同列拖拽，成功后刷新）、`createTask` / `deleteTask`、`setFilters` / `resetFilters` / `reset`
- 被 frontend_app（登录守卫读 session）、frontend_components（会话/菜单/看板）、frontend_lib（apiFetch 读 token）消费。

## 关键逻辑
```
session: persist(partialize={hydrated,user,accessToken,refreshToken})
  → onRehydrateStorage → markHydrated()
  → 守卫: !hydrated return null; !accessToken → /login
workspace: setCurrent(ws) 纯内存，clear() 重置；URL 变 → use-workspace-context 重写
kanban: fetchUsers/fetchTasks 按 toQuery(filters) 拉取；拖拽 action = API + 成功刷新
```

## 注意事项
- workspace store 刻意不用 persist：localStorage 与 URL 派生状态不同步会闪烁/不一致（文件头设计依据）。
- `accessToken` 存 localStorage 有 XSS 面，生产硬化项（HttpOnly Cookie），当前已知取舍。
- session persist version=1，schema 变更需 bump 并写迁移。
- apiFetch 通过 `useSession.getState()` 非组件同步读 token——session 是唯一 token 源，`clear()` 必须清全部敏感字段。
- kanban 的 setFilters 只改 state 不自动拉取，调用方需显式 fetchUsers/fetchTasks；写操作（assign/reorder/create/delete）自带成功后刷新。
- kanban 源语义对齐 dept_project_front 的 Pinia store（fetchUsers/fetchTasks/拖拽），改动前先对照源行为。

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
