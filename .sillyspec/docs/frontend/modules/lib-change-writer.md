---
schema_version: 1
doc_type: module-card
module_id: lib-change-writer
author: qinyi
created_at: 2026-06-10T16:55:00
---

# lib-change-writer

## 定位
Change Writer API 客户端。封装变更文档的创建和批量生成。

## 契约摘要
- `createChange(workspaceId, data)` — 创建变更文档
- `generateDocs(workspaceId, data)` — 生成文档
- `batchGenerateDocuments(workspaceId, data)` — 批量生成文档

## 关键逻辑
- 调用 `/api/workspaces/{id}/change-writer` 系列端点
- 与 lib-changes 的 createChange 不同，此模块专注于文档生成

## 注意事项
- 注意与 lib-changes 的 createChange 区分，两者签名不同

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
