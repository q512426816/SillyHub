---
id: task-02
title: AgentMission 加 worker_preset/main_agent_config + AgentRun role 扩展 'orchestrator'/worktree_branch + migration
title_zh: 扩展数据模型承载 worker 预设与主 agent 配置
author: qinyi
created_at: 2026-07-12 13:04:06
priority: P0
depends_on: [task-01]
blocks: [task-03, task-04, task-07, task-08]
requirement_ids: [FR-2]
decision_ids: [D-002@v2, D-005@v2]
allowed_paths:
  - backend/app/modules/agent/model.py
  - backend/migrations/versions/
provides:
  - contract: AgentMission
    fields: [worker_preset, main_agent_config]
  - contract: AgentRun
    fields: [role, worktree_branch]
goal: >
  扩展 AgentMission/AgentRun schema 承载用户预设 worker 列表与主 agent 配置，加 migration。
implementation:
  - AgentMission 加 worker_preset JSON + main_agent_config JSON（nullable，constraints 自由 schema 先例）
  - AgentRun role 注释扩展含 'orchestrator'（现有 String(30) 自由值，加注释非 DB 约束）+ 加 worktree_branch String(128) nullable
  - worker_preset JSON schema 定稿：worker 条目 {agent_type, model, objective, role}；main_agent_config {agent_type, provider, model}
  - alembic migration（upgrade 加列；down drop，规则 11 可重置）
acceptance:
  - model.py 两表新字段就位 + 注释说明
  - migration upgrade head + downgrade -1 跑通（SQLite 测试 + PG 部署）
  - worker_preset JSON schema 在 TaskCard/design 文档化
verify:
  - cd backend && uv run pytest app/modules/agent/tests/ -q --no-cov -k model
  - cd backend && uv run alembic upgrade head && uv run alembic downgrade -1
constraints:
  - 新字段 nullable 默认 None 兼容老 mission/run 行（brownfield）
  - migration down 可逆（drop column）
  - 仅加字段，不改现有 mission 创建链路（task-03 改）
  - AgentRun.role 不加 DB 约束（保持自由 String，注释标 'orchestrator'）
---
