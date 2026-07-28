---
id: task-03
title: 新增关联请求响应 DTO
title_zh: 新增关联接口数据传输对象
author: qinyi
created_at: 2026-07-28 14:05:41
priority: P0
depends_on: [task-01]
blocks: [task-04, task-05, task-06]
requirement_ids: [FR-02, FR-03, FR-04]
decision_ids: []
allowed_paths:
  - backend/app/modules/workspace/schema.py
goal: >
  在 workspace/schema.py 定义关联接口的请求与响应 DTO,供 link_service 与两个 router 使用。
implementation:
  - 新增 BindPpmProjectRequest(ppm_project_id: UUID)
  - 新增 BindWorkspaceRequest(workspace_id: UUID)
  - 新增 WorkspaceBrief(workspace_id/name/status/type) 与 PpmProjectBrief(project_id/project_name/project_status)
acceptance:
  - 4 个 DTO 定义存在,Pydantic v2 BaseModel + Field
verify:
  - "cd backend && uv run mypy app/modules/workspace/schema.py"
constraints:
  - Pydantic v2 BaseModel + Field 定义
  - 不引入业务逻辑,纯数据形状
---
