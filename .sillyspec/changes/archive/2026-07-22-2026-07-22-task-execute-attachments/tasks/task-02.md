---
id: task-02
title: alembic migration 加 ppm_task_execute.file_urls 列（FR-01）
title_zh: migration 加 ppm_task_execute.file_urls 列
author: qinyi
created_at: 2026-07-22 22:16:15
priority: P0
depends_on: [task-01]
blocks: []
requirement_ids: [FR-01]
decision_ids: [D-001@v1]
allowed_paths:
  - backend/migrations/versions/20260722220000_add_file_urls_to_task_execute.py
expects_from:
  task-01:
    - contract: TaskExecute.file_urls
      needs: [file_urls]
goal: >
  新增 alembic migration 给 ppm_task_execute 表加 file_urls 列，down_revision 接 file-center head。
implementation:
  - 新建 migrations/versions/20260722220000_add_file_urls_to_task_execute.py，revision = "20260722220000_add_file_urls"（28 字符，alembic_version.version_num 是 varchar(32)，超长会致 upgrade 写 version 行失败；本仓库既有 filename≠revision 先例），down_revision = "202607221500_create_file"（已用 alembic heads 官方命令核实为唯一 head）
  - upgrade()：op.add_column("ppm_task_execute", sa.Column("file_urls", sa.JSON(), nullable=False, server_default="[]"))，参照 ppm_plan_task.file_urls（migration 202607041100_create_ppm_task.py L62）
  - downgrade()：op.drop_column("ppm_task_execute", "file_urls")（alembic 无 remove_column，正确 API 是 drop_column）
acceptance:
  - alembic upgrade head 成功，ppm_task_execute 有 file_urls 列、旧记录 =[]（server_default）
  - alembic downgrade -1 成功撤列
  - alembic heads 仍唯一（无多头）
verify:
  - cd backend && uv run alembic upgrade head
  - cd backend && uv run alembic downgrade -1
  - cd backend && uv run alembic heads
  - cd backend && uv run alembic upgrade head
constraints:
  - D-001：server_default='[]' 保证旧记录无附件（brownfield 兼容，CLAUDE.md 规则 11 不要求历史迁移）
  - down_revision 必须接 202607221500_create_file，避免多头（参照 memory migration-chain-fragmentation-pattern）
  - revision id ≤32 字符（alembic_version.version_num varchar(32) 硬限制）；文件名 20260722220000_ 前缀，revision `20260722220000_add_file_urls`；downgrade 用 op.drop_column（非 remove_column）
---

流程位置：Wave 1。与 task-01 同波，但依赖 task-01 字段已定义（列定义对齐）。
