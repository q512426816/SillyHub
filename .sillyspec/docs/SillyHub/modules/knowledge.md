---
schema_version: 1
doc_type: module-card
module_id: knowledge
source_commit: ba87eec
author: qinyi
created_at: 2026-06-24T01:16:33
---
# knowledge

## 定位
后端「知识与 quicklog」功能域：解析并对外提供工作区 `.sillyspec/knowledge/` 与 `.sillyspec/quicklog/` 下的 markdown 知识条目，作为变更沉淀的可复用经验库。只读取不生成（生成由 archive 蒸馏完成），是知识消费侧。

## 契约摘要
- API（prefix=/workspaces/{workspace_id}, tag=knowledge）：`GET /knowledge`（列表）、`GET /knowledge/{filename}`（单条内容）、`GET /quicklog`（列表）、`GET /quicklog/{filename}`（单条内容）。
- `KnowledgeService`：`list_knowledge / get_knowledge / list_quicklog / get_quicklog`，`_to_knowledge_entry` / `_to_quicklog_entry` 把解析结果映射为响应对象。
- `KnowledgeParser`：`parse_knowledge(sillyspec_root)` / `parse_quicklog(sillyspec_root)`，底层 `parse_md_directory` 批量解析 markdown 目录为 `ParsedEntry`，`_extract_title` 抽取标题，`_read_file_safe` 容错读取。
- 响应 schema：`KnowledgeList/Entry`、`QuicklogList/Entry`。

## 关键逻辑
```
list_knowledge(ws) → SpecPathResolver 定位 knowledge_dir
→ KnowledgeParser.parse_knowledge → parse_md_directory → _extract_title
→ _to_knowledge_entry(include_content=False) 列表/单条
get_knowledge(ws, filename) → 同上但 include_content=True 返回正文
```

## 注意事项
- 本模块只读不写：知识文件的写入由 archive 的 `distill_knowledge` 负责，不要在此处落盘。
- `_read_file_safe` 对损坏/超大文件容错，避免单个坏文件导致整个列表 500。
- 文件名即知识 key，前端按 filename 查询；重命名知识文件会导致旧链接失效。
- knowledge 与 quicklog 是两套平行目录，解析逻辑复用 `parse_md_directory`。

## 人工备注
<!-- MANUAL_NOTES_START -->
<!-- MANUAL_NOTES_END -->
