---
schema_version: 1
doc_type: module-card
module_id: lib-workspaces
author: qinyi
created_at: 2026-06-10T16:55:00
---

# lib-workspaces

## 定位
Workspace API 客户端。封装工作空间的 CRUD、扫描、关联关系、拓扑图等操作。

## 契约摘要
- CRUD: `listWorkspaces`、`getWorkspace`、`createWorkspace`、`deleteWorkspace`
- 扫描: `scanWorkspace(rootPath)`、`scanGenerate(rootPath, provider?)`、`rescanWorkspace(id)`、`reparseWorkspace(id)`
- 更新: `updateWorkspace(id, data)` — PATCH（2026-06-14 起支持 `default_agent`，null=清空）
- 激活: `activateWorkspace(id)`
- 关联: `getWorkspaceRelations(id)`、`createRelation(id, data)`、`deleteRelation(id, rid)`
- 拓扑: `getTopology()`
- 类型：Workspace（含 `default_agent`）、WorkspaceStructure、ScanResult、WorkspaceRelation、TopologyNode/Edge

## 关键逻辑
- scanWorkspace 返回目录结构和 is_sillyspec 标志
- reparseWorkspace 返回解析统计和变更的子工作空间/关联列表
- 拓扑接口是全局的（不限定单个工作空间）

## 注意事项
- Workspace 类型已扩展了 component 元数据字段（component_key/type/role/repo_url 等），用于组件化支持

## 人工备注

<!-- MANUAL_NOTES_START -->
- 2026-06-14-agent-runtime-selection：`Workspace` 类型增 `default_agent` 字段；`scanGenerate` 增 `provider` 参数（`ScanGenerateInput.provider`）；`updateWorkspace` PATCH 支持 `default_agent`（传 null=清空，省略=不变，对齐后端 exclude_unset）。
<!-- MANUAL_NOTES_END -->
