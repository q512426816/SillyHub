---
id: task-10
title: DispatchWorkerRequest 加 agent_profile_id 并在 dispatch_worker 绑 AgentProfile
title_zh: dispatch 派 worker 绑定 AgentProfile 并冻结快照
author: qinyi
created_at: 2026-08-06 14:10:00
priority: P1
depends_on: [task-06, task-09]
blocks: []
requirement_ids: [FR-04]
decision_ids: []
allowed_paths:
  - backend/app/modules/agent/mcp_tools.py
provides: []
expects_from: []
related_tests:
  - path: backend/app/modules/agent/tests/
    reason: DispatchWorkerRequest 加字段 + 绑 profile 逻辑，既有 dispatch 测试断言需同步
goal: >
  DispatchWorkerRequest（mcp_tools.py:55-66）加可选 agent_profile_id；dispatch_worker（:301）校验
  profile 属该 workspace（不属于 400）+ 写 run.agent_profile_id + 冻结 snapshot，复用 model.py:133-145 既有字段不改表（design §5.2 P4 / §1.2）。
implementation: |
  - DispatchWorkerRequest 加 agent_profile_id: uuid.UUID | None = None（可选；老调用不传行为不变）。
  - dispatch_worker 里该 id 非空时经 AgentProfileService.get(profile_id, actor=user) 取 profile（自带
    三级 visibility 校验），并断言可用于本 workspace——workspace 级须 profile.workspace_id ==
    mission.workspace_id，private/platform 级放行；不匹配/不可用返 400。
  - 校验通过：run.agent_profile_id = profile.id；run.agent_profile_snapshot = _build_agent_profile_snapshot(profile)（复用 service.py 既有冻结构造，含 version）。
  - MCP dispatch_worker tool 暴露该入参由 task-06 handler 透传（tools.py 改动归 task-06 allowed_paths）。
acceptance: |
  - 传属本 workspace 的合法 agent_profile_id：run.agent_profile_id 落库 + snapshot 含 version。
  - 传不属于本 workspace 的 workspace 级 profile id：dispatch_worker 返 400。
  - 不传 agent_profile_id 行为同前（兜底链，两字段 None）零回归；无新 alembic / ORM 列。
verify: |
  - cd backend && uv run pytest app/modules/agent -q --no-cov
constraints: |
  - 复用 AgentRun.agent_profile_id / agent_profile_snapshot（model.py:133-145），不改表不加 migration。
  - profile 属 workspace 校验复用 AgentProfileService.get 的 visibility/归属判定，不另起鉴权。
  - snapshot 冻结复用 service._build_agent_profile_snapshot，不重造；仅改 mcp_tools.py，handler 透传归 task-06。
  - G-3：与 task-09 同改 dispatch_worker，task-09 先落 read_only、本任务后绑 profile，串行避冲突。
---
