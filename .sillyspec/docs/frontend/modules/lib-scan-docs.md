---
schema_version: 1
doc_type: module-card
module_id: lib-scan-docs
author: qinyi
created_at: 2026-06-10T16:55:00
---

# lib-scan-docs

## 定位
扫描文档 API 客户端。封装工作空间扫描产出文档的查询和重新解析。

## 契约摘要
- `listScanDocs(workspaceId)` — 列出扫描文档
- `getScanDoc(workspaceId, filename)` — 获取单个扫描文档内容
- `reparseScanDocs(workspaceId)` — 重新解析扫描文档

## 关键逻辑
- 调用 `/api/workspaces/{id}/scan-docs` 系列端点
- 轻量模块，仅 3 个函数

## 注意事项
- 无特殊注意点

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
