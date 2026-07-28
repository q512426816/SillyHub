---
id: task-02
title: 新增 ppm_project_workspace 建表 migration
title_zh: 新增关联表建表迁移
author: qinyi
created_at: 2026-07-28 14:05:41
priority: P0
depends_on: [task-01]
blocks: []
requirement_ids: [FR-01]
decision_ids: []
allowed_paths:
  - backend/migrations/versions
goal: >
  新建 Alembic migration 创建 ppm_project_workspace 表,revision 唯一且 down_revision 接当前真实 head。
implementation:
  - 先执行 cd backend && uv run alembic heads 确认当前 head(约 202607271700,但并行活跃变更可能已推进)
  - 新建 migration 文件,revision 用唯一 id,down_revision 接确认的当前 head
  - upgrade: op.create_table ppm_project_workspace,列 ppm_project_id+workspace_id,复合主键,FK 双向 CASCADE
  - 索引 ix_ppm_project_workspace_workspace on workspace_id
  - downgrade: drop_table
acceptance:
  - upgrade head 在 PG 与 SQLite 均建表成功
  - alembic heads 只有一个 head(无分叉)
  - down_revision 接当前真实 head
verify:
  - "cd backend && uv run alembic heads"
  - "cd backend && uv run alembic upgrade head"
constraints:
  - down_revision 必须接当前真实 head,部署前再次 alembic heads 校验
  - SQLite 单测抓不到 PG 多 head 崩溃,需 PG 环境校验
---
