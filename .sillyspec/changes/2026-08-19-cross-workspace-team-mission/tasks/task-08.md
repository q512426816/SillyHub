---
id: task-08
title: mcp-tools-scope-relaxation
title_zh: MCP 链路A scope 放宽与 target 参数
author: qinyi
created_at: 2026-08-19 10:50:00
priority: P0
depends_on: [task-04, task-05]
blocks: []
requirement_ids: [FR-02, FR-04, FR-05]
decision_ids: [D-001@v2, D-010@v1]
allowed_paths:
  - backend/app/modules/agent/mcp_tools.py
  - backend/app/modules/agent/tests/test_mcp_tools.py
provides:
  - contract: mcp_scope_validation
    fields: [target_workspace_id, scope_workspace_ids]
expects_from:
  task-01:
    - contract: AgentMission
      needs: [scope_workspace_ids]
  task-04:
    - contract: dispatch_worker
      needs: [target_workspace_id]
goal: >
  链路A MCP 工具放宽 scope 校验、新增 target 参数、profile 归属放宽，
  支持跨工作区派 worker 且零回归单 workspace 场景。
implementation:
  - 改 _get_mission 校验逻辑为 workspace_id == mission.workspace_id 或
    workspace_id ∈ mission.scope_workspace_ids（scope 为 NULL 时按 [workspace_id] 处理）
  - DispatchWorkerRequest schema 加 target_workspace_id 字段（可选，默认 None）
  - dispatch_worker endpoint 读 target_workspace_id，服务端校验
    target ∈ scope（含 anchor），越界抛 400 mission_target_out_of_scope
  - _resolve_dispatch_agent_profile 的 workspace 级 profile 校验放宽为
    profile.workspace_id ∈ {anchor} ∪ scope（原 == mission.workspace_id 在跨 ws
    场景误判 400）
  - 新增 pytest 测试用例覆盖 scope 放宽、target 校验、profile 归属放宽三场景
acceptance:
  - scope 包含 workspace_id 或 workspace_id ∈ scope_workspace_ids 时通过校验
  - target_workspace_id ∈ scope 时 dispatch_worker 成功派发
  - target_workspace_id ∉ scope 时返回 400 错误码 mission_target_out_of_scope
  - profile.workspace_id ∈ {anchor} ∪ scope 时通过校验，否则 400
  - 单 workspace mission（scope 为 NULL 或 [workspace_id]）行为零回归
verify:
  - cd backend && uv run pytest app/modules/agent/tests/test_mcp_tools.py -q --no-cov
constraints:
  - scope_workspace_ids 为 NULL 时必须等价于 [workspace_id]，兼容存量数据
  - target_workspace_id 为 None 时必须等价于 workspace_id（零回归）
  - 不得破坏现有 _get_mission 的 workspace_id == mission.workspace_id 快速路径

---
