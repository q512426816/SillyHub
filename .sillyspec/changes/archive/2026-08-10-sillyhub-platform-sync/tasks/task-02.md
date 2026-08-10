---
id: task-02
title: alembic migration create platform_change_progress table
title_zh: alembic 迁移建 platform_change_progress 表
author: qinyi
created_at: 2026-08-10 23:45:00
priority: P0
depends_on: [task-01]
blocks: [task-04]
requirement_ids: [FR-03]
decision_ids: [D-003@v1]
allowed_paths:
  - backend/migrations/versions/20260810150000_create_platform_change_progress.py
goal: >
  建 platform_change_progress 表的 alembic 迁移，down_revision 对齐当前 head 202608091100，
  upgrade/downgrade 完全对称可逆。
implementation:
  - 执行前先 cd backend && uv run alembic heads 确认当前 head=202608091100（单 head，无需 merge，design §1.2 + Grill X-006）
  - 新建 backend/migrations/versions/20260810150000_create_platform_change_progress.py，revision='20260810150000'，down_revision='202608091100'
  - upgrade：op.create_table('platform_change_progress', sa.Column('change_name', sa.String(), primary_key=True), sa.Column('latest_progress', sa.JSON(), nullable=True), sa.Column('last_pushed_at', sa.String(64), nullable=True), sa.Column('last_pusher', sa.String(255), nullable=True), sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()')))
  - downgrade：op.drop_table('platform_change_progress')（完全对称）
  - dialect 无关 create_table/drop_table（SQLite 测试 + PG 生产对齐，design §8.2）
acceptance:
  - 迁移文件就位，revision/down_revision 正确（down_revision=202608091100）
  - alembic upgrade head 无报错
  - alembic downgrade -1 无报错，再 upgrade head 无报错（对称可逆）
verify:
  - cd backend && uv run alembic upgrade head
  - cd backend && uv run alembic downgrade -1 && uv run alembic upgrade head
  - cd backend && uv run ruff format --check migrations/versions && uv run ruff check migrations/versions
constraints:
  - down_revision=202608091100（当前单 head，执行前 alembic heads 确认）
  - dialect 无关 create_table（不用 PG 专属 JSONB/USING 子句），让 SQLite 测试对齐
  - 本项目未上线无需历史数据回填（CLAUDE.md 规则 11）
  - upgrade/downgrade 完全对称
---
