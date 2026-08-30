---
id: task-01
title: 'backend-model-migration'
title_zh: '后端模型层：AgentSessionLogORM + 迁移 + conftest 建表'
author: qinyi
created_at: 2026-08-23 05:17:00
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-02]
decision_ids: [D-002, D-003, D-007]
allowed_paths:
  - backend/app/modules/platform_sync/model.py
  - backend/migrations/versions/20260823090000_add_platform_agent_logs.py
  - backend/app/modules/platform_sync/tests/conftest.py
goal: >
  建 platform_agent_logs 表的数据层：ORM（design §3.1 全 18 列 + (workspace_id, log_path)
  复合唯一约束）、alembic 迁移（接 20260822090000）、platform_sync 测试 conftest 建表
  清单扩建——为 task-02 接口层提供落库基座。
implementation:
  - model.py 末尾新增 AgentSessionLogORM（继承 BaseModel，table=True）：列与约束逐字对照 design §3.1 表格（id/workspace_id/log_path String(1024)/harness String(32)/format String(64)/session_id String(128)/originator String(128)/detected_via String(64)/agent_cwd String(1024)/exists bool default true/size_bytes BigInteger/mtime_ms Float/first_seen_at·last_seen_at·pushed_at String(64)/invocations Integer/last_command String(255)/scan_run_id String(128)/created_at·updated_at server_default now()），UniqueConstraint("workspace_id","log_path",name="uq_platform_agent_logs_workspace_path")
  - docstring 记变更来源 + 设计依据（对齐 QuicklogEntryORM 注释风格：D-002 结构化列不存 payload、D-003 时间字段 String 原文）
  - 新迁移 20260823090000_add_platform_agent_logs.py：down_revision="20260822090000"，create_table 与 ORM 对称（dialect 无关），downgrade drop_table；docstring 注明「未上线无回填」
  - tests/conftest.py 的 ensure_platform_sync_table fixture tables 清单追加 _ps_model.AgentSessionLogORM.__table__
acceptance:
  - uv run alembic heads 单头（20260823090000）
  - 既有 platform_sync 测试套件（quicklog/router 等）不回归（conftest 建表成功）
  - ruff/mypy 干净
verify:
  - cd backend && uv run alembic heads
  - cd backend && uv run pytest app/modules/platform_sync/tests -q
  - cd backend && uv run ruff check app/modules/platform_sync migrations/versions/20260823090000_add_platform_agent_logs.py && uv run mypy app/modules/platform_sync/model.py
constraints:
  - ORM 必须继承 app.models.base.BaseModel（CONVENTIONS 后端 10）
  - 迁移用 UniqueConstraint 而非复合 PK（quicklog 先例口径：SQLite/PG 对齐）
  - workspace_id NOT NULL（shpsync_ 派生唯一通道，无 shk_live_ 过渡期 NULL 场景）
---

# task-01 补充说明
无。
