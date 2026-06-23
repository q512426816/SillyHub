---
schema_version: 1
doc_type: module-card
module_id: knowledge
source_commit: ba87eec
author: qinyi
created_at: 2026-06-24T01:08:51
---
# knowledge
## 定位
工作区知识与 quicklog 的只读解析查询。从工作区目录解析 knowledge/quicklog 类 markdown 文档，提供列表与详情，不入库（纯解析返回）。无独立模型表。
## 契约摘要
- `GET /api/workspaces/{wid}/knowledge` → KnowledgeList：知识条目列表。
- `GET /api/workspaces/{wid}/knowledge/{filename}` → KnowledgeEntry：单条知识（含正文）。
- `GET /api/workspaces/{wid}/quicklog` → QuicklogList：quicklog 列表。
- `GET /api/workspaces/{wid}/quicklog/{filename}` → QuicklogEntry：单条 quicklog。
- `KnowledgeService`：list_knowledge/get_knowledge/list_quicklog/get_quicklog + _to_knowledge_entry/_to_quicklog_entry。
- `KnowledgeParser`（parser.py）：解析目录产出 ParsedEntry。
## 关键逻辑
```
list_knowledge(workspace_id):
  解析工作区 knowledge 目录 → ParsedEntry[]
  _to_knowledge_entry(e, include_content=False) → 列表（不带正文）
get_knowledge(filename):
  定位单文件解析 → include_content=True 返回正文
```
## 注意事项
- 纯解析模块，不落库，无 reparse 端点（每次请求实时读盘）。
- 与 scan_docs 区别：scan_docs 有 DB 缓存与 reparse，knowledge 直接读盘返回。
- filename 参数需做路径校验，防目录穿越（`../`）。
- 大目录解析有性能开销，list 接口省略正文以减负。
## 人工备注
<!-- MANUAL_NOTES_START -->
<!-- MANUAL_NOTES_END -->
