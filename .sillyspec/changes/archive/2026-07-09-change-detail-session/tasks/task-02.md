---
id: task-02
title: Alembic 迁移 add_change_workspace_to_agent_sessions
title_zh: 新增 Alembic 迁移为 agent_sessions 加列
author: qinyi
created_at: 2026-07-09 18:13:10
priority: P0
depends_on: [task-01]
blocks: []
requirement_ids: [FR-01]
decision_ids: [D-001@v1]
allowed_paths:
  - backend/app/migrations/versions/
goal: >
  生成可逆 Alembic 迁移，给 agent_sessions 加 change_id/workspace_id 列 + change_id 索引，down_revision 接当前真实 head（规避迁移链断裂 R-01）。
implementation:
  - 先 `cd backend && uv run alembic heads` 确认单一 head
  - `uv run alembic revision -m add_change_workspace_to_agent_sessions --autogenerate`（revision id 全局唯一）
  - 校核 upgrade：ADD COLUMN change_id/workspace_id（nullable）+ CREATE INDEX ix_agent_sessions_change_id
  - 校核 downgrade：DROP INDEX + DROP COLUMN；确认 down_revision 指向真实 head
acceptance:
  - `uv run alembic upgrade head` 成功，`alembic downgrade -1` 可逆
  - PG（非 SQLite）下验证无多 head
verify:
  - cd backend && uv run alembic upgrade head && uv run alembic downgrade -1 && uv run alembic upgrade head
  - cd backend && uv run alembic heads   # 应单一 head
constraints:
  - down_revision 必须接真实 head，禁止分叉（见 memory migration-chain-fragmentation-pattern）
  - 不手写列类型偏差，以 autogenerate 为准再核对
---

## 验收标准
- alembic upgrade head 成功，downgrade -1 可逆
- PG 下验证无多 head（单一 head）
- 列与索引与 task-01 模型一致

## 验证步骤
- cd backend && uv run alembic upgrade head && uv run alembic downgrade -1 && uv run alembic upgrade head
- cd backend && uv run alembic heads
