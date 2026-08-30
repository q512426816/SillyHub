---
id: task-01
title: 新增 PpmProjectWorkspace 关联模型
title_zh: 新增项目工作区多对多关联模型
author: qinyi
created_at: 2026-07-28 14:05:41
priority: P0
depends_on: []
blocks: [task-02, task-03, task-04]
requirement_ids: [FR-01, FR-07]
decision_ids: [D-001@v1]
allowed_paths:
  - backend/app/modules/workspace/model.py
goal: >
  新增 PPM项目与平台工作区的多对多关联表模型,仿照现有 TaskWorkspace 模式,作为关联骨架的数据基础。
implementation:
  - 在 workspace/model.py 仿 TaskWorkspace(同文件 135-160 行)新增 PpmProjectWorkspace 类,table_name=ppm_project_workspace
  - 字段 ppm_project_id(UUID FK→ppm_project_maintenance.id ON DELETE CASCADE,主键)
  - 字段 workspace_id(UUID FK→workspaces.id ON DELETE CASCADE,主键)
  - 索引 ix_ppm_project_workspace_workspace on workspace_id
acceptance:
  - PpmProjectWorkspace 类存在,复合主键 + 双向 CASCADE + workspace_id 索引
  - 未给 PpmProjectMaintenance 表新增任何列(D-001@v1 平台级无 workspace_id)
verify:
  - "cd backend && uv run python -c \"from app.modules.workspace.model import PpmProjectWorkspace\""
  - "cd backend && uv run mypy app/modules/workspace/model.py"
constraints:
  - 严格仿 TaskWorkspace 模式,不加关联元数据(role/类型/备注)
  - 不修改 PpmProjectMaintenance 表结构
---
