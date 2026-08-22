---
id: task-10
title: 'add-scope-filters-to-global-session-list'
title_zh: '后端全局会话列表加 scope 过滤参'
author: qinyi
created_at: 2026-08-22 19:20:00
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-04]
decision_ids: [D-003@v2]
allowed_paths:
  - backend/app/modules/daemon/router.py
  - backend/app/modules/daemon/service.py
  - backend/app/modules/daemon/session/service.py
  - backend/app/modules/daemon/tests/test_sessions_list_filters.py
goal: >
  GET /api/daemon/sessions 增 workspace_id/change_id 可选 Query（D-003@v2），SQL 精确匹配照 runtime_id 模式零回归。
implementation:
  - router 签名加两参+透传
  - 两层 service 签名与 base_filters 加两 if
  - pytest 5 新用例（命中/剔除/不传零回归/422/双传交集）
acceptance:
  - 22 passed（17 既有+5 新）零回归
  - ruff check+format 全过
verify:
  - uv run pytest -q app/modules/daemon/tests/test_sessions_list_filters.py
constraints:
  - 加法不动既有参数语义
---
