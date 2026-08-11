---
id: task-03
title: create alembic migration for workspace isolation
title_zh: 新建 alembic migration — 建表 + 加列 + 复合唯一
author: qinyi
created_at: 2026-08-11 20:27:34
priority: P0
depends_on: [task-01, task-02]
blocks: []
requirement_ids: [FR-08]
allowed_paths:
  - backend/migrations/versions/
goal: >
  新建 alembic migration：建 platform_sync_tokens 表 + platform_change_progress 加 workspace_id 列 + 复合唯一 (workspace_id, change_name)，棕地免回填。
implementation:
  - 新建 backend/migrations/versions/20260811150000_platform_sync_workspace.py，revision 20260811150000，down_revision 20260810150000（当前 head），风格对齐 mcp_tokens migration：dialect 无关 create_table + create_index + 中文 docstring 引 design §8.1
  - op.create_table platform_sync_tokens 列集（design §8.1）：id Uuid PK；workspace_id Uuid FK workspaces.id CASCADE NOT NULL；created_by Uuid FK users.id NOT NULL；name String(100) NOT NULL；token_hash String(255) UNIQUE NOT NULL；scope JSON nullable；last_used_at DateTime(tz) nullable；revoked_at DateTime(tz) nullable；created_at DateTime(tz) NOT NULL
  - op.add_column platform_change_progress.workspace_id Uuid FK workspaces.id CASCADE nullable（老行 NULL，投影 join 不命中走 fallback）
  - 复合唯一 (workspace_id, change_name) 用 create_unique_constraint 或 unique index；唯一约束允许多 NULL，棕地免回填安全（规则 7）
  - downgrade 对称回滚：drop 复合唯一 → drop workspace_id 列 → drop platform_sync_tokens 表
acceptance:
  - alembic upgrade 后 platform_sync_tokens 含 design §8.1 全部列且 token_hash 唯一；platform_change_progress 有 workspace_id 列且老行 NULL 不报错（免回填）
  - (workspace_id, change_name) 复合唯一生效，同 workspace 同名 change 二次插入报唯一冲突
verify:
  - backend/.venv/Scripts/python.exe -m alembic upgrade head
  - backend/.venv/Scripts/python.exe -m alembic heads 应为 20260811150000 单 head
  - 往返：backend/.venv/Scripts/python.exe -m alembic downgrade 20260810150000 后 upgrade head 无异常
constraints:
  - 不要求回填老数据（规则 7 / FR-08），老行 workspace_id 允许 NULL
  - 目标目录为 backend/migrations/versions/（design §6；backend/alembic/versions/ 不存在）；仅结构变更不写业务逻辑不写数据
  - 复合唯一用唯一约束而非复合 PK（老行 NULL 在 PK 非法，唯一约束允许多 NULL；design §8.2 PK 语义归 task-02 model 表达）
  - shk_live_ 过渡保留，本 migration 不涉及 token 过渡逻辑
expects_from:
  task-01:
    - contract: PlatformSyncTokenORM
      needs: [id, workspace_id, created_by, token_hash, revoked_at, created_at]
  task-02:
    - contract: PlatformChangeProgressORM
      needs: [workspace_id, change_name]
---
