---
schema_version: 1
doc_type: module-card
module_id: stores-workspace
author: qinyi
created_at: 2026-08-18 01:45:00
---

# 工作区上下文缓存 store（stores-workspace）

## 定位
当前工作区上下文缓存 store（`frontend/src/stores/workspace.ts`，44 行，zustand **非 persist**，源自 change 2026-07-09-workspace-prioritization task-01）。只存"用户正在看哪个工作区"的缓存值；**URL 才是真相源**，刷新后由 `lib-workspace-context` 的 useWorkspaceContext 从 URL 重建写入。与 stores-session 的关键差异：不包装 persist（localStorage 与 URL 派生状态不同步会闪烁/不一致）。

## 契约摘要
- `useWorkspaceStore` — `create<WorkspaceStore>()((set) => ...)`。
- `CurrentWorkspace`：`{ id, name, daemon_id: string | null, daemon_online: boolean, root_path?: string | null }`。
- state：`current: CurrentWorkspace | null`（初始 null）。
- 方法：`setCurrent(ws | null)`、`clear()`（重置为 null）。

## 关键逻辑
```
useWorkspaceStore = create((set) => ({
  current: null,
  setCurrent: (ws) => set({ current: ws }),
  clear: () => set({ current: null }),
}))
写入方: useWorkspaceContext effect(URL 变化最小填充) + 切换器/列表页(写完整 name)
```

## 注意事项
- 本 store 是**纯内存缓存**，无 persist / 无 selector 工厂；别在此追加派生逻辑，聚合类状态（daemon 在线）属 lib-workspace-context 的 statusMap。
- 写入有双来源约定：hook 只做最小填充（id + statusMap 反查 daemon 字段，name 留空），完整 name 由消费方用列表数据覆盖；hook 的 effect 有 id 一致的幂等保护，不会覆盖更完整的 current。
- 消费方：app-workspace-pages、app-layouts、components-shared（app-shell）、lib-workspace-context。
- 有 colocated 测试 `src/stores/workspace.test.ts`（改 store 行为先跑它）。

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
