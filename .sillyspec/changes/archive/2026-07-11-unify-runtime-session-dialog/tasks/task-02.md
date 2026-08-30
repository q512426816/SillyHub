---
id: task-02
title: Alembic migration add_agent_sessions_deleted_at
title_zh: Alembic 迁移新增 agent_sessions.deleted_at 列与索引
author: qinyi
created_at: 2026-07-12 00:30:00
priority: P0
depends_on: [task-01]
blocks: []
requirement_ids: [FR-05]
decision_ids: [D-003]
allowed_paths:
  - backend/migrations/versions/<rev>_add_agent_sessions_deleted_at.py
provides:
  - migration: add_agent_sessions_deleted_at
goal: >
  新增 Alembic revision 给 agent_sessions 加 deleted_at 列 + ix_agent_sessions_deleted_at 索引，upgrade/downgrade 可逆。
implementation:
  - 开工前先 alembic heads 复核唯一 head 为 419d34f8e33f
  - 新建 backend/migrations/versions/<新rev>_add_agent_sessions_deleted_at.py，down_revision = "419d34f8e33f"
  - upgrade：op.add_column('agent_sessions', sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True)) + op.create_index('ix_agent_sessions_deleted_at', 'agent_sessions', ['deleted_at'])
  - downgrade：op.drop_index('ix_agent_sessions_deleted_at', table_name='agent_sessions') + op.drop_column('agent_sessions', 'deleted_at')
acceptance:
  - alembic upgrade head 成功，新列 + 索引存在
  - alembic downgrade -1 成功，列与索引被删除（可逆）
  - revision id 唯一，down_revision 指向真实 head 419d34f8e33f
verify:
  - cd backend && uv run alembic heads
  - cd backend && uv run alembic upgrade head
  - cd backend && uv run alembic downgrade -1
  - cd backend && uv run alembic upgrade head
constraints:
  - R-1（migration head 撞并行变更）：down_revision 必须挂当前唯一 head 419d34f8e33f，开工前 alembic heads 复核（C-1，记忆 [[migration-chain-fragmentation-pattern]]）
  - 无数据回填（新列默认 null=未删除，规则 10 允许重置）
---

## 验收标准
- alembic upgrade head 成功，新列 + 索引存在
- alembic downgrade -1 成功，列与索引被删除（可逆）
- revision id 唯一，down_revision 指向真实 head 419d34f8e33f

## 验证步骤
- cd backend && uv run alembic heads
- cd backend && uv run alembic upgrade head
- cd backend && uv run alembic downgrade -1
- cd backend && uv run alembic upgrade head
