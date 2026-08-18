---
schema_version: 1
doc_type: module-card
module_id: lib-scan-docs
author: qinyi
created_at: 2026-08-18 01:45:00
---

# 扫描文档客户端（lib-scan-docs）

## 定位
扫描文档（ScanDoc）API 客户端（`frontend/src/lib/scan-docs.ts`，约 41 行）。封装 workspace 扫描产出文档的列表（支持搜索）、详情与重解析；类型全部从 OpenAPI 生成（`components["schemas"]`）避免手写漂移。供扫描文档页消费；`lib-scan-docs-tree.buildTree` 以本模块 `ScanDocSummary` 为输入构建目录树。

## 契约摘要
- `listScanDocs(workspaceId, query?: { q?: string })` → `ScanDocList`（items + total；q 进搜索参数）。
- `getScanDoc(workspaceId, docId)` → `ScanDocRead`（含 content）。
  - **第二参是 `ScanDocSummary.id`（uuid）**，扫描文档页传 `doc.id`——非旧卡的 docType。
- `reparseScanDocs(workspaceId)` → `ScanDocReparseResponse`。
  - `{ workspace_id, stats: ScanDocReparseStats, warnings?: ScanDocWarning[] }`；stats = parsed / created / updated / deleted 四计数。
- `STALE_THRESHOLD_MS` — 过期阈值常量，默认 1h，可经 `NEXT_PUBLIC_SCAN_DOC_STALE_MS` 覆盖。
- `ScanDocSummary` 关键字段（生成类型）：
  - 基本：`id` / `doc_type` / `path` / `title` / `exists` / `last_modified_at`。
  - 平台同步溯源：`source_member_id` / `source_synced_at` / `source_mtime` / `content_hash` / `conflict_count`。

## 关键逻辑
```
GET  /api/workspaces/{ws}/scan-docs?q=        → ScanDocList
GET  /api/workspaces/{ws}/scan-docs/{docId}   → ScanDocRead
POST /api/workspaces/{ws}/scan-docs/reparse   → ScanDocReparseResponse
```

## 注意事项
- 文档标识双轨：路由/树按 `path`（buildTree 自适应剥离 `.sillyspec`/`docs` 前导段，兼容扁平与包裹两种布局），详情按 `id`；`doc_type` 是类别维度，三者勿混用。
- `exists=false` 表示登记在矩阵但文件缺失，UI 据此禁看正文。
- 同步溯源字段（source_*/content_hash/conflict_count）服务于平台管理文件的增量同步与冲突展示，与 `lib-change-files`/`lib-spec-workspaces` 域的冲突语义相关。
- reparse 响应带 warnings 列表，页面应展示校验告警而非只看四计数。

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
