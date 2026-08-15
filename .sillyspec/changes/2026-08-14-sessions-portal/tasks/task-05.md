---
id: task-05
title: inject_session 切换：校验+同事务快照+SESSION_SWITCH_CONFIG 下发（覆盖 FR-05, FR-06, D-008@v1, D-012@v1）
title_zh: 会话内配置切换后端链路
author: WhaleFall
created_at: 2026-08-15 09:55:21
priority: P0
depends_on: [task-03, task-08]
blocks: [task-09, task-14]
requirement_ids: [FR-05, FR-06, FR-07]
decision_ids: [D-008@v1, D-012@v1, D-013@v1]
allowed_paths:
  - backend/app/modules/daemon/session/service.py
  - backend/app/modules/daemon/tests/test_session_switch_config.py
provides:
  - contract: SessionSwitchConfigMessage
    fields: [sessionId, runId, claimToken, prompt, profile, providerConfig]
expects_from:
  task-02:
    - contract: SessionInjectRequest
      needs: [agent_profile_id, llm_provider_id]
  task-08:
    - contract: SessionSwitchConfigPayload
      needs: [profile, providerConfig, prompt, runId, claimToken]
goal: >
  让 inject_session 感知配置变更：校验合法性后同事务落新 AgentRun 快照与会话配置列，再原子下发 SESSION_SWITCH_CONFIG 给 daemon。
implementation:
  - inject_session（service.py:704）解析 agent_profile_id/llm_provider_id 与会话当前值比对
  - 校验：供应商 agent_kind 与会话引擎匹配且属主为 AgentSession.user_id（借用 runtime 场景按会话用户）；档案无引擎校验（D-013）；不匹配返回 4xx 中文错误
  - llm_provider_id 为空串时清空会话供应商（写 NULL 回本机默认）
  - 同一事务先落新 AgentRun（带 agent_profile 快照+llm_provider_id）+ 更新会话三列与 config_snapshot
  - 组装 SESSION_SWITCH_CONFIG 消息（字段对齐 task-08 的 payload 契约）经 ws_hub 下发
  - send 失败按既有 inject 收敛策略（run 置 failed、session 保持 active、可重试）
acceptance:
  - 切档案/供应商后新 AgentRun 带新快照、会话列更新、daemon 收到原子消息
  - 不匹配供应商 4xx 且会话状态不变
  - 空串切回本机默认生效
verify:
  - cd backend && uv run pytest app/modules/daemon/tests -x -q -k "inject or switch"
constraints:
  - 切换不改会话状态机（维持 active 多轮）
  - 三列与 run 同事务（避免 daemon 已切而 DB 陈旧）
  - 不含 runtime 字段（D-004@v2 机器/智能体不可切）
related_tests: []
---
