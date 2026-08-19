---
id: task-07
title: add-project-mission-endpoints
title_zh: 添加项目维度 mission 端点
author: qinyi
created_at: 2026-08-19 10:50:00
priority: P0
depends_on: [task-05, task-06]
blocks: []
requirement_ids: [FR-01, FR-05]
decision_ids: [D-005@v1, D-006@v1]
allowed_paths:
  - backend/app/modules/agent/router.py
  - backend/app/modules/agent/orchestrator.py
  - backend/app/modules/agent/tests/test_router_project_missions.py
provides:
  - contract: project-mission-endpoints
    fields: [POST_projects_pid_missions, GET_projects_pid_missions]
expects_from:
  task-05:
    - contract: MissionCreateRequest
      needs: [anchor_workspace_id, scope_workspace_ids]
  task-06:
    - contract: team_mission_entry
      needs: [scope_workspace_ids]
goal: >
  新增 POST / GET /api/projects/{pid}/missions 两端点，支持项目维度创建与查询 mission(含 scope 校验、鉴权、预检)。
implementation:
  - router.py 新增 POST /api/projects/{project_id}/missions 端点
  - 鉴权：复用 ppm/project/router.py 的 _require_project_manager(项目经理或超管)
  - 校验：scope_workspace_ids ⊆ ppm_project_workspace(project_id)关联集(422)
  - 校验：anchor_workspace_id ∈ scope_workspace_ids(422)
  - 预检：scope 内各 workspace 至少一条 binding 带 daemon_id(缺的报清单，可仍强制创建)
  - 行为：mode 强制 team(项目维度无 single 语义)
  - 落库：写 AgentMission.project_id / scope_workspace_ids(调用 team_mission_entry 传 scope)
  - router.py 新增 GET /api/projects/{project_id}/missions 端点
  - GET 鉴权同 POST(项目经理/超管)
  - GET 返回 MissionResponse 列表(复用 _mission_to_response，附概要字段)
acceptance:
  - POST 创建成功且 project_id / scope_workspace_ids 写入
  - scope 越界(含非项目关联 ws)时 422
  - anchor 不在 scope 时 422
  - 非项目经理 403
  - 缺 binding 的 ws 在响应中报清单(可仍创建)
  - GET 返回列表含 project_id / scope_workspace_ids / workspace_name / workspace_type
verify:
  - cd backend && uv run pytest app/modules/agent/tests/test_router_project_missions.py -q --no-cov
constraints:
  - mode 强制 team(不接受 mode=single)
  - scope_workspace_ids 必填(≥1 个元素)
  - anchor_workspace_id 缺省时取 scope 第一个或 type=backend 优先
  - 不改既有 /workspaces/{id}/missions 端点(零回归单 ws)
  - binding 预检失败不阻断创建(仅报清单提示)

---
