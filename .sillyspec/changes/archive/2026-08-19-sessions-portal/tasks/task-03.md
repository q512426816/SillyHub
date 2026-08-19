---
id: task-03
title: create_session 接线：runtime_id 钉定 + 档案提示词注入 + 会话级供应商 + 快照落库（覆盖 FR-01, FR-03, D-005@v1, D-013@v1）
title_zh: 会话创建接线与配置落库
author: WhaleFall
created_at: 2026-08-15 09:55:21
priority: P0
depends_on: [task-01, task-02, task-04]
blocks: [task-05, task-12]
requirement_ids: [FR-01, FR-03, FR-04]
decision_ids: [D-005@v1, D-010@v1, D-013@v1]
allowed_paths:
  - backend/app/modules/daemon/session/service.py
  - backend/app/modules/agent/placement.py
  - backend/app/modules/agent/service.py
  - backend/app/modules/daemon/tests/test_session_create_config.py
provides:
  - contract: CreateSessionConfigWiring
    fields: [runtime_id, agent_profile_id, llm_provider_id, config_snapshot]
expects_from:
  task-02:
    - contract: SessionCreateRequest
      needs: [runtime_id, agent_profile_id, llm_provider_id]
goal: >
  让 create_session 按 runtime_id 钉定机器与智能体、按档案只注入提示词与技能、按会话级供应商写注入 key，并把配置快照落库。
implementation:
  - placement.py prepare_interactive_dispatch（:575）加 runtime_id 钉定参数，命中时跳过 _get_online_runtime（:626）first-online 选择与 provider fallback（:1329）
  - service.py create_session（:447）解析 runtime_id 对应 DaemonRuntime 并校验在线，派生 provider
  - agent/service.py 新增会话专用档案注入变体（非 commit）：只写 system_prompt 与 mcp_refs/skill_refs 到 lease metadata，不读 profile 的 provider/model/llm_provider_id（D-013）
  - create_session 把会话供应商 id 写 lease metadata key session_llm_provider_id（校验 agent_kind 与归属）
  - 写 agent_sessions 三列与 config_snapshot（含 machine_name/agent_name，快照数据来自 runtime 与档案/供应商解析结果）
  - 未传新字段时全链路与现状一致（弹窗零回归）
acceptance:
  - 传 runtime_id 时 lease 定位到该 runtime 所属机器（不被 fallback 改道）
  - 选档案只注入 system_prompt+mcp/skill；选供应商走 task-04 分支
  - 未选档案/供应商时行为与现状逐字段一致
verify:
  - cd backend && uv run pytest app/modules/daemon/tests -x -q -k session
constraints:
  - 会话档案注入变体不 commit（事务由 create_session 统一提交）
  - 不实现 inject 切换（归 task-05）
  - 快照写库与 lease 创建同事务
related_tests: []
---
