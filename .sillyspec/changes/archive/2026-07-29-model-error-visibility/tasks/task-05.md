---
id: task-05
title: backend AgentRun 加 error_detail（JSON 列）+ alembic migration
title_zh: AgentRun 增加 error_detail JSON 列与 alembic 迁移
author: qinyi
created_at: 2026-07-29 10:34:02
priority: P0
depends_on: []
blocks: [task-06]
requirement_ids: [FR-02]
decision_ids: [D-007@v1, D-009@v1]
allowed_paths:
  - backend/app/modules/agent/model.py
  - backend/migrations/versions/
provides:
  - contract: AgentRunErrorDetail
    fields: [error_detail]
goal: >
  AgentRun 新增 error_detail JSON 列存完整 ModelError，与既有 error_code 正交分工，附 alembic migration。
implementation:
  - backend/app/modules/agent/model.py 的 AgentRun（:26）加 error_detail（Mapped[dict|None]，JSON，nullable，default None）
  - 新增 backend/migrations/versions/ 下 migration（add_column agent_runs.error_detail JSON NULL）
  - migration 用唯一 revision id，down 接当前真实 head（防多 head，见迁移链断裂坑）
  - down 为 drop_column error_detail
acceptance:
  - AgentRun.error_detail 列存在且 nullable
  - alembic upgrade head 与 downgrade 均成功，无多 head
  - error_code（:113）保留不受影响，与 error_detail 正交（D-009）
verify:
  - cd backend && uv run alembic upgrade head
  - cd backend && uv run alembic downgrade -1 && uv run alembic upgrade head
constraints:
  - error_detail 仅存模型层 ModelError，系统错误仍用 error_code（D-009 正交）
  - migration 全局 versions/ 目录，不用 daemon/migrations（不存在）
  - 数据可清空，无需历史兼容（CLAUDE.md 规则11）
---
