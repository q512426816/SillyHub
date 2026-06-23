---
schema_version: 1
doc_type: module-card
module_id: frontend_stores
source_commit: ba87eec
author: qinyi
created_at: 2026-06-24T01:16:36
---
# frontend_stores

## 定位
SillyHub 前端全局客户端状态层（Zustand）。当前承载两个 store：session（认证状态持久化，是全站认证守卫与 API token 注入的数据源）、kanban（ppm 看板的筛选/数据缓存）。是前端跨组件共享状态的「单一源」，与后端无直接契约，但 session store 驱动整个前端认证流。

产品视角：session store 是前端认证的「心脏」——登录后 token 与用户信息存于此（持久化到 localStorage），layout 守卫读它判断登录态，apiFetch 读它注入 token，登出时 clear 清空。kanban store 是 ppm 看板页的本地缓存，隔离筛选条件与加载态。两个 store 按域隔离，session 全局持久、kanban 页面级临时。

## 契约摘要
- `stores/session.ts`：`useSession` / `SessionUser` / `SessionTokens`
  - State：`hydrated` / `user` / `accessToken` / `refreshToken`
  - Actions：`setUser` / `setTokens` / `clear` / `markHydrated`
- `stores/kanban.ts`：`useKanbanStore` / `KanbanFilters`
  - State：`users` / `tasks` / `filters`（KanbanFilters）/ `loading`
  - Actions：`fetchUsers`（listKanbanUsers）/ `fetchTasks`（listKanbanTasks）/ `refreshAll`（Promise.all）/ `updateFilters`（partial）/ `resetFilters` / `reset`
- 持久化：Zustand `persist` 中间件 → localStorage（session key: `multi-agent-platform.session`，version 1，partialize={hydrated,user,accessToken,refreshToken}）
- 依赖：`frontend_lib`（kanban 调 listKanbanUsers/listKanbanTasks）；被 `frontend_app`（认证守卫）/ `frontend_components` / `frontend_lib`（apiFetch 读 token）使用
- 跨组件协作：session store 是全站认证数据源，驱动 layout 守卫与 apiFetch token 注入；kanban store 隔离 ppm 看板状态

## 关键逻辑
session 持久化与守卫：
```
persist(partialize={hydrated,user,accessToken,refreshToken},
        onRehydrateStorage → markHydrated())
// 守卫: if (!hydrated) return null; if (!accessToken) redirect /login
```
kanban 筛选驱动查询：
```
fetchUsers: listKanbanUsers(toQuery(filters)) → set users
fetchTasks: listKanbanTasks(toQuery(filters)) → set tasks
updateFilters(partial) → set filters（不自动查，由调用方触发 refreshAll）
```
- session partialize 控制 localStorage 持久化字段
- kanban updateFilters 只改 state 不自动查，调用方需显式 refreshAll / fetchTasks

### Kanban Store 详情
`useKanbanStore` 管理 ppm 看板页状态：
- KanbanFilters：筛选条件（人员/项目/日期范围等）
- fetchUsers/fetchTasks 各设 loading 态，try/finally 保证重置
- toQuery(filters) 把 filters 序列化为 query 参数传后端
- refreshAll = Promise.all([fetchTasks, fetchUsers]) 并行刷新
- reset 清空 users/tasks/filters/loading，切页时调用

## 注意事项
- `accessToken` 存 localStorage 有 XSS 风险，生产宜改 HttpOnly Cookie
- `hydrated` 也被持久化，但真正完成由 `onRehydrateStorage` 回调控制
- kanban store 的 updateFilters 只改 state 不自动查，需调用方显式 refreshAll
- session store 是 apiFetch 读取 token 的唯一数据源，clear() 必须清全部敏感字段
- 目前两个 store，随功能增长可扩展（如 workspace 上下文 store）
- session persist key 带 namespace 避免与其他应用 localStorage 冲突
- actions 内嵌 state 是 Zustand 标准 pattern，无需额外 reducer
- kanban store 的 fetchUsers/fetchTasks 各自管理 loading 态，调用方注意竞态
- 登出 clear() 后 layout 守卫立即 redirect /login
- SessionUser 含 id/email/displayName，供顶栏与权限判断
- setTokens 同时存 access/refresh，apiFetch 读 access、401 时用 refresh
- kanban store 是页面级缓存，非全局持久（不进 localStorage）
- store 拆分按域：session（全局认证）vs kanban（ppm 页面），职责隔离
- partialize 精确控制持久字段，避免临时态落盘
- persist version=1，schema 变更需 bump 并做迁移
- kanban store 的 fetchTasks/fetchUsers 各自 try/finally 管 loading
- toQuery 把 KanbanFilters 序列化为后端 query 参数
- reset 清空全部看板状态，切页/卸载时调用防脏数据
- session 的 setUser 同时更新 user 与触发组件重渲染
- kanban 不持久化（无 persist），每次进页重新拉取
- store 按域隔离避免全局状态污染
- useSession 是 hook，组件内调用取响应式状态
- kanban store 的 tasks/users 是 TaskCardVO/UserColumnVO 类型
- updateFilters 合并 partial 到现有 filters
- session store 暴露 getState 供非组件（如 apiFetch）同步读

## 人工备注
<!-- MANUAL_NOTES_START -->
<!-- MANUAL_NOTES_END -->
