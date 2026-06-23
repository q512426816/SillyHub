---
schema_version: 1
doc_type: module-card
module_id: lib-scan-docs
source_commit: ba87eec
author: qinyi
created_at: 2026-06-24T01:01:57+08:00
---
# lib-scan-docs

## 定位
扫描文档（ScanDoc）领域 API 客户端（`frontend/src/lib/scan-docs.ts`，约 67 行）。封装工作空间扫描产出的结构化文档（如 module 映射、架构文档等）的列表、详情与重解析。轻量模块，供扫描文档页消费。

## 契约摘要
- `listScanDocs(workspaceId): Promise<ScanDocList>` — 列出工作空间下所有扫描文档摘要。
- `getScanDoc(workspaceId, docType): Promise<ScanDocRead>` — 取单个文档正文（按 doc_type）。
- `reparseScanDocs(workspaceId): Promise<ScanDocReparseStats>` — 触发重解析并返回统计。
- 类型：`ScanDocSummary`（id/doc_type/path/title/exists/last_modified_at）、`ScanDocRead`（含 content）、`ScanDocList`、`ScanDocWarning`、`ScanDocReparseStats`（parsed/created/updated/deleted）。

## 关键逻辑
```
listScanDocs(ws): GET /api/workspaces/{ws}/scan-docs → { items: ScanDocSummary[], total }
getScanDoc(ws, docType): GET /api/workspaces/{ws}/scan-docs/{docType} → ScanDocRead（含 content）
reparseScanDocs(ws): POST /api/workspaces/{ws}/scan-docs/reparse → ScanDocReparseStats
```

## 注意事项
- 文档以 `doc_type`（如 `_module-map`、架构文档类别）为标识，非 filename；`getScanDoc` 第二参是 docType。
- `ScanDocSummary.exists` 标识文档是否实际存在（可能在矩阵中登记但文件缺失），UI 据此决定是否允许查看正文。
- `ScanDocWarning` 携带 code/detail/component_key/doc_type，用于扫描文档页展示校验告警，本模块仅导出类型、告警列表通常随 list 或独立端点返回。
- reparse 统计的四个计数值（parsed/created/updated/deleted）反映本次解析对文档表的增删改影响。

## 人工备注
<!-- MANUAL_NOTES_START -->
<!-- MANUAL_NOTES_END -->
