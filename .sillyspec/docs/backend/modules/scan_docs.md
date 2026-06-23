---
schema_version: 1
doc_type: module-card
module_id: scan_docs
source_commit: ba87eec
author: qinyi
created_at: 2026-06-24T01:08:51
---
# scan_docs
## 定位
工作区扫描文档（scan-docs）的解析与存储。从工作区目录解析扫描类 markdown 文档落库，提供列表、详情、重解析能力。轻量只读为主的解析模块。
## 契约摘要
- `GET /api/workspaces/{wid}/scan-docs` → ScanDocument 列表 + 计数。
- `GET /api/workspaces/{wid}/scan-docs/{doc_id}` → 单文档详情。
- `POST /api/workspaces/{wid}/scan-docs/reparse` → 重解析磁盘回灌 DB。
- `ScanDocsService`：list_/get/reparse + _fetch_existing/_build_row/_apply_parsed。
- `ScanDocsParser`（parser.py）：解析扫描文档结构。
- 模型：ScanDocument。
## 关键逻辑
```
reparse(workspace_id):
  parser 解析磁盘扫描文档 → ScanDocsResult
  _fetch_existing(workspace_id) 取现存量
  _apply_parsed: 对比 → upsert/删除
  返回 ({created,updated,deleted}, result)
```
## 注意事项
- 与 knowledge 模块形态相似但对象不同（扫描文档 vs 知识/quicklog），勿混用。
- 重解析是回灌真相源，磁盘为准，DB 跟随。
- 文档内容较大时 get 接口注意按需返回 content（list 可省略正文）。
## 人工备注
<!-- MANUAL_NOTES_START -->
<!-- MANUAL_NOTES_END -->
