---
id: task-01
title: model two JSON columns + alembic migration
title_zh: 数据模型加 documents/approval 两 JSON 列 + migration
author: qinyi
created_at: 2026-08-14 21:55:00
priority: P1
depends_on: []
blocks: [task-03, task-04, task-05]
requirement_ids: [FR-07]
decision_ids: [D-002@v1, D-003@v1]
allowed_paths:
  - backend/app/modules/platform_sync/model.py
  - backend/migrations/versions/
goal: >
  PlatformChangeProgressORM 加 documents/approval 两个 JSON nullable 列 + 一个 alembic revision
  （batch_alter_table add_column ×2，零回填）。
implementation:
  - model.py：documents/approval 字段，sa_column=Column(JSON, nullable=True)，default None，注释引用 D-002/D-003 单写者
  - 先跑 `cd backend && uv run alembic heads` 确认单 head（Grill 实测 20260814090000），撞则 revision 时间戳后移收敛
  - revision：op.add_column('platform_change_progress', sa.Column('documents', sa.JSON(), nullable=True)) + approval 同理；downgrade drop 两列
acceptance:
  - alembic upgrade head 成功且 heads 单 head
  - ORM 两字段可读写（SQLite 测试库 create_all 自动含新列）
verify:
  - cd backend && uv run alembic heads（单 head）
  - uv run alembic upgrade head && downgrade base && upgrade head 幂等
constraints: 不改现有列语义；migration 文件名时间戳须大于当前 head。
---
