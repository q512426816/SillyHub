---
schema_version: 1
doc_type: module-card
module_id: stores-kanban
author: qinyi
created_at: 2026-08-18 01:45:00
---

# 看板筛选状态 store（stores-kanban）

## 定位
PPM 看板的筛选状态与数据获取 store（`frontend/src/stores/kanban.ts`，178 行，zustand **非 persist**）。集中管理人员列（users）、任务卡片（tasks）、筛选条件（filters）与加载态，桥接 `lib-ppm`（ppm/kanban.ts 的 6 个 API）与 `app-ppm-pages` 的看板页（/ppm/kanban）。由源项目 dept_project_front 的 Pinia store（store/modules/ppm.ts）迁移而来：源顶部人员筛选 `selectedUserIds` 语义并入 `filters.user_ids`（SearchBar 多选人员 → 过滤可见列）。

## 契约摘要
- `useKanbanStore` — `create<KanbanState>((set, get) => ...)`。
- `KanbanFilters`：`{ user_ids?: string[]; status?: string; project_id?: string; keyword?: string; group_by_org?: boolean; start_date?: string; end_date?: string }`（start/end 为 YYYY-MM-DD，按 deadline 过滤，end 含当天）。
- state：`users: KanbanUserColumn[]`（只存平铺）、`tasks: KanbanTaskCard[]`、`filters: KanbanFilters`、`loading: boolean`。
- 动作：
  - `fetchUsers(): Promise<KanbanUserColumn[]>` — 按当前 filters 拉人员列（组织分组结果拍平），失败 message.error + 重抛。
  - `fetchTasks(): Promise<KanbanTaskCard[]>` — 按当前 filters 直取六字段拉任务，失败同上。
  - `assignTask(req: KanbanTaskAssignReq)` — 跨列拖拽（API 成功后自动刷 tasks+users）。
  - `reorderTasks(req: KanbanTaskReorderReq)` — 同列拖拽排序（失败 message.error + 重抛；成功后刷 tasks）。
  - `createTask(req: KanbanTaskCreateReq)` / `deleteTask(taskId)` — 任务 CRUD（成功后刷 tasks+users）。
  - `setFilters(partial)` — 浅合并；`resetFilters()` — 置 {}；`reset()` — 清全部四字段。
- 依赖：`lib-ppm/kanban`（assignKanbanTask/createKanbanTask/deleteKanbanTask/listKanbanTasks/listKanbanUsers/reorderKanbanTasks）、`lib-errors` 的 `errMessage`、antd `message`。

## 关键逻辑
```
toQuery(f): KanbanFilters → KanbanQueryReq     // undefined 字段省略; user_ids 仅 length>0 时填
fetchUsers():
  resp = listKanbanUsers(toQuery(get().filters))
  users = flattenUsers(resp); set({ users }); return users
flattenUsers(resp):
  首元素含 members 字段 → resp 视为 OrgGroup[], flatMap(g => g.members) 拍平
  否则已是 KanbanUserColumn[] 直接返回
fetchTasks(): listKanbanTasks({user_ids, status, project_id, keyword, start_date, end_date})
assign/reorder/create/delete: await API → 成功后 get().fetchTasks() (+ fetchTasks&fetchUsers 双刷)
setFilters(partial): set(s => ({ filters: { ...s.filters, ...partial } }))
```

## 注意事项
- **store 只存平铺 `KanbanUserColumn[]`**：`group_by_org=true` 时后端按组织分组返回，由 `flattenUsers` 拍平；分组展示逻辑由 UI 层自行处理，store 不保留分组结构。
- **任务动作成功后的刷新在 store 内部完成**（assign/create/delete 刷 users+tasks 双列表，reorder 只刷 tasks），调用方无需再补刷——与旧版「调用方注意补刷」的约定已不同。
- 失败路径刻意「提示 + 重抛」：`message.error(errMessage(err, "加载人员列表失败"/"加载任务列表失败"/"任务排序失败"))` 后 throw——排序失败若不提示，用户会以为已保存；调用方可选做进一步处理。
- store 层直接弹 antd message 全局提示是本 store 的既定取舍（数据获取型 store 自带用户反馈），新增动作沿用。
- `flattenUsers` 用「首元素是否含 members 字段」做结构嗅探（`Array.isArray` 双保险），是鸭子类型判定，后端若改分组结构需同步。
- 非 persist：刷新页面筛选丢失，符合看板临时筛选预期；`reset()` 清 users+tasks+filters+loading 四字段。
- `fetchUsers` 与 `fetchTasks` 共用单个 `loading` 布尔：并发调用时 finally 时序互相覆盖（当前页面为串行调用模式未踩坑，改并发前先拆 loading）。
- `filters.user_ids` 空数组与 undefined 语义不同（toQuery 只在 length>0 填），清空筛选应删键而非置 []。

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
