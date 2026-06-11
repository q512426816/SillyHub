---
schema_version: 1
doc_type: module-card
module_id: lib-archive
author: qinyi
created_at: 2026-06-10T16:55:00
---

# lib-archive

## 定位
Archive（归档）API 客户端。

## 契约摘要
- `archiveChange(workspaceId, changeId)` — 归档变更
- `distillChange(workspaceId, changeId)` — 提炼变更（生成归档摘要）

## 关键逻辑
- 调用 `/api/workspaces/{id}/archive` 系列端点
- 归档前应先通过 lib-changes 的 checkArchiveGate 检查归档门禁

## 注意事项
- 无特殊注意点

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
