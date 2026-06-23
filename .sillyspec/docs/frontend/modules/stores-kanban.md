---
schema_version: 1
doc_type: module-card
module_id: stores-kanban
source_commit: ba87eec
author: qinyi
created_at: 2026-06-24T01:02:04
---
# stores-kanban

## 定位
PPM 看板的筛选状态与数据获取 store（zustand，非 persist）。集中管理看板的人员列、任务卡片、筛选条件，并提供按筛选拉取、分配/排序/创建/删除任务、重置等动作。桥接 `lib-ppm`（kanban.ts）的 API 与 `app-ppm-pages` 的看板 UI。源自 Pinia store 迁移而来（顶部人员筛选原 `selectedUserIds` 对应当前 `filters.user_ids`）。

## 契约摘要
- `useKanbanStore` — zustand store hook（`create<KanbanState>((set,get) => ...)`）。
- `KanbanFilters`：`{ user_ids?: string[], status?, project_id?, keyword?, group_by_org?, start_date?, end_date? }`（start/end 为 YYYY-MM-DD，按 deadline 过滤，含当天）。
- state 字段：`users: KanbanUserColumn[]`、`tasks: KanbanTaskCard[]`、`filters: KanbanFilters`、`loading: boolean`。
- 动作：`fetchUsers()` / `fetchTasks()`（按当前 filters 拉）、`assignTask(req)` / `reorderTasks(req)` / `createTask(req)` / `deleteTask(taskId)`、`setFilters(partial)` / `resetFilters()` / `reset()`（清空 users+tasks+filters）。

## 关键逻辑
筛选映射 + 分组拍平（内部 helper）：
```
toQuery(f): KanbanFilters → KanbanQueryReq   // undefined 字段省略，只填有值项
fetchUsers():
  resp = listKanbanUsers(toQuery(get().filters))
  users = flattenUsers(resp)                  // OrgGroup[].members 拍平成平铺列
  set({ users })
fetchTasks():
  resp = listKanbanTasks(toQuery(get().filters))
  set({ tasks: resp })
setFilters(partial): set(s => ({ filters: { ...s.filters, ...partial } }))
flattenUsers(resp): 首元素含 members → 按 group 拍平；否则已是平铺列直接返回
```

## 注意事项
- **store 只存平铺 `KanbanUserColumn[]`**：后端按组织分组返回时（`group_by_org`）由 `flattenUsers` 拍平，分组展示逻辑由 UI 自行处理，store 不保留分组结构。
- 顶部人员筛选 = `filters.user_ids`（非独立 selectedUserIds），与源 Pinia 不同。
- 各任务动作（assign/reorder/create/delete）成功后通常需 `fetchTasks()` 刷新列表以保持一致性，调用方注意补刷。
- 非 persist store：刷新页面筛选条件丢失，符合看板临时筛选预期。
- `filters` 数组字段（user_ids）空数组与 undefined 语义不同：`toQuery` 只在 `length>0` 时填。

## 人工备注
<!-- MANUAL_NOTES_START -->
<!-- MANUAL_NOTES_END -->
