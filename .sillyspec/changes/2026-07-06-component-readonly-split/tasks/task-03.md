---
id: task-03
title: router GET /components 改读 catalog + 移除 relations/reparse 端点
author: qinyi
created_at: 2026-07-06 11:29:29
priority: P0
depends_on: [task-02]
blocks: []
requirement_ids: [FR-01, FR-03, FR-04]
decision_ids: [D-001@V1, D-003@V1, D-004@V1]
allowed_paths:
  - backend/app/modules/workspace/router.py
goal: >
  router 层切换：GET /components 改调 task-02 的 catalog service；移除 relations CRUD 与 POST /reparse 端点（D-001/D-003/D-004）。
implementation:
  - `GET /workspaces/{id}/components` 实现体改为 `component_catalog_service.list_components(id)`，权限沿用 `require_permission(Permission.WORKSPACE_READ)`
  - 移除路由：`GET /workspaces/{id}/relations`、`POST /workspaces/{id}/relations`、`DELETE /workspaces/{id}/relations/{rid}`、`POST /workspaces/{id}/reparse`
  - 移除对应 router import（relation_service 依赖）
  - `generate-projects` 端点保留（task-04 改其内部）
acceptance:
  - GET /components 响应符合 design §7.1 结构（items 数组）
  - relations/reparse 路由全部 404（不再注册）
  - router 无 relation_service/reparse 方法的残留 import
verify:
  - cd backend && python -m pytest tests/modules/workspace/test_router.py -q
  - cd backend && python -m pytest tests/modules/workspace/test_component_catalog.py -q
constraints:
  - GET /workspaces、GET /workspaces/{id} 不动（component_key 列保留）
  - generate-projects 端点本身不动，仅内部 reparse 调用由 task-04 处理
  - brownfield：项目组 workspace 的其他 CRUD 路由行为不变
---

