---
schema_version: 1
doc_type: module-card
module_id: lib-knowledge
author: qinyi
created_at: 2026-06-10T16:55:00
---

# lib-knowledge

## 定位
知识库 & Quicklog API 客户端。

## 契约摘要
- `listKnowledge(workspaceId)` — 列出知识库条目
- `getKnowledge(workspaceId, filename)` — 获取知识库条目内容
- `listQuicklog(workspaceId)` — 列出 Quicklog 条目
- `getQuicklog(workspaceId, filename)` — 获取 Quicklog 条目内容
- 类型：KnowledgeEntry、KnowledgeList、QuicklogEntry、QuicklogList

## 关键逻辑
- 调用 `/api/workspaces/{id}/knowledge` 和 `/api/workspaces/{id}/quicklog` 端点
- 条目包含 filename/path/title/content/last_modified_at

## 注意事项
- 无特殊注意点

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
