---
id: task-04
title: 新增 link_service 表级逻辑
title_zh: 新增关联表绑定解绑查询服务
author: qinyi
created_at: 2026-07-28 14:05:41
priority: P0
depends_on: [task-01, task-03]
blocks: [task-05, task-06]
requirement_ids: [FR-01, FR-04, FR-06, FR-09]
decision_ids: []
allowed_paths:
  - backend/app/modules/workspace/link_service.py
goal: >
  新增 link_service.py 封装关联表级 bind/unbind/list 逻辑,权限无关,供项目侧与工作区侧两个 router 复用。
implementation:
  - bind(ppm_project_id, workspace_id):先校验两者存在(不存在抛 404),再查重(已存在抛 409),最后 insert
  - unbind(ppm_project_id, workspace_id):delete 关联行
  - list_by_workspace(workspace_id):返回关联的 PpmProjectBrief 列表,过滤 workspace.deleted_at IS NULL
  - list_by_project(ppm_project_id):返回关联的 WorkspaceBrief 列表
acceptance:
  - bind/unbind/list_by_workspace/list_by_project 函数存在
  - 重复绑定抛 409,目标不存在抛 404
  - list_by_workspace 过滤软删除 workspace
verify:
  - "cd backend && uv run pytest app/modules/workspace/tests/test_link_service.py -q --no-cov"
constraints:
  - 权限无关,权限校验在 router 层
  - 复合主键天然防重,重复绑走 409 而非 500
  - 不直接读 PPM 现有业务表,仅读 ppm_project_maintenance 做存在性校验
---
