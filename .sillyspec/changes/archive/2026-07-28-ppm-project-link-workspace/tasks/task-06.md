---
id: task-06
title: 新增项目维度关联接口
title_zh: 新增项目侧绑定解绑查询接口
author: qinyi
created_at: 2026-07-28 14:05:41
priority: P0
depends_on: [task-03, task-04]
blocks: [task-09]
requirement_ids: [FR-02, FR-05]
decision_ids: []
allowed_paths:
  - backend/app/modules/ppm/project/router.py
goal: >
  在 ppm/project/router.py 新增项目维度 GET/POST/DELETE 关联工作区端点,项目 manager 权限,只读写新关联表。
implementation:
  - GET /projects/{project_id}/workspaces 调 link_service.list_by_project
  - POST /projects/{project_id}/workspaces(body BindWorkspaceRequest)调 bind,校验当前用户对该 project 的 manager 权限(复用 ppm/common/data_scope 的 manager_project_ids)
  - DELETE /projects/{project_id}/workspaces/{workspace_id} 调 unbind,manager 校验
  - 非 manager 返回 403
acceptance:
  - 3 个端点存在并调 link_service
  - 非 manager bind/unbind 返回 403
  - 只读写 ppm_project_workspace 表,零 PPM 数据模型改动
verify:
  - "cd backend && uv run pytest tests/modules/ppm/test_project_workspace_link.py -q --no-cov"
constraints:
  - 权限复用 ppm/common/data_scope 的 manager_project_ids,沿用 2026-07-22 权限统一
  - 不碰 PPM 现有表与业务逻辑,仅加关联端点
---
