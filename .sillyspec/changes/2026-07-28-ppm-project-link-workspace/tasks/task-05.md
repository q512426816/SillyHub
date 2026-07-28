---
id: task-05
title: 新增工作区维度关联接口
title_zh: 新增工作区侧绑定解绑查询接口
author: qinyi
created_at: 2026-07-28 14:05:41
priority: P0
depends_on: [task-03, task-04]
blocks: [task-07, task-09]
requirement_ids: [FR-03, FR-05, FR-06]
decision_ids: []
allowed_paths:
  - backend/app/modules/workspace/link_router.py
goal: >
  新增 workspace/link_router.py,工作区维度 GET/POST/DELETE 关联 PPM 项目,工作区成员权限校验。
implementation:
  - 新建 APIRouter,GET /workspaces/{workspace_id}/ppm-projects 调 list_by_workspace
  - POST /workspaces/{workspace_id}/ppm-projects(body BindPpmProjectRequest)调 bind,require_permission(WORKSPACE_*)
  - DELETE /workspaces/{workspace_id}/ppm-projects/{ppm_project_id} 调 unbind,require_permission(WORKSPACE_*)
  - 权限 key 对齐 members_router 现有 WORKSPACE_* 定义
acceptance:
  - 3 个端点存在并调 link_service
  - 非工作区成员 bind/unbind 返回 403
verify:
  - "cd backend && uv run pytest app/modules/workspace/tests/test_link_router.py -q --no-cov"
constraints:
  - 权限用 require_permission(WORKSPACE_*),具体 key 与 members_router 一致
  - 不直接操作 DB,全部经 link_service
---
