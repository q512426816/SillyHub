---
id: task-03
title: 'backend-model-migration'
title_zh: '后端数据层：origin/aggregation_key/title + agent_session_id + 迁移'
author: qinyi
created_at: 2026-08-23 14:08:00
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-03, FR-04]
decision_ids: [D-006, D-007]
allowed_paths:
  - backend/app/modules/agent/model.py
  - backend/app/modules/platform_sync/model.py
  - backend/migrations/versions/20260823120000_agent_log_sessionization.py
  - backend/app/modules/daemon/tests/conftest.py
goal: >
  会话化数据基座：agent_sessions 加 origin（chat|tool_report）/aggregation_key/title
  三列（title NULL 兼容，Grill P1-1），platform_agent_logs 加 agent_session_id FK，
  迁移 + 测试建表扩展（design §3.3.1）。
implementation:
  - agent/model.py AgentSession 增：origin String(16) NOT NULL server_default 'chat'；aggregation_key String(255) NULL；title String(255) NULL；Index('ix_agent_sessions_ws_agg', workspace_id, aggregation_key)；docstring 注明变更来源与 D-006 容错
  - platform_sync/model.py AgentSessionLogORM 增：agent_session_id UUID FK agent_sessions ON DELETE SET NULL NULL + 索引
  - 迁移 20260823120000（down_revision=当前 head，批 add_column 三列 + FK + 两索引，downgrade 对称；无回填 R-03）
  - daemon/tests/conftest.py 或相关 fixture：建表覆盖新列（SQLModel create_all 自动含新列，确认 fixture import 即可）；platform_sync tests/conftest 无需改（create_all）
acceptance:
  - alembic heads 单头；既有套件零回归；ruff/mypy 干净
verify:
  - cd backend && uv run alembic heads && uv run pytest app/modules/platform_sync/tests app/modules/daemon/tests -q
constraints:
  - title 列 NULL 对 chat 会话零影响（router 派生改在 task-05）
  - 复合 FK ON DELETE SET NULL（会话删不拖日志行）
---

# task-03 补充说明
无。
