# lib-knowledge 变更索引
- change 2026-10-15-platform-knowledge-search | 新增 `searchKnowledge(workspaceId, {query, limit?})` → POST `/api/workspaces/{ws}/knowledge/search`（json body 补 limit 缺省 20；显式 timeoutMs 120s——首查含服务端索引构建）。类型别名再导出 KnowledgeSearchIn/KnowledgeSearchResultItem/KnowledgeSearchOut（生成物）。页面知识搜索数据链入口（task-03）。
