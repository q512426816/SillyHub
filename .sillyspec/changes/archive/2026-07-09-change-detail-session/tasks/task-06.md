---
id: task-06
title: AgentSessionRead DTO 回显 change_id/workspace_id
title_zh: 会话响应 DTO 回显绑定字段
author: qinyi
created_at: 2026-07-09 18:13:10
priority: P1
depends_on: [task-01]
blocks: [task-11]
requirement_ids: [FR-02]
decision_ids: [D-001@v1]
allowed_paths:
  - backend/app/modules/daemon/schema.py
provides:
  - contract: AgentSessionRead
    fields: [change_id, workspace_id]
expects_from:
  task-01:
    - contract: AgentSession
      needs: [change_id, workspace_id]
goal: >
  AgentSessionRead（schema.py:18）回显 change_id/workspace_id，前端能据此判断会话归属。
implementation:
  - AgentSessionRead 加 change_id: Optional[UUID]、workspace_id: Optional[UUID]
  - 确认 from_orm/模型转 DTO 映射包含新字段（既有映射机制）
acceptance:
  - GET /sessions/{id} 与列表响应含 change_id/workspace_id（可空）
  - mypy/ruff 通过
verify:
  - cd backend && uv run mypy app/modules/daemon/schema.py
  - cd backend && uv run ruff check app/modules/daemon/schema.py
constraints:
  - 仅回显，不改其他字段
---

## 验收标准
- GET /sessions/{id} 与列表响应含 change_id/workspace_id（可空）
- mypy / ruff 通过
- DTO 映射包含新字段

## 验证步骤
- cd backend && uv run mypy app/modules/daemon/schema.py
- cd backend && uv run ruff check app/modules/daemon/schema.py
