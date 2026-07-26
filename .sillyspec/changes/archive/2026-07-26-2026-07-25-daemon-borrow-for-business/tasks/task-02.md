---
id: task-02
title: daemon_borrow_audit 新表 + 迁移
title_zh: 新建借用审计表
author: qinyi
created_at: 2026-07-25 21:50:26
priority: P0
depends_on: []
blocks: [task-11]
requirement_ids: [FR-07]
decision_ids: [D-004@v1]
allowed_paths:
  - backend/app/modules/agent/model.py
  - backend/migrations/versions/202607251200_daemon_borrow_audit.py
provides:
  - contract: DaemonBorrowAudit
    fields: [borrower_user_id, lender_user_id, daemon_instance_id, workspace_id, agent_run_id, borrowed_at, usage_summary]
goal: >
  新建 daemon_borrow_audit 表记录每次借用，满足 D-004 审计不限额。
implementation:
  - 新 model DaemonBorrowAudit（id PK / borrower_user_id FK users CASCADE / lender_user_id FK users CASCADE / daemon_instance_id FK daemon_instances RESTRICT / workspace_id FK workspaces CASCADE / agent_run_id FK agent_runs CASCADE / borrowed_at DateTime tz / usage_summary JSON nullable）
  - 继承 BaseModel（审计钩子自动捕获）
  - alembic 迁移 create_table + FK，down drop
acceptance:
  - 表存在，FK ondelete 正确（user/workspace/run CASCADE，daemon RESTRICT）
  - 迁移 upgrade/downgrade 可逆
verify:
  - cd backend && uv run alembic upgrade head
  - cd backend && uv run pytest app/modules/agent -q --no-cov
constraints:
  - usage_summary nullable（先记基础字段，额度明细后续）
  - 不实现额度限额逻辑（D-004 仅审计）
---
