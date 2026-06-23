---
schema_version: 1
doc_type: module-card
module_id: lib-components
source_commit: ba87eec
author: qinyi
created_at: 2026-06-24T01:01:57+08:00
---
# lib-components

## 定位
组件（Component）API 兼容层（`frontend/src/lib/components.ts`，约 217 行）。后端重构后"组件"即子工作空间（`component_key !== null` 的 Workspace），本模块把旧的组件 API 调用重映射到当前 workspace 端点，让尚未完全迁移的页面继续可用。属过渡层。

## 契约摘要
- `listComponents(workspaceId): Promise<{ items: Component[]; total }>` — 列出某工作空间下的子工作空间（组件）。
- `getComponent(workspaceId, componentId): Promise<Component>` — 取单个组件（直接按 componentId 查 workspace）。
- `reparseComponents(workspaceId): Promise<ReparseResponse>` — 重扫并重建组件列表。
- `getTopology(workspaceId?): Promise<TopologyResponse>` — 全局拓扑（workspaceId 参数仅用于回填响应字段，实际不过滤）。
- 类型：`Component`（从 Workspace 映射，含 tech_stack/build_command/test_command 等）、`Relation`、`ReparseStats`/`ReparseResponse`、`TopologyNode/Edge/Response`。

## 关键逻辑
```
listComponents(workspaceId):
  [ws, resp] = Promise.all([ GET /api/workspaces/{id}, GET /api/workspaces ])
  prefix = ws.root_path + "/"
  items = resp.items.filter(w => w.root_path.startsWith(prefix) && w.id !== ws.id)
          .map(w => workspaceToComponent(w, workspaceId))  # 路径前缀判定父子关系
getComponent(_, componentId): GET /api/workspaces/{componentId} → workspaceToComponent
reparseComponents(workspaceId): POST .../rescan → 再 listComponents 填充返回（stats 全 0 占位）
getTopology(_): GET /api/workspaces/topology → 映射 nodes/edges 到旧 TopologyResponse 形状
```

## 注意事项
- 过渡层：新代码应直接用 `lib-workspaces` 接口，本模块未来可能移除；类型与 `lib-workspaces` 有重叠。
- 父子组件判定靠 `root_path` 前缀匹配（`父路径 + "/"`），而非显式 parent_id 字段，依赖路径命名约定。
- `reparseComponents` 返回的 stats 全为 0 占位（后端 rescan 不返回细粒度统计），真实组件列表靠再次 listComponents 填充。
- `getTopology` 的 `workspaceId` 参数仅回填响应字段、不参与过滤，拓扑始终是全局的。
- `Component.status` 可能为 `"path_missing"` 等非 active 值，UI 需兼容。

## 人工备注
<!-- MANUAL_NOTES_START -->
<!-- MANUAL_NOTES_END -->
