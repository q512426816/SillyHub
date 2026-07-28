---
id: task-08
title: 后端关联测试全套
title_zh: 后端关联逻辑与接口测试
author: qinyi
created_at: 2026-07-28 14:05:41
priority: P0
depends_on: [task-05, task-06, task-07]
blocks: [task-14]
requirement_ids: [FR-04, FR-05, FR-06, FR-07, FR-08, FR-09]
decision_ids: []
allowed_paths:
  - backend/app/modules/workspace/tests/test_link_service.py
  - backend/app/modules/workspace/tests/test_link_router.py
  - backend/tests/modules/ppm/test_project_workspace_link.py
goal: >
  编写后端关联全套测试,覆盖表级逻辑、双边接口、权限、重复、软删、级联、存在性,PG/SQLite 双兼容。
implementation:
  - test_link_service:bind/unbind/list/重复409/存在性404/软删过滤
  - test_link_router:工作区维度 GET/POST/DELETE + 非成员 403
  - test_project_workspace_link:项目维度 GET/POST/DELETE + 非 manager 403 + CASCADE(删项目关联消失)
acceptance:
  - 三组测试全部通过
  - 覆盖越权 403、重复 409、软删过滤、CASCADE、存在性 404
verify:
  - "cd backend && uv run pytest app/modules/workspace/tests/test_link_service.py app/modules/workspace/tests/test_link_router.py tests/modules/ppm/test_project_workspace_link.py -q --no-cov"
constraints:
  - PG/SQLite 双兼容,无方言专属语法(date_trunc 等勿用或分支)
  - 断言不绑死 SQL 函数名
---
