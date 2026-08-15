---
id: task-02
title: DTO 具名化：SessionCreateRequest/SessionInjectRequest 迁 schema.py + AgentSessionRead 配置字段（覆盖 FR-01, D-010@v1, D-011@v1）
title_zh: 会话请求 DTO 具名化与配置字段
author: WhaleFall
created_at: 2026-08-15 09:55:21
priority: P0
depends_on: [task-01]
blocks: [task-03, task-05, task-06, task-16]
requirement_ids: [FR-01, FR-02]
decision_ids: [D-010@v1, D-011@v1, D-013@v1]
allowed_paths:
  - backend/app/modules/daemon/schema.py
  - backend/app/modules/daemon/router.py
  - backend/app/modules/daemon/tests/test_change_session.py
provides:
  - contract: SessionCreateRequest
    fields: [runtime_id, provider, agent_profile_id, llm_provider_id, prompt, manual_approval, ask_user_only, change_id, workspace_id]
  - contract: SessionInjectRequest
    fields: [prompt, agent_profile_id, llm_provider_id]
  - contract: AgentSessionRead
    fields: [agent_profile_id, llm_provider_id, config_snapshot]
expects_from: {}
goal: >
  把 router.py:1573/1591 的 inline 会话请求 DTO 提为 schema.py 具名模型并加会话配置字段，openapi 产出具名 schema 供前端生成类型（规则 20 前置）。
implementation:
  - schema.py 新增 SessionCreateRequest（runtime_id/provider 双入口二选一优先 runtime_id；去 model 字段）
  - schema.py 新增 SessionInjectRequest（agent_profile_id/llm_provider_id，llm_provider_id 空串语义=切回本机默认，归 task-05 实现）
  - AgentSessionRead 加 agent_profile_id/llm_provider_id/config_snapshot 三字段
  - router.py create_session（:1866）/inject_session（:1898）端点改用具名 DTO，参数透传 service（service 实现归 task-03/05，本 task 透传即可）
  - 保留既有 prompt min/max_length 与 provider Literal 校验
acceptance:
  - openapi.json 产出具名 SessionCreateRequest/SessionInjectRequest schema
  - 不传新字段的老请求（/runtimes 弹窗路径）行为不变
verify:
  - cd backend && uv run pytest app/modules/daemon/tests -x -q
constraints:
  - provider 入参保留（D-002 弹窗零回归）
  - 不实现配置解析逻辑（归 task-03/05）
  - 不跑 gen:types（归 task-17）
related_tests:
  - path: backend/app/modules/daemon/tests/test_change_session.py
    reason: 既有会话端点参数断言可能因 DTO 具名化需同步请求体构造方式
---
