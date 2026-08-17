---
id: task-05
title: change router GET 列表/详情端点 + pytest（覆盖 FR-04, FR-06, FR-07）
title_zh: quicklog 查询端点
author: qinyi
created_at: 2026-08-17 00:36:00
priority: P0
depends_on: [task-04]
blocks: [task-07]
requirement_ids: [FR-04, FR-06, FR-07]
decision_ids: [D-002]
allowed_paths:
  - backend/app/modules/change/router.py
  - backend/app/modules/change/schema.py
  - backend/app/modules/change/tests/test_quicklog_router.py
provides:
  - contract: quicklog_query_api
    fields: [list_path, detail_path, params, merge_semantics, response_shape]
expects_from:
  task-04: [quicklog_query_data]
goal: >
  暴露查询端点：GET /api/workspaces/{id}/quicklog-entries（列表，分页+筛选）与
  GET /api/workspaces/{id}/quicklog-entries/{ql_id}（单条详情，含 body 全文+raw_block）。
  linked_change 参数支持反向关联筛选（FR-07）。
implementation:
  - change/router.py 新增两个 GET 端点（挂 workspace 鉴权链）
  - 列表参数：search/status/author/linked_change/include_placeholder/page/page_size
  - schema.py 新增 QuicklogEntryList/QuicklogEntryRead DTO
  - 单条详情：合并源定位，无则 404（WorkspaceNotFound 同款文案）
acceptance:
  - 列表分页/筛选正确；search 命中标题+正文；linked_change 过滤正确
  - 详情返回全字段；不存在 ql_id → 404
  - 无 quicklog 目录/无推送数据 → 200 空列表（不 5xx）
verify:
  - cd backend && uv run pytest app/modules/change/tests/test_quicklog_router.py -x -q
  - cd backend && uv run ruff check app/modules/change
constraints:
  - 端点只增不改；鉴权复用 workspace 成员链路
  - 列表不含 body 全文（详情单独拉），raw_block 仅详情返回
related_tests: []
---
