---
id: task-01
title: AgentSession 加 change_id + workspace_id 列 + 索引
title_zh: AgentSession 表新增 change_id/workspace_id 列与索引
author: qinyi
created_at: 2026-07-09 18:13:10
priority: P0
depends_on: []
blocks: [task-02, task-03, task-04, task-06, task-07, task-09]
requirement_ids: [FR-01]
decision_ids: [D-001@v1]
allowed_paths:
  - backend/app/modules/agent/model.py
provides:
  - contract: AgentSession
    fields: [change_id, workspace_id]
goal: >
  给 AgentSession 表加 change_id(FK changes.id, nullable) 与 workspace_id(FK workspaces.id, nullable) 列及 change_id 索引，建立会话-变更关联（D-001）。
implementation:
  - 在 backend/app/modules/agent/model.py 的 AgentSession（约 :373）加 change_id: Optional[UUID]=Field(default=None, foreign_key="changes.id", nullable=True)，ON DELETE SET NULL
  - 加 workspace_id: Optional[UUID]=Field(default=None, foreign_key="workspaces.id", nullable=True)
  - 加索引 ix_agent_sessions_change_id（SQLModel table args 或 __table_args__）
acceptance:
  - AgentSession 模型含 change_id/workspace_id 两可空列与 change_id 索引
  - mypy 通过，ruff 通过
  - 既有 AgentSession 字段与关系不变
verify:
  - cd backend && uv run mypy app/modules/agent/model.py
  - cd backend && uv run ruff check app/modules/agent/model.py
constraints:
  - 不改 AgentRun.change_id（既有调度 run 专用）
  - 两列均 nullable，保证旧数据兼容
---

## 验收标准
- AgentSession 模型含 change_id/workspace_id 两可空列与 change_id 索引
- mypy / ruff 通过
- 既有 AgentSession 字段与关系不变

## 验证步骤
- cd backend && uv run mypy app/modules/agent/model.py
- cd backend && uv run ruff check app/modules/agent/model.py
