---
schema_version: 1
doc_type: module-card
module_id: lib-knowledge
source_commit: ba87eec
author: qinyi
created_at: 2026-06-24T01:01:57+08:00
---
# lib-knowledge

## 定位
知识库（Knowledge）与 Quicklog 领域 API 客户端（`frontend/src/lib/knowledge.ts`，约 64 行）。封装工作空间下知识库文档与速记日志（quicklog）的列表与详情读取，类型镜像后端 `knowledge/schema.py`。供知识库页面消费。

## 契约摘要
- `listKnowledge(workspaceId): Promise<KnowledgeList>` — 列出知识库条目摘要。
- `getKnowledge(workspaceId, filename): Promise<KnowledgeEntry>` — 取单个知识库文档正文（按 filename）。
- `listQuicklog(workspaceId): Promise<QuicklogList>` — 列出 quicklog 条目摘要。
- `getQuicklog(workspaceId, filename): Promise<QuicklogEntry>` — 取单条 quicklog 正文。
- 类型：`KnowledgeEntry` / `QuicklogEntry`（均含 filename/path/title/content/last_modified_at）、`KnowledgeList` / `QuicklogList`（items + total）。

## 关键逻辑
```
listKnowledge(ws):   GET /api/workspaces/{ws}/knowledge       → { items, total }
getKnowledge(ws, f): GET /api/workspaces/{ws}/knowledge/{f}    → KnowledgeEntry（含 content）
listQuicklog(ws):    GET /api/workspaces/{ws}/quicklog         → { items, total }
getQuicklog(ws, f):  GET /api/workspaces/{ws}/quicklog/{f}     → QuicklogEntry（含 content）
```

## 注意事项
- knowledge 与 quicklog 是两套并行端点，结构相同但语义不同：knowledge 为长期知识文档，quicklog 为临时速记；UI 通常分两个 tab 展示。
- 条目以 `filename` 为取详情的标识（非 id），filename 即工作空间 knowledge/quicklog 目录下的文件名。
- list 接口返回的 Entry 中 content 可能为 null（仅摘要不读正文），需调 get 接口才拿到完整 content。
- `last_modified_at` 来自文件 mtime，用于列表排序与"最近更新"展示。

## 人工备注
<!-- MANUAL_NOTES_START -->
<!-- MANUAL_NOTES_END -->
