---
author: qinyi
created_at: 2026-07-01T08:59:30
---

# Tasks — 扫描文档页文档树搜索（名称 + 内容）

## 需求
扫描文档页文档树加搜索：按名称（path/title）和文档内容过滤。

## 方案
后端 list 接口加可选 `q` 参数（ILIKE path/title/content，大小写不敏感，向后兼容）；前端文档树上方加搜索框 debounce 300ms 调 `list?q=`，清空恢复全量。summary 不含 content，命中后点击查看全文。

## Tasks
- [x] backend/app/modules/scan_docs/router.py：list_scan_docs 加 `q: Annotated[str | None, Query(min_length=1)]`，透传 service.list_
- [x] backend/app/modules/scan_docs/service.py：list_ 加 q 参数；q 非空时叠加 WHERE（用 func.lower+like+escape 跨方言 PG/SQLite 大小写不敏感搜 path/title/content，转义 `%`/`_`/`\` 防通配注入）
- [x] backend/app/modules/scan_docs/tests/test_service.py：加 TestListDocsWithQuery 7 用例（q=None 全量 / path / title / content / 大小写 / 不命中 / `%` 转义）— 实施时由 test_router 改为 test_service（db_session fixture 可直接插行更单元）
- [x] frontend/src/lib/scan-docs.ts：listScanDocs 加可选 query 参数拼 `?q=`
- [x] frontend/src/app/(dashboard)/workspaces/[id]/scan-docs/page.tsx：文档树 SectionCard 内顶部加搜索输入框（placeholder「搜索名称或内容」），debounce 300ms 调 list?q=（不触发 reparse），清空恢复全量，跳过首次避免重复，空结果区分「无匹配」/「暂无」
- [x] 验证：backend pytest test_service.py 19 passed（新增 7）；frontend tsc typecheck 通过；scan-docs-tree 回归 3 passed
