---
schema_version: 1
doc_type: module-card
module_id: lib-components
author: qinyi
created_at: 2026-06-10T16:55:00
---

# lib-components

## 定位
组件（Component）API 兼容层。后端重构后，"组件"变为子工作空间（component_key !== null 的 Workspace），此模块提供向后兼容的 API 映射。

## 契约摘要
- `listComponents(workspaceId)` — 列出子工作空间（映射为 Component 类型）
- `getComponent(workspaceId, componentId)` — 获取单个组件
- `reparseComponents(workspaceId)` — 重新扫描/解析组件
- `getTopology(workspaceId?)` — 获取拓扑图（映射为 TopologyResponse 类型）
- 类型：Component、Relation、ReparseResponse、TopologyNode/Edge

## 关键逻辑
- `workspaceToComponent()` 内部函数将 Workspace 映射为 Component 类型
- listComponents 通过路径前缀匹配（`ws.root_path + "/"`）过滤子工作空间
- reparseComponents 内部调用 rescan + listComponents 重建结果

## 注意事项
- 这是过渡层，新代码应直接使用 lib/workspaces 的接口
- 类型定义与 lib/workspaces 有重叠，未来可能被移除

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
