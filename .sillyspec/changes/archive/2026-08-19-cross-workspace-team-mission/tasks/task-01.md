---
id: task-01
title: add-cross-workspace-mission-fields
title_zh: 添加跨工作区 mission 数据模型字段
author: qinyi
created_at: 2026-08-19 10:50:00
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-01, FR-02]
decision_ids: [D-002@v1, D-007@v1, D-009@v1]
allowed_paths:
  - backend/app/modules/agent/model.py
  - backend/migrations/versions
provides:
  - contract: AgentMission
    fields: [project_id, scope_workspace_ids]
  - contract: AgentRun
    fields: [target_workspace_id]
expects_from: []
goal: >
  扩展 AgentMission 与 AgentRun 模型，支持跨工作区 mission 的项目关联与派发范围快照。
implementation:
  - 创建 migration 20260819100000_mission_cross_workspace.py
  - agent_missions 表加 project_id(uuid FK ppm_project_maintenance ON DELETE SET NULL)
  - agent_missions 表加 scope_workspace_ids(JSON NULL，存 uuid-hex 列表)
  - agent_runs 表加 target_workspace_id(uuid FK workspaces ON DELETE SET NULL)
acceptance:
  - migration 执行通过，三个新列成功创建
  - AgentMission.project_id / scope_workspace_ids 字段可读写
  - AgentRun.target_workspace_id 字段可读写
  - 外键约束正确建立(ON DELETE 行为符合设计)
verify:
  - cd backend && uv run alembic upgrade head
  - cd backend && uv run pytest app/modules/agent/tests/test_model.py -q --no-cov
constraints:
  - workspace_id 列保持 NOT NULL 不动(仅语义改为 anchor)
  - 不写入任何回填数据(未上线无存量迁移负担)
  - project_id 允许 NULL(单 ws mission 不强制挂项目)
  - scope_workspace_ids 缺省语义为 NULL 时等同于单 workspace

---
