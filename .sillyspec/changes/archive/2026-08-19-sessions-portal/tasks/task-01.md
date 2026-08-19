---
id: task-01
title: 模型+迁移：AgentSession 加 agent_profile_id/llm_provider_id/config_snapshot 三列、AgentRun 加 llm_provider_id（覆盖 FR-04, D-008@v1）
title_zh: 会话配置数据模型与迁移
author: WhaleFall
created_at: 2026-08-15 09:55:21
priority: P0
depends_on: []
blocks: [task-03, task-05]
requirement_ids: [FR-04, FR-07]
decision_ids: [D-008@v1, D-011@v1]
allowed_paths:
  - backend/app/modules/agent/model.py
  - backend/migrations/versions/
provides:
  - contract: AgentSessionConfigColumns
    fields: [agent_profile_id, llm_provider_id, config_snapshot]
  - contract: AgentRunProviderColumn
    fields: [llm_provider_id]
expects_from: {}
goal: >
  给 agent_sessions 加会话配置三列、agent_runs 加供应商快照列，让每个会话独立持有配置且每轮记录生效供应商（D-008 轮次快照的数据基础）。
implementation:
  - AgentSession（model.py:449-564）加 agent_profile_id（UUID FK→agent_profiles nullable ON DELETE SET NULL）
  - 加 llm_provider_id（UUID FK→llm_providers nullable ON DELETE SET NULL）
  - 加 config_snapshot（JSON nullable，存 profile_name/provider_name/model/engine/machine_name/agent_name）
  - AgentRun（model.py:134 附近）加 llm_provider_id（UUID FK nullable）
  - 新增 Alembic 迁移文件（4 列均 nullable，无回填）
acceptance:
  - 迁移可 upgrade/downgrade 且旧数据全 NULL 不受影响
  - AgentSessionRead 无需改动即不受影响（列 nullable 默认不序列化进既有 schema 可后续 task-02 扩展）
verify:
  - cd backend && uv run alembic upgrade head
  - cd backend && uv run pytest app/modules/agent -x -q
constraints:
  - 不改既有列语义，全 nullable 零回归
  - 不在本 task 改 schema.py/DTO（归 task-02）
  - 兼容 Windows/Linux/macOS（迁移无平台特定 SQL）
related_tests: []
---
