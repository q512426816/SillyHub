---
id: task-05
title: extend-mission-schema-cross-workspace
title_zh: 扩展 mission schema 支持跨工作区
author: qinyi
created_at: 2026-08-19 10:50:00
priority: P0
depends_on: [task-01]
blocks: []
requirement_ids: [FR-01, FR-04]
decision_ids: [D-005@v1]
allowed_paths:
  - backend/app/modules/agent/mission_schema.py
  - backend/app/modules/agent/tests/test_mission_schema_cross_workspace.py
provides:
  - contract: MissionCreateRequest
    fields: [anchor_workspace_id, scope_workspace_ids]
  - contract: MissionResponse
    fields: [project_id, scope_workspace_ids, workspace_name, workspace_type]
  - contract: MissionWorkerRunResponse
    fields: [target_workspace_id, target_workspace_name]
expects_from:
  task-01:
    - contract: AgentMission
      needs: [project_id, scope_workspace_ids]
    - contract: AgentRun
      needs: [target_workspace_id]
goal: >
  扩展 mission schema 的 Create / Response / WorkerRun 三个 DTO，支持跨工作区字段全链路透传。
implementation:
  - MissionCreateRequest 新增 anchor_workspace_id(uuid | None) 与 scope_workspace_ids(list[uuid] | None)
  - MissionResponse 新增 project_id / scope_workspace_ids / workspace_name / workspace_type
  - MissionWorkerRunResponse 新增 target_workspace_id / target_workspace_name
  - 全部字段设为可选(零回归单 ws mission)
acceptance:
  - CreateRequest 可选传 anchor 与 scope(前端表单用)
  - Response 含项目关联字段与 scope 概要(列表展示)
  - WorkerRunResponse 含 target 概要(跨 ws worker 行显示)
  - 旧字段全部保留(向后兼容)
verify:
  - cd backend && uv run pytest app/modules/agent/tests/test_mission_schema_cross_workspace.py -q --no-cov
constraints:
  - 所有新字段可选(NULL | None)
  - 不删除既有字段
  - 不改字段类型(仅新增)
  - workspace_name / workspace_type / target_workspace_name 为概要字段非校验字段

---
