---
id: task-01
title: 'agent group consensus data model and migration'
title_zh: '数据模型与迁移（AgentGroupChat 两列 + agent_group_consensus_tasks 表）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-11 22:17:10
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-1.1]
decision_ids: [D-002@v1, D-008@v1]
allowed_paths:
  - backend/app/modules/agent/model.py
  - backend/app/migrations/versions/20260910130000_group_consensus.py
target_files:
  - backend/app/modules/agent/model.py
  - NEW:backend/app/migrations/versions/20260910130000_group_consensus.py
goal: >
  为汇总模式提供持久层：AgentGroupChat 加 consensus_mode/consensus_timeout_seconds 两列，新建 agent_group_consensus_tasks 状态机表（JSONB 成员明细 + deadline + 三索引），alembic 迁移可升可降（design 5.2）。
implementation:
  - "model.py：AgentGroupChat 加 consensus_mode bool server_default false、consensus_timeout_seconds int server_default 600（照 agent_cross_mention 顶层列先例）"
  - "model.py：新建 AgentGroupConsensusTask（group_id FK CASCADE / carrier_run_id FK agent_runs CASCADE+UNIQUE / coordinator_member_id FK agent_group_members CASCADE / status String(16) / members JSON / deadline_at DateTime(tz) / created_by FK users / created_at + converged_at）"
  - "索引：ix_agct_group(group_id)、ix_agct_status_deadline(status, deadline_at)、uq_agct_carrier_run(carrier_run_id)"
  - "迁移 20260910130000_group_consensus.py：upgrade 两列+建表+三索引，downgrade 完全逆操作"
acceptance:
  - "uv run alembic upgrade head 后表结构齐全（两列默认 False/600），downgrade 一级回到旧结构"
  - "AgentGroupConsensusTask 的 status 由应用层控制（模型层不设 server_default status）"
verify:
  - "cd backend && uv run ruff check app/modules/agent/model.py && uv run alembic upgrade head && uv run alembic downgrade -1 && uv run alembic upgrade head"
constraints:
  - "不动 settings_json 白名单机制"
  - "不加业务函数（状态机在 task-07）"
  - "迁移文件名固定 20260910_group_consensus"
---

<!-- task-01: 数据模型与迁移（AgentGroupChat 两列 + agent_group_consensus_tasks 表）（骨架由 taskcard CLI 预生成，主代理降级直填——环境无子代理） -->
