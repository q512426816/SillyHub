---
id: task-09
title: mcp-gateway-scope-alignment
title_zh: MCP 链路B scope 对齐与 converge 兜底路由
author: qinyi
created_at: 2026-08-19 10:50:00
priority: P0
depends_on: [task-04, task-05]
blocks: []
requirement_ids: [FR-02, FR-04, FR-05]
decision_ids: [D-001@v2, D-010@v1]
allowed_paths:
  - backend/app/modules/mcp_gateway/tools.py
  - backend/app/modules/mcp_gateway/tests/
provides:
  - contract: mcp_gateway_target
    fields: [target_workspace_id, scope_validation]
expects_from:
  task-01:
    - contract: AgentMission
      needs: [scope_workspace_ids]
  task-04:
    - contract: dispatch_worker
      needs: [target_workspace_id]
goal: >
  链路B MCP 工具与链路A 同款对齐、converge 兜底路由走 representative 旗标，
  确保两通道访问面一致且支持跨工作区派发。
implementation:
  - _get_mission 校验放宽为 workspace_id == mission.workspace_id 或
    workspace_id ∈ scope_workspace_ids（NULL scope 按 [workspace_id] 处理）
  - dispatch_worker tool 入参加 target_workspace_id 字段（可选，默认 None）
  - dispatch_worker handler 读 target_workspace_id，服务端校验 target ∈ scope，
    越界抛 AppError code=MCP_400_MISSION_TARGET_OUT_OF_SCOPE
  - _resolve_dispatch_profile_mcp 的 workspace 级校验放宽为
    profile.workspace_id ∈ {anchor} ∪ scope
  - converge_mission tool 的 worker 失败兜底派发路由：
    user=token.created_by，经 representative 旗标逻辑（target≠anchor 走代表 binding）
  - 新增 pytest 测试用例覆盖三场景（scope 放宽、target 校验、converge 兜底路由）
acceptance:
  - scope 包含 workspace_id 或 workspace_id ∈ scope_workspace_ids 时通过校验
  - target_workspace_id ∈ scope 时 dispatch_worker 成功派发
  - target_workspace_id ∉ scope 时返回 MCP 错误码 MCP_400_MISSION_TARGET_OUT_OF_SCOPE
  - profile.workspace_id ∈ {anchor} ∪ scope 时通过校验，否则 MCP 错误
  - converge 兜底派发经 representative 旗标且 target≠anchor 时走代表 binding
verify:
  - cd backend && uv run pytest app/modules/mcp_gateway/tests/ -q --no-cov -k "dispatch_worker or converge"
constraints:
  - scope_workspace_ids 为 NULL 时必须等价于 [workspace_id]，兼容存量数据
  - target_workspace_id 为 None 时必须等价于 workspace_id（零回归）
  - converge 兜底路由必须经 MissionExecutionService.dispatch_worker，
    不重复 placement 逻辑

---
