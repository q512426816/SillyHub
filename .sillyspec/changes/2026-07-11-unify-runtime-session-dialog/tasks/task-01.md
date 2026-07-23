---
id: task-01
title: AgentSession 加 deleted_at 列 + 索引
title_zh: AgentSession 表新增 deleted_at 软删列与索引
author: qinyi
created_at: 2026-07-12 00:30:00
priority: P0
depends_on: []
blocks: [task-02, task-03, task-04, task-06]
requirement_ids: [FR-05]
decision_ids: [D-003]
allowed_paths:
  - backend/app/modules/agent/model.py
provides:
  - contract: AgentSession
    fields: [deleted_at]
  - index: ix_agent_sessions_deleted_at
goal: >
  给 AgentSession 表加 deleted_at: datetime | None 列（nullable 默认 null）+ 索引 ix_agent_sessions_deleted_at，支撑逻辑删除（D-003）。
implementation:
  - 在 backend/app/modules/agent/model.py 的 AgentSession（约 :387）新增 deleted_at: datetime | None = Field(default=None, nullable=True)
  - 加索引 ix_agent_sessions_deleted_at（SQLModel table args 或 __table_args__）
  - 类型用 datetime | None（对应 PG TIMESTAMP WITH TIME ZONE / SQLite DATETIME），与 design §8 一致
acceptance:
  - AgentSession 模型含 deleted_at 可空列与 ix_agent_sessions_deleted_at 索引
  - mypy 通过，ruff 通过
  - 既有 AgentSession 字段与关系不变
verify:
  - cd backend && uv run mypy app/modules/agent/model.py
  - cd backend && uv run ruff check app/modules/agent/model.py
constraints:
  - deleted_at nullable，默认 null（=未删除），保证旧数据兼容
  - 不强制改 status，软删可见性靠 deleted_at IS NULL 过滤（design §5 Phase1）
---

## 验收标准
- AgentSession 模型含 deleted_at 可空列与 ix_agent_sessions_deleted_at 索引
- mypy / ruff 通过
- 既有 AgentSession 字段与关系不变

## 验证步骤
- cd backend && uv run mypy app/modules/agent/model.py
- cd backend && uv run ruff check app/modules/agent/model.py
