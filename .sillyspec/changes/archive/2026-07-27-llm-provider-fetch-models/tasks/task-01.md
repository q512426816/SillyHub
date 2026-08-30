---
id: task-01
title: "backend/app/modules/llm_provider/model.py 加 `settings_config: dict[str,Any]|None`（JSON 列，nullable）；`schema.py` 的 `LlmProviderCreate`/`LlmProviderUpdate`/`LlmProviderRead` 加同字段；新 migration `202607270900`（接 head `202607251600`，SQLite/PG 方言分支 `ALTER TABLE llm_providers ADD COLUMN settings_config JSON NULL`，down 接真实 head）。（覆盖：FR-06, D-004）"
title_zh: settings_config 字段 + schema + migration
author: qinyi
created_at: 2026-07-27 09:47:54
priority: P0
depends_on: []
blocks: [task-04, task-12]
requirement_ids: [FR-06]
decision_ids: [D-004]
allowed_paths:
  - backend/app/modules/llm_provider/model.py
  - backend/app/modules/llm_provider/schema.py
  - backend/migrations/versions/
provides:
  - contract: LlmProvider.settings_config
    fields: [settings_config]
expects_from: []
goal: |
  给 LlmProvider 加 JSON 列 settings_config（存高级配置片段），同步 Create/Update/Read 三 schema，
  补新 migration 202607270900，为 task-04 context 透传 / task-05 daemon toEnv / task-10 配置面板提供持久化落点（D-004）。
implementation:
  - model.py ~line 88（extra_env 之后）加 `settings_config: dict[str,Any]|None = Field(default=None, sa_column=Column(JSON, nullable=True))`
  - schema.py 三处加字段：Create/Update 加 `settings_config: dict[str,Any] | None = None`；Read 加 `settings_config: dict[str,Any] | None`（from_attributes 自动取值）
  - 新建 backend/migrations/versions/202607270900_add_llm_provider_settings_config.py：revision=202607270900，down_revision=202607251600（alembic heads 实测单头）
  - upgrade：`op.add_column("llm_providers", sa.Column("settings_config", sa.JSON(), nullable=True))`（sa.JSON 跨 SQLite/PG 方言渲染）
  - downgrade：`op.drop_column("llm_providers", "settings_config")`
acceptance:
  - model.py LlmProvider 含 settings_config 列（JSON, nullable=True）
  - LlmProviderCreate / LlmProviderUpdate / LlmProviderRead 均含 settings_config 字段
  - alembic heads 单头 202607270900；alembic upgrade head 成功加列
  - alembic downgrade -1 可回滚 drop_column 不报错
verify:
  - cd backend && uv run alembic heads
  - cd backend && uv run alembic upgrade head
  - cd backend && uv run alembic downgrade -1
  - cd backend && uv run mypy app
constraints:
  - down_revision 必须接真实 head 202607251600，防多头分叉（migration-chain-fragmentation-pattern）
  - sa.JSON() 跨 SQLite/PG 双方言自动渲染（照 202605311700 范式，两方言均渲染 ALTER TABLE ... ADD COLUMN ... JSON NULL）
  - 只加字段，不改 router/service/CRUD 业务逻辑
  - brownfield 兼容：旧行 settings_config 为 NULL（nullable，无 server_default，视为 None）
---
