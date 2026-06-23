---
schema_version: 1
doc_type: module-card
module_id: lib-workspaces
source_commit: ba87eec
author: qinyi
created_at: 2026-06-24T01:01:57+08:00
---
# lib-workspaces

## 定位
工作空间领域 API 客户端（`frontend/src/lib/workspaces.ts`，约 253 行）。封装工作空间的扫描、创建/更新/删除、激活、重解析，以及组件关联关系与全局拓扑。是工作空间页面与组件模块的数据来源，类型镜像后端 `workspace/schema.py`。

## 契约摘要
- 扫描：`scanWorkspace(rootPath)` 探测目录结构与 is_sillyspec；`scanGenerate(rootPath, input)` 生成 sillyspec 骨架；`rescanWorkspace(id)` 重扫；`reparseWorkspace(id)` 重解析返回统计。
- CRUD：`listWorkspaces()`、`getWorkspace(id)`、`createWorkspace(input)`、`updateWorkspace(id, input)`、`deleteWorkspace(id)`。
- 激活：`activateWorkspace(id)`。
- 关联：`getWorkspaceRelations(id)`、`createRelation(id, input)`、`deleteRelation(id, relationId)`。
- 拓扑：`getTopology()` 全局拓扑（节点+边）。
- 关键类型：`Workspace`（含 `path_source` 路径来源、`component_key` 组件标识、`daemon_runtime_id`、`default_agent` 等）、`WorkspaceStructure`、`ScanResult`、`WorkspaceRelation`、`TopologyNode/Edge/Response`。

## 关键逻辑
```
scanWorkspace(rootPath): GET /api/workspaces/scan?root_path=  → ScanResult{ is_sillyspec, structure, warnings }
createWorkspace(input): POST /api/workspaces  → Workspace
updateWorkspace(id, input): PATCH /api/workspaces/{id}  # default_agent: null=清空, 省略=不变(对齐 exclude_unset)
reparseWorkspace(id): POST /api/workspaces/{id}/reparse → { parsed, created, updated, deleted, ... }
getTopology(): GET /api/workspaces/topology → { nodes, edges }  # 全局，非单工作空间
```

## 注意事项
- `Workspace.path_source` 区分 `"server-local"`（服务端本地路径）与 `"daemon-client"`（daemon 客户端机器路径），影响路径展示与目录浏览方式（`DaemonDirBrowser`）。
- `component_key !== null` 的子工作空间即"组件"（components），`lib-components` 模块正是基于此做兼容映射。
- `updateWorkspace` 的 PATCH 语义：`default_agent` 传 null 显式清空、字段省略表示不变，依赖后端 `exclude_unset` 行为。
- `scanGenerate` 的 input 含 `provider` 参数用于选择生成策略。
- `getTopology` 是全局接口，前端拓扑页据此渲染所有工作空间及组件间的依赖关系。

## 人工备注
<!-- MANUAL_NOTES_START -->
<!-- MANUAL_NOTES_END -->
